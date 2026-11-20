/**
 * 社区版取消守卫（1.5.0：option.signal / E_CANCELLED）
 *
 * 契约：
 *  - 预 abort 快速失败（不启动浏览器）
 *  - 渲染中 abort → E_CANCELLED，浏览器单例保留，后续任务正常
 *  - 排队中 abort → 从队列摘除不占槽位（限流 1 实证），后续任务不受阻
 * 运行：node test/cancel-guard.mjs（行为断言需浏览器，缺失时跳过）
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { excel2pdf, configure, closeBrowser } from '../src/index.js';
import { getBrowser } from '../src/pdf.js';
import { registerSeams } from '../src/seams.js';
import { builtinExecutablePath } from '../src/browser.js';
import { Xlsx2pdfError } from '../src/errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'output');
fs.mkdirSync(outDir, { recursive: true });

// 大模板（100×150 静态格，逼近单元格守卫上限）：拉长生成管线，
// 让 200ms 处的 abort 大概率落在渲染进行中（落在 buildHtml 阶段同样应抛 E_CANCELLED）
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Big');
for (let r = 1; r <= 100; r++) {
  for (let c = 1; c <= 150; c++) ws.getCell(r, c).value = `值${r}-${c}`;
}
const tplBig = path.join(outDir, 'tpl-cancel-big.xlsx');
await wb.xlsx.writeFile(tplBig);

// 小模板：取消后的恢复验证用
const wbS = new ExcelJS.Workbook();
wbS.addWorksheet('S').getCell('A1').value = '${name}';
const tplSmall = path.join(outDir, 'tpl-cancel-small.xlsx');
await wbS.xlsx.writeFile(tplSmall);

// 占槽闸门：经 fontGuardCheck 接缝让任务 A 在渲染槽内（setContent 之后、出片之前）
// 确定性挂起。不依赖渲染耗时猜测，也不依赖远程资源（图片下载在 buildHtml 阶段，占不住渲染槽）
let gateEntered = false;
let releaseGate = () => {};
const gate = new Promise((r) => { releaseGate = r; });
// 注：接缝在 ③ 段内才注册，避免 ② 的无 signal 恢复任务被闸门挂死

const hasBrowser = fs.existsSync(await builtinExecutablePath()) || !!process.env.XLSX2PDF_BROWSER_PATH;

/** 断言 Promise 以 E_CANCELLED 拒绝 */
async function expectCancelled(label, promise) {
  let err;
  try {
    await promise;
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Xlsx2pdfError && err.code === 'E_CANCELLED',
    `${label}: 应抛 E_CANCELLED，实际 ${err && err.code}`);
  console.log(`  ✓ ${label}`);
}

try {
  console.log('[cancel-guard] option.signal 取消契约');

  // ① 预 abort：不启动浏览器即失败（无浏览器环境也可断言）
  const ac0 = new AbortController();
  ac0.abort();
  await expectCancelled('预 abort 快速失败',
    excel2pdf({ template: tplSmall, option: { signal: ac0.signal } }));

  if (!hasBrowser) {
    console.log('  ⚠ 跳过渲染中/排队中行为断言：当前环境无可用浏览器');
    console.log('[cancel-guard] 通过（部分跳过）✅');
  } else {
    // ② 渲染中 abort：大模板渲染窗口内取消 → E_CANCELLED
    const ac1 = new AbortController();
    const p1 = excel2pdf({ template: tplBig, option: { signal: ac1.signal } });
    setTimeout(() => ac1.abort(), 200);
    await expectCancelled('渲染中 abort → E_CANCELLED', p1);

    // 取消后浏览器单例保留复用：后续任务正常出片
    const after = await excel2pdf({ template: tplSmall, data: { name: 'ok' } });
    assert.ok(after.pdf.subarray(0, 5).toString() === '%PDF-', '取消后后续任务应正常出片');
    console.log('  ✓ 取消后浏览器复用不破坏，后续任务正常');

    // ③ 排队中 abort：限流 1，任务 A 经闸门接缝确定性占槽，B 真正入队后取消 → 摘除不占槽
    // 注：configure 必须先于 A 发起（acquireSlot 读的是发起时的全局配置）
    configure({ maxConcurrency: 1 });
    registerSeams({ fontGuardCheck: async () => { gateEntered = true; await gate; } });
    const br = await getBrowser();
    // Chrome 启动自带一个空白页（非任务开）：标签页计数一律相对基线断言
    const basePages = (await br.pages()).length;
    const pA = excel2pdf({ template: tplSmall, data: { name: 'a' } });
    pA.catch(() => { /* 失败路径防未处理拒绝（正常路径下方仍会 await） */ });

    // 等 A 拿槽并进入闸门（此时 A 已持有渲染槽位）
    let rendering = false;
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 50));
      if (gateEntered) { rendering = true; break; }
    }
    assert.ok(rendering, 'A 应已拿槽并进入占槽闸门');
    assert.strictEqual((await br.pages()).length, basePages + 1, 'A 占槽应只新开一个标签页');

    const acB = new AbortController();
    const pB = excel2pdf({ template: tplSmall, data: { name: 'b' }, option: { signal: acB.signal } });
    pB.catch(() => { /* 同上 */ });
    await new Promise((r) => setTimeout(r, 500)); // 小模板 buildHtml 极快，B 此时必已入队
    assert.strictEqual((await br.pages()).length, basePages + 1, 'B 排队期间不应新开标签页');

    acB.abort();
    await expectCancelled('排队中 abort → 摘除 + E_CANCELLED', pB);

    // 摘除后标签页数不变（B 未占槽）；放行闸门让 A 出片；随后 C 能拿槽
    assert.strictEqual((await br.pages()).length, basePages + 1, 'B 摘除后不应残留标签页');
    releaseGate();
    const resA = await pA;
    assert.ok(resA.pdf.subarray(0, 5).toString() === '%PDF-', '占槽任务 A 不受 B 取消影响');
    const resC = await excel2pdf({ template: tplSmall, data: { name: 'c' } });
    assert.ok(resC.pdf.subarray(0, 5).toString() === '%PDF-', 'B 摘除后 C 应正常拿槽出片');
    console.log('  ✓ 排队摘除不占槽：A 不受影响，C 正常拿槽');

    configure({ maxConcurrency: 1 }); // 复位（与默认一致，显式声明意图）
    console.log('[cancel-guard] 全部通过 ✅');
  }
} catch (err) {
  console.error('[cancel-guard] 失败 ❌', err);
  process.exitCode = 1;
} finally {
  releaseGate(); // 失败路径也放行闸门，避免 A 挂死导致 closeBrowser 卡住
  registerSeams({ fontGuardCheck: null }); // 复位接缝，不污染同进程后续用例
  await closeBrowser();
}