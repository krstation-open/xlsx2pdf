/**
 * 社区版精确缩放开放回归守卫（1.7.0：option.scale 下放社区版）
 *
 * 契约（容错契约零改动，仅删 PRO_OPTION_KEYS 闸门）：
 *  ① 100 与 'auto' 产物字节一致（100% 等价不传，宽度自适应）
 *  ② 200 放大模式：列宽等比放大，越界不回退（scale>1 跳过越界回收）
 *  ③ 401 封顶 400（与 Excel 上限对齐）
 *  ④ 0/负数/非数字回落 auto 不抛错（调用方传参不严谨不击穿生成）
 *  ⑤ 模板自带 ps.scale=80 无 option 时生效（既有行为回归）
 * 运行：node test/scale-guard.mjs（excel2html 链路，无需浏览器）
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { excel2html } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'output');
fs.mkdirSync(outDir, { recursive: true });

// 基础模板（无显式 scale，两列文本）
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('S');
ws.getCell('A1').value = '${name}';
ws.getCell('B1').value = '静态';
ws.getColumn(1).width = 12;
ws.getColumn(2).width = 20;
const tpl = path.join(outDir, 'tpl-scale.xlsx');
await wb.xlsx.writeFile(tpl);

// 宽模板（总宽超出 A4 可打印宽度，验证放大模式越界不回退）
const wbWide = new ExcelJS.Workbook();
const wsWide = wbWide.addWorksheet('W');
for (let c = 1; c <= 8; c++) {
  wsWide.getCell(1, c).value = `列${c}`;
  wsWide.getColumn(c).width = 20;
}
const tplWide = path.join(outDir, 'tpl-scale-wide.xlsx');
await wbWide.xlsx.writeFile(tplWide);

// 模板自带 scale=80（ExcelJS pageSetup.scale 为百分数）
const wbPs = new ExcelJS.Workbook();
const wsPs = wbPs.addWorksheet('P');
wsPs.pageSetup = { paperSize: 9, orientation: 'portrait', scale: 80 };
wsPs.getCell('A1').value = '${name}';
const tplPs = path.join(outDir, 'tpl-scale-ps80.xlsx');
await wbPs.xlsx.writeFile(tplPs);

const DATA = { name: '张三' };
const htmlOf = (template, option) => excel2html({ template, data: DATA, option }).then((r) => r.html);

/** 提取 colgroup 列宽数组（px） */
function colWidths(html) {
  return [...html.matchAll(/<col style="width:(\d+)px">/g)].map((m) => +m[1]);
}

console.log('[scale-guard] 社区版 option.scale 开放契约');

// ============ ① 100 与 'auto' 字节一致 ============
const auto = await htmlOf(tpl, {});
const s100 = await htmlOf(tpl, { scale: 100 });
const sAuto = await htmlOf(tpl, { scale: 'auto' });
assert.strictEqual(s100, auto, 'scale=100 应与不传（auto）产物字节一致');
assert.strictEqual(sAuto, auto, "scale='auto' 应与不传产物字节一致");
console.log('  ✓ ① 100 与 auto 字节一致');

// ============ ② 200 放大模式：等比放大且越界不回退 ============
// 等比断言用窄模板（总宽未超可打印宽度，100/auto 不收缩，列宽即原尺寸）
const w100 = colWidths(await htmlOf(tpl, { scale: 100 }));
const w200 = colWidths(await htmlOf(tpl, { scale: 200 }));
assert.strictEqual(w100.length, w200.length, '列数一致');
for (let i = 0; i < w100.length; i++) {
  // 取整误差 ≤1px：放大模式逐列 round(w*2)，不做越界回收
  assert.ok(Math.abs(w200[i] - 2 * w100[i]) <= 1, `第 ${i + 1} 列应等比放大 2 倍（${w100[i]} → ${w200[i]}）`);
}
// 越界不回退断言用宽模板（auto 已收缩到可打印宽度，放大后总宽应远超收缩宽的 2 倍）
const wideAuto = colWidths(await htmlOf(tplWide, {}));
const wide200 = colWidths(await htmlOf(tplWide, { scale: 200 }));
const sum = (a) => a.reduce((s, w) => s + w, 0);
assert.ok(sum(wide200) > 2 * sum(wideAuto), '放大模式越界不回退（总宽应远超 auto 收缩宽的 2 倍）');
console.log('  ✓ ② 200 放大模式：列宽等比放大，越界不回退');

// ============ ③ 401 封顶 400 ============
const s400 = await htmlOf(tpl, { scale: 400 });
const s401 = await htmlOf(tpl, { scale: 401 });
assert.strictEqual(s401, s400, 'scale=401 应封顶 400（产物字节一致）');
console.log('  ✓ ③ 401 封顶 400');

// ============ ④ 非正数/非数字回落 auto 不抛错 ============
for (const bad of [0, -5, 'x', NaN]) {
  const h = await htmlOf(tpl, { scale: bad });
  assert.strictEqual(h, auto, `scale=${JSON.stringify(bad)} 应回落 auto（产物字节一致）`);
}
console.log('  ✓ ④ 0/负数/非数字回落 auto 不抛错');

// ============ ⑤ 模板 ps.scale=80 既有行为回归 ============
const psDefault = await htmlOf(tplPs, {});
const psOpt80 = await htmlOf(tplPs, { scale: 80 });
assert.strictEqual(psDefault, psOpt80, '模板自带 scale=80 无 option 时应与显式 scale=80 一致');
assert.notStrictEqual(psDefault, await htmlOf(tplPs, { scale: 'auto' }), '模板 scale=80 应区别于 auto（确实生效）');
console.log('  ✓ ⑤ 模板 ps.scale=80 无 option 时生效');

console.log('[scale-guard] 全部通过 ✅');