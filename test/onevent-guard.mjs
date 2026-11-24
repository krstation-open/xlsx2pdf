/**
 * 社区版渲染事件钩子回归守卫（1.7.0：onEvent 社区 sink 桥落地，迭代计划 1.5.0 既定项）
 *
 * 契约：
 *  ① 单页调用收到 html/render/done（+ render.wait/render.chrome/render.print）且计量字段齐全
 *  ② 钩子抛错不击穿生成
 *  ③ 非函数 configure 抛 E_OPTION_INVALID（null 允许 = 关闭）
 *  ④ 双 sink 共存：社区 onEvent 与 seams.emitEvent 互不排斥；两者皆无 = 零开销路径
 * 运行：node test/onevent-guard.mjs（事件断言需可用浏览器，缺失时跳过）
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { excel2pdf, configure, closeBrowser, Xlsx2pdfError } from '../src/index.js';
import { builtinExecutablePath, getConfig } from '../src/browser.js';
import { registerSeams } from '../src/seams.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'output');
fs.mkdirSync(outDir, { recursive: true });

// 基础模板（text 标记）
const wb = new ExcelJS.Workbook();
wb.addWorksheet('O').getCell('A1').value = '${name}';
const tpl = path.join(outDir, 'tpl-onevent.xlsx');
await wb.xlsx.writeFile(tpl);

const render = () => excel2pdf({ template: tpl, data: { name: 'x' } });

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
  assert.ok(err.message.includes('只接受回调函数'), `${label}: 中文文案保留`);
  assert.ok(err.message.includes('callback function'), `${label}: 英文文案存在`);
  console.log(`  ✓ ${label} → E_OPTION_INVALID`);
}

console.log('[onevent-guard] 社区版 onEvent 钩子契约');

// ============ ③ 配置面校验（无需浏览器） ============
assert.strictEqual(getConfig().onEvent, null, '③ 默认 onEvent=null（未配置零开销）');
for (const bad of ['x', 123, {}, []]) {
  await expectInvalid(`configure({ onEvent: ${JSON.stringify(bad)} })`,
    () => configure({ onEvent: bad }));
}
configure({ onEvent: null }); // null 允许（关闭）
assert.strictEqual(getConfig().onEvent, null, '③ null 关闭合法');
console.log('  ✓ ③ 非函数拒绝；null 关闭合法');

// ============ ①②④ 事件断言（需可用浏览器） ============
const builtin = await builtinExecutablePath();
const hasBrowser = fs.existsSync(builtin) || !!process.env.XLSX2PDF_BROWSER_PATH || !!getConfig().browserPath;
if (!hasBrowser) {
  console.log('  ⚠ 跳过事件断言：当前环境无可用浏览器');
} else {
  try {
    // ① 单页调用事件序列与计量字段
    const events = [];
    configure({ onEvent: (evt) => events.push(evt) });
    const { pdf } = await render();
    assert.ok(Buffer.isBuffer(pdf) && pdf.subarray(0, 5).toString() === '%PDF-', '① 生成成功');
    const steps = events.map((e) => e.step);
    for (const s of ['html', 'render', 'done', 'render.wait', 'render.chrome', 'render.print']) {
      assert.ok(steps.includes(s), `① 应收到 ${s} 事件，实际：${steps.join(',')}`);
    }
    assert.ok(events.every((e) => typeof e.ts === 'number'), '① 每个事件应带 ts 时间戳');
    const htmlEvt = events.find((e) => e.step === 'html');
    assert.ok(typeof htmlEvt.ms === 'number' && htmlEvt.pages === 1, '① html 事件应带 ms/pages');
    const renderEvt = events.find((e) => e.step === 'render');
    assert.ok(typeof renderEvt.ms === 'number' && renderEvt.bytes > 0 && renderEvt.pages === 1, '① render 事件应带 ms/bytes/pages');
    const doneEvt = events.find((e) => e.step === 'done');
    assert.ok(typeof doneEvt.ms === 'number' && doneEvt.pdfBytes === pdf.length && doneEvt.htmlBytes > 0, '① done 事件应带 ms/pdfBytes/htmlBytes');
    console.log(`  ✓ ① 事件序列齐全（${steps.length} 事件）且计量字段完整`);

    // ② 钩子抛错不击穿生成
    configure({ onEvent: () => { throw new Error('hook boom'); } });
    const r2 = await render();
    assert.ok(Buffer.isBuffer(r2.pdf) && r2.pdf.subarray(0, 5).toString() === '%PDF-', '② 钩子抛错不得击穿生成');
    console.log('  ✓ ② 钩子抛错不击穿生成');

    // ④ 双 sink 共存：社区钩子与 seams.emitEvent 收到同一事件流
    const hookEvents = [];
    const sinkEvents = [];
    configure({ onEvent: (evt) => hookEvents.push(evt) });
    registerSeams({ emitEvent: (evt) => sinkEvents.push(evt) });
    try {
      await render();
      assert.ok(hookEvents.length > 0 && sinkEvents.length > 0, '④ 双 sink 均应收到事件');
      assert.deepStrictEqual(hookEvents.map((e) => e.step), sinkEvents.map((e) => e.step), '④ 双 sink 事件序列应一致');
    } finally {
      registerSeams({ emitEvent: null });
    }
    // 两者皆无：零开销路径（不构造 evt），生成正常
    configure({ onEvent: null });
    const r3 = await render();
    assert.ok(Buffer.isBuffer(r3.pdf), '④ 双 sink 皆无时生成正常（零开销路径）');
    console.log('  ✓ ④ 双 sink 共存；皆无时零开销路径');
  } finally {
    configure({ onEvent: null });
    registerSeams({ emitEvent: null });
    await closeBrowser();
  }
}

console.log('[onevent-guard] 全部通过 ✅');