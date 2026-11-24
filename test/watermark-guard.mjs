/**
 * 社区版文本水印内置回归守卫（1.7.0：watermark 基础形态下放，含 print 历史别名）
 *
 * 契约（接管 pro print-guard 社区侧断言）：
 *  ① ${field|watermark} 产浮层：zindex/opacity 生效，样式继承单元格（粗/斜/删除线）
 *  ② print 历史别名与 watermark 产物字节一致（旧模板兼容）
 *  ③ 空值清除标记；_默认: 兜底生效
 *  ④ numFmt 自动继承（同 text）
 *  ⑤ 社区无 watermarkScript 注入：不收缩（minsize/lineheight 参数解析透传但自适应留 Pro）
 * 运行：node test/watermark-guard.mjs（excel2html 链路，无需浏览器）
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

// 主模板：浮层参数 / numFmt / 默认值 / 空值 / minsize+lineheight 透传
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Wm');
ws.getCell('A1').value = '${mark|watermark_zindex1_opacity0.3}';
ws.getCell('A1').font = { bold: true, italic: true, strike: true, color: { argb: 'FFFF0000' } };
ws.getCell('B1').value = '${ratio|watermark}';
ws.getCell('B1').numFmt = '0.00';
ws.getCell('C1').value = '${empty|watermark_默认:作废}';
ws.getCell('D1').value = '${nil|watermark}'; // 数据缺省 → 空值清除
ws.getCell('E1').value = '${mark2|watermark_minsize8_lineheight24}';
const tpl = path.join(outDir, 'tpl-watermark.xlsx');
await wb.xlsx.writeFile(tpl);

// print 别名等价对照模板（同参数同数据，仅类型 token 不同）
const wbP = new ExcelJS.Workbook();
wbP.addWorksheet('P').getCell('A1').value = '${t|print_zindex1_opacity0.3}';
const tplPrint = path.join(outDir, 'tpl-watermark-print.xlsx');
await wbP.xlsx.writeFile(tplPrint);
const wbW = new ExcelJS.Workbook();
wbW.addWorksheet('W').getCell('A1').value = '${t|watermark_zindex1_opacity0.3}';
const tplWm = path.join(outDir, 'tpl-watermark-canon.xlsx');
await wbW.xlsx.writeFile(tplWm);

const DATA = { mark: '已作废', ratio: 1.5, mark2: '副本' };

console.log('[watermark-guard] 社区版 watermark 内置契约');

const { html } = await excel2html({ template: tpl, data: DATA, option: { pageSize: 'A4' } });

// ============ ① 浮层 + 参数 + 样式继承 ============
// A4 auto 下 heightScale=1；未配 minsize 时 data-min 兜底全局字号下限 6
const a1 = html.match(/<div class="watermark-wrapper" data-min="6" style="opacity:0\.3;font-weight:bold;font-style:italic;text-decoration:line-through;z-index:1">已作废<\/div>/);
assert.ok(a1, '① watermark 浮层应带 opacity:0.3 / 样式继承 / z-index:1');
assert.ok(html.includes('has-watermark'), '① 水印单元格应带 has-watermark 类');
assert.ok(html.includes('data-watermark="1"'), '① 含水印行应带 data-watermark 保护标记');
assert.ok(!html.includes('${mark|'), '① 标记原文不应残留');
console.log('  ✓ ① 浮层生成：zindex/opacity/样式继承/行保护');

// ============ ② print 别名等价 ============
const printHtml = (await excel2html({ template: tplPrint, data: { t: '已作废' } })).html;
const canonHtml = (await excel2html({ template: tplWm, data: { t: '已作废' } })).html;
assert.strictEqual(printHtml, canonHtml, '② print 别名与 watermark 产物应字节一致');
console.log('  ✓ ② print 历史别名与 watermark 字节一致');

// ============ ③ 空值清除 + 默认值兜底 ============
assert.ok(html.includes('<div class="watermark-wrapper" data-min="6" style="z-index:0">作废</div>'), '③ 空值应使用 _默认: 作废');
const noData = (await excel2html({ template: tpl })).html;
assert.ok(!noData.includes('${'), '③ 缺省 data 标记应全部清除');
// nil 无默认值：空值清除后不得产浮层（D1 无 watermark-wrapper 文本）
const wrappers = (noData.match(/watermark-wrapper/g) || []).length;
const wrappersFull = (html.match(/watermark-wrapper/g) || []).length;
assert.ok(wrappers < wrappersFull, '③ 空值无默认值时不产浮层');
console.log('  ✓ ③ 空值清除标记 / 默认值兜底');

// ============ ④ numFmt 继承 ============
assert.ok(html.match(/<div class="watermark-wrapper" data-min="\d+" style="z-index:0">1\.50<\/div>/), '④ watermark 应按单元格 numFmt 渲染（1.5 → 1.50）');
console.log('  ✓ ④ numFmt 自动继承');

// ============ ⑤ 社区无自适应脚本（诚实披露：minsize/lineheight 解析透传但不收缩） ============
assert.ok(!html.includes('<script'), '⑤ 社区版产物不得含任何脚本注入（水印自适应脚本不注入）');
// 参数仍解析透传：8pt → 11px 下限、24pt → 32px 行距（A4 auto heightScale=1）
assert.ok(html.includes('data-min="11"'), '⑤ minsize8 应解析为 data-min=11（参数透传）');
assert.ok(html.includes('line-height:32px'), '⑤ lineheight24 应解析为 line-height:32px（参数透传）');
console.log('  ✓ ⑤ 无脚本不收缩；minsize/lineheight 参数透传（自适应留 Pro）');

console.log('[watermark-guard] 全部通过 ✅');