/**
 * 社区版浏览器生命周期参数化开放回归守卫（1.7.0：四键下放 + idle 善意默认 60s）
 *
 * 契约：
 *  ① idle 超阈关单例 + 下次调用重建（短阈配置加速验证）
 *  ② recycle 计数达阈冷启动重建（rendersSinceLaunch 语义）
 *  ③ maxAge 超龄安全点轮换
 *  ④ 非法值（负数/小数/非数）抛 E_OPTION_INVALID；protocolTimeoutMs 须 ≥1000 整数
 *  ⑤ 社区善意默认 browserIdleMs=60000（默认行为变更，CHANGELOG 披露）；recycle/maxAge 默认 0 关闭
 * 运行：node test/lifecycle-guard.mjs（行为断言需可用浏览器，缺失时跳过）
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { excel2pdf, configure, closeBrowser, Xlsx2pdfError } from '../src/index.js';
import { builtinExecutablePath, getConfig } from '../src/browser.js';
import { peekBrowser } from '../src/pdf.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'output');
fs.mkdirSync(outDir, { recursive: true });

// 基础模板（text 标记）
const wb = new ExcelJS.Workbook();
wb.addWorksheet('L').getCell('A1').value = '${name}';
const tpl = path.join(outDir, 'tpl-lifecycle.xlsx');
await wb.xlsx.writeFile(tpl);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const render = () => excel2pdf({ template: tpl, data: { name: 'x' } });

/** 断言抛 E_OPTION_INVALID 且双语 */
async function expectInvalid(label, fn, zhFragment, enFragment) {
  let err;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Xlsx2pdfError, `${label}: 应为 Xlsx2pdfError`);
  assert.strictEqual(err.code, 'E_OPTION_INVALID', `${label}: 码应为 E_OPTION_INVALID，实际 ${err.code}`);
  assert.ok(err.message.includes(zhFragment), `${label}: 中文文案应含「${zhFragment}」`);
  assert.ok(err.message.includes(enFragment), `${label}: 英文文案应含「${enFragment}」`);
  console.log(`  ✓ ${label} → E_OPTION_INVALID`);
}

console.log('[lifecycle-guard] 社区版浏览器生命周期参数化契约');

// ============ ⑤ 善意默认断言（新进程默认值） ============
assert.strictEqual(getConfig().browserIdleMs, 60000, '⑤ 社区善意默认 idle=60000（1.7.0 默认行为变更）');
assert.strictEqual(getConfig().browserRecycleRenders, 0, '⑤ recycle 默认 0 关闭（生产调优知情开启）');
assert.strictEqual(getConfig().browserMaxAgeMs, 0, '⑤ maxAge 默认 0 关闭');
assert.strictEqual(getConfig().protocolTimeoutMs, 60000, '⑤ protocolTimeout 默认 60s 不变');
console.log('  ✓ ⑤ 默认值：idle 60s / recycle 0 / maxAge 0 / protocolTimeout 60s');

// ============ ④ 非法值拒绝（configure 恒接受四键，校验不放宽） ============
for (const key of ['browserIdleMs', 'browserMaxAgeMs', 'browserRecycleRenders']) {
  for (const bad of [-1, 1.5, '60', null, Infinity]) {
    await expectInvalid(`configure({ ${key}: ${JSON.stringify(bad)} })`,
      () => configure({ [key]: bad }), '只接受非负整数', 'non-negative integer');
  }
}
for (const bad of [0, 999, 1.5, 'x', null]) {
  await expectInvalid(`configure({ protocolTimeoutMs: ${JSON.stringify(bad)} })`,
    () => configure({ protocolTimeoutMs: bad }), '≥1000 的整数毫秒', 'integer >= 1000');
}
// 非法值不得污染生效配置
assert.strictEqual(getConfig().browserIdleMs, 60000, '非法值拒绝后 idle 默认不变');
assert.strictEqual(getConfig().protocolTimeoutMs, 60000, '非法值拒绝后 protocolTimeout 默认不变');
// 合法值生效（configure 返回副本可见）
const cfg = configure({ browserIdleMs: 0, browserMaxAgeMs: 1000, browserRecycleRenders: 5, protocolTimeoutMs: 2000 });
assert.strictEqual(cfg.browserIdleMs, 0, '合法 idle=0（关闭）生效');
assert.strictEqual(cfg.browserMaxAgeMs, 1000, '合法 maxAge 生效');
assert.strictEqual(cfg.browserRecycleRenders, 5, '合法 recycle 生效');
assert.strictEqual(cfg.protocolTimeoutMs, 2000, '合法 protocolTimeout 生效');
configure({ browserIdleMs: 60000, browserMaxAgeMs: 0, browserRecycleRenders: 0, protocolTimeoutMs: 60000 });
console.log('  ✓ ④ 非法值拒绝；合法值生效');

// ============ ①②③ 行为断言（需可用浏览器） ============
const builtin = await builtinExecutablePath();
const hasBrowser = fs.existsSync(builtin) || !!process.env.XLSX2PDF_BROWSER_PATH || !!getConfig().browserPath;
if (!hasBrowser) {
  console.log('  ⚠ 跳过行为断言：当前环境无可用浏览器');
} else {
  try {
    // ① idle 超阈关单例 + 下次调用重建
    configure({ browserIdleMs: 150, browserRecycleRenders: 0, browserMaxAgeMs: 0 });
    await closeBrowser();
    await render();
    const b1 = peekBrowser();
    assert.ok(b1, '① 渲染后单例应存在');
    await sleep(400); // 超过 idle 阈值
    assert.strictEqual(peekBrowser(), null, '① 空闲超阈应关闭单例');
    await render();
    const b2 = peekBrowser();
    assert.ok(b2 && b2 !== b1, '① 下次调用应冷启动重建新实例');
    assert.ok(!b1.isConnected(), '① 旧实例应已断开');
    console.log('  ✓ ① idle 超阈关单例 + 下次调用重建');

    // ② recycle 计数达阈重建（阈值 2：第 2 次渲染完成后回收）
    configure({ browserIdleMs: 0, browserRecycleRenders: 2, browserMaxAgeMs: 0 });
    await closeBrowser();
    await render();
    const r1 = peekBrowser();
    assert.ok(r1, '② 第 1 次渲染后单例应存在（计数 1 < 阈值 2）');
    await render();
    assert.strictEqual(peekBrowser(), null, '② 计数达阈应在安全点关闭单例');
    await render();
    const r2 = peekBrowser();
    assert.ok(r2 && r2 !== r1, '② 回收后下次调用应冷启动重建');
    console.log('  ✓ ② recycle 计数达阈冷启动重建');

    // ③ maxAge 超龄安全点轮换（阈值须大于单次渲染耗时：launchedAt 自冷启动完成起算，
    // 首次渲染完成时即超龄会在本次安全点直接轮换）
    configure({ browserIdleMs: 0, browserRecycleRenders: 0, browserMaxAgeMs: 2000 });
    await closeBrowser();
    await render();
    const a1 = peekBrowser();
    assert.ok(a1, '③ 启动后单例应存在');
    await sleep(2200); // 超过墙钟年龄阈值
    await render(); // 本次渲染完成的安全点触发轮换
    assert.strictEqual(peekBrowser(), null, '③ 超龄应在安全点关闭单例');
    await render();
    const a2 = peekBrowser();
    assert.ok(a2 && a2 !== a1, '③ 轮换后下次调用应冷启动重建');
    console.log('  ✓ ③ maxAge 超龄安全点轮换');
  } finally {
    configure({ browserIdleMs: 60000, browserRecycleRenders: 0, browserMaxAgeMs: 0 });
    await closeBrowser();
  }
}

console.log('[lifecycle-guard] 全部通过 ✅');