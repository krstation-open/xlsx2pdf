/**
 * 社区版渲染并发开放回归守卫（1.4.0：maxConcurrency 下放社区版）
 *
 * 契约：
 *  ① configure / option 只接受正整数：0/负数/小数/非数值/Infinity 抛 E_OPTION_INVALID（双语）
 *  ② 默认 1 不变；合法值生效（configure 返回副本可见）
 *  ③ 限流行为：上限 2 下并发请求峰值标签页 ≤ 2，排队不丢请求
 *  ④ 调用级 option.maxConcurrency 优先于 configure 全局
 *  ⑤ 设为 >1 且无内存守卫时打一次性运行期告警（进程内只提醒一次）
 * 运行：node test/concurrency-option-guard.mjs（行为断言需可用浏览器，缺失时跳过）
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { excel2pdf, excel2html, configure, closeBrowser, Xlsx2pdfError } from '../src/index.js';
import { builtinExecutablePath, getConfig } from '../src/browser.js';
import { getBrowser } from '../src/pdf.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'output');
fs.mkdirSync(outDir, { recursive: true });

// 基础模板（text 标记）
const wb = new ExcelJS.Workbook();
wb.addWorksheet('C').getCell('A1').value = '${name}';
const tpl = path.join(outDir, 'tpl-concurrency.xlsx');
await wb.xlsx.writeFile(tpl);

/** 断言抛 E_OPTION_INVALID 且双语 */
async function expectInvalid(label, fn) {
  let err;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Xlsx2pdfError, `${label}: 应为 Xlsx2pdfError`);
  assert.strictEqual(err.code, 'E_OPTION_INVALID', `${label}: 码应为 E_OPTION_INVALID，实际 ${err.code}`);
  assert.ok(err.message.includes('只接受正整数'), `${label}: 中文文案保留`);
  assert.ok(err.message.includes('positive integer'), `${label}: 英文文案存在`);
  console.log(`  ✓ ${label} → E_OPTION_INVALID`);
}

console.log('[concurrency-option-guard] 社区版 maxConcurrency 开放契约');

// ============ ① 非法值拒绝（configure 与 option 同一校验） ============
for (const bad of [0, -1, 1.5, '2', null, Infinity, NaN]) {
  await expectInvalid(`configure({ maxConcurrency: ${JSON.stringify(bad)} })`,
    () => configure({ maxConcurrency: bad }));
  await expectInvalid(`option.maxConcurrency = ${JSON.stringify(bad)}（excel2html）`,
    () => excel2html({ template: tpl, option: { maxConcurrency: bad } }));
}
// 非法 configure 不得污染生效配置
assert.strictEqual(getConfig().maxConcurrency, 1, '非法值拒绝后默认 1 不变');

// ============ ② 合法值生效 + ⑤ 一次性告警 ============
const warns = [];
const origWarn = console.warn;
console.warn = (...args) => { warns.push(args.join(' ')); };
try {
  const cfg = configure({ maxConcurrency: 2 });
  assert.strictEqual(cfg.maxConcurrency, 2, 'configure 返回副本应反映新值');
  configure({ maxConcurrency: 3 });
  configure({ maxConcurrency: 1 }); // 回落默认不告警
} finally {
  console.warn = origWarn;
}
const riskWarns = warns.filter((m) => m.includes('maxConcurrency'));
assert.strictEqual(riskWarns.length, 1, `>1 告警应只打一次，实际 ${riskWarns.length}`);
assert.ok(riskWarns[0].includes('内存') && riskWarns[0].includes('memory'), '告警应双语提示内存风险');
console.log('  ✓ 合法值生效；>1 一次性风险告警（双语）');

// ============ ③④ 行为断言（需可用浏览器） ============
const builtin = await builtinExecutablePath();
const hasBrowser = fs.existsSync(builtin) || !!process.env.XLSX2PDF_BROWSER_PATH || !!getConfig().browserPath;
if (!hasBrowser) {
  console.log('  ⚠ 跳过行为断言：当前环境无可用浏览器');
} else {
  const TOTAL = 6;
  const LIMIT = 2;

  /** 预热浏览器并取常驻页基线（Chrome 启动自带一个空白页） */
  configure({ maxConcurrency: 1 });
  await excel2pdf({ template: tpl, data: { name: 'warm' } });
  const basePages = (await (await getBrowser()).pages()).length;

  /** 并发跑 TOTAL 份，采样峰值标签页数 */
  async function runBatch(makeOption) {
    let peak = 0;
    const sampler = setInterval(async () => {
      try {
        const n = (await (await getBrowser()).pages()).length - basePages;
        if (n > peak) peak = n;
      } catch (_) { /* 浏览器尚未就绪 */ }
    }, 30);
    const results = await Promise.all(
      Array.from({ length: TOTAL }, () => excel2pdf({ template: tpl, data: { name: 'x' }, option: makeOption() }))
    );
    clearInterval(sampler);
    for (const r of results) {
      assert.ok(Buffer.isBuffer(r.pdf) && r.pdf.subarray(0, 5).toString() === '%PDF-', 'PDF 魔数正确');
    }
    return { peak, count: results.length };
  }

  // ③ 全局限流 2：峰值 ≤ 2，排队不丢请求
  configure({ maxConcurrency: LIMIT });
  const globalRun = await runBatch(() => ({}));
  assert.ok(globalRun.peak <= LIMIT, `全局上限 ${LIMIT}，峰值应 ≤ ${LIMIT}，实际 ${globalRun.peak}`);
  assert.ok(globalRun.peak >= 1, '采样应至少观察到 1 个标签页');
  assert.strictEqual(globalRun.count, TOTAL, '排队不得丢请求');
  console.log(`  ✓ 全局限流 ${LIMIT}：峰值 ${globalRun.peak}，${TOTAL} 份全部完成`);

  // ④ 调用级覆盖：全局 1，调用级 2 → 峰值应达到 2（证明 option 生效而非沿用全局）
  configure({ maxConcurrency: 1 });
  const callRun = await runBatch(() => ({ maxConcurrency: LIMIT }));
  assert.ok(callRun.peak <= LIMIT, `调用级上限 ${LIMIT}，峰值应 ≤ ${LIMIT}，实际 ${callRun.peak}`);
  assert.ok(callRun.peak >= LIMIT, `调用级应覆盖全局 1，峰值应 ≥ ${LIMIT}，实际 ${callRun.peak}`);
  console.log(`  ✓ 调用级覆盖全局：峰值 ${callRun.peak}（全局 1 → 调用级 ${LIMIT}）`);

  await closeBrowser();
}

configure({ maxConcurrency: 1 }); // 复位
console.log('[concurrency-option-guard] 全部通过 ✅');