/**
 * 社区版 MDW 启发式表守卫（1.6.0：列宽按工作簿默认字体换算）
 *
 * 契约：
 *  - 中文等宽字体（宋体/黑体等）按字号查表/推算 MDW（宋体 11 → 8px）
 *  - 雅黑族独立判定（1.6.1：中/英文名均命中，11pt → 9px，不误触 CJK 等宽表）
 *  - 等线/DengXian 有意走西文分支（数字度量与 Calibri 同源，11pt → 7px）
 *  - 西文字体保守比例（Calibri/TNR 11 → 7px）；默认字体缺失维持公开常数 7
 *  - 列宽换算沿用 Excel 官方公式；seams.resolveMdw 注入时优先（Pro 覆盖边界不变）
 * 运行：node test/mdw-guard.mjs（无需浏览器）
 */
import assert from 'node:assert';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { resolveCoreMdw, CORE_DEFAULT_MDW } from '../src/mdw.js';
import { colWidthToPx, processTemplate } from '../src/engine.js';
import { registerSeams } from '../src/seams.js';

console.log('[mdw-guard] 默认字体 → MDW 列宽换算契约');

// ① 启发式表
assert.strictEqual(resolveCoreMdw({ name: '宋体', size: 11 }), 8, '宋体 11 → 8');
assert.strictEqual(resolveCoreMdw({ name: '宋体', size: 9 }), 7, '宋体 9 → 7');
assert.strictEqual(resolveCoreMdw({ name: '宋体', size: 12 }), 9, '宋体 12 → 9');
assert.strictEqual(resolveCoreMdw({ name: '宋体', size: 14 }), 10, '宋体 14 按字号推算 → 10');
assert.strictEqual(resolveCoreMdw({ name: 'SimSun', size: 11 }), 8, 'SimSun 别名命中');
assert.strictEqual(resolveCoreMdw({ name: '黑体', size: 11 }), 8, '黑体 11 → 8');
assert.strictEqual(resolveCoreMdw({ name: 'Times New Roman', size: 10 }), 7, 'TNR 10 → 7');
assert.strictEqual(resolveCoreMdw({ name: 'Calibri', size: 11 }), 7, 'Calibri 11 → 7');
assert.strictEqual(resolveCoreMdw({ name: '等线', size: 11 }), 7, '等线 11 走西文比例 → 7');
assert.strictEqual(resolveCoreMdw({ name: 'DengXian', size: 11 }), 7, 'DengXian 11 与 Calibri 同源 → 7（勿归 CJK 表）');
assert.strictEqual(resolveCoreMdw({ name: '微软雅黑', size: 11 }), 9, '微软雅黑 11 独立表 → 9（不误触 CJK 8）');
assert.strictEqual(resolveCoreMdw({ name: 'Microsoft YaHei', size: 11 }), 9, '雅黑英文名命中 → 9（不落西文 7）');
assert.strictEqual(resolveCoreMdw({ name: '微软雅黑', size: 9 }), 7, '雅黑 9 → 7');
assert.strictEqual(resolveCoreMdw({ name: '微软雅黑', size: 12 }), 9, '雅黑 12 → 9');
assert.strictEqual(resolveCoreMdw({ name: 'Microsoft YaHei', size: 14 }), 11, '雅黑 14 按 11pt→9 推算 → 11');
assert.strictEqual(resolveCoreMdw(null), CORE_DEFAULT_MDW, '默认字体缺失维持 7');
assert.strictEqual(resolveCoreMdw({ name: '宋体' }), CORE_DEFAULT_MDW, '无字号维持 7');
console.log('  ✓ 常见字体启发式表（CJK 查表/推算、雅黑族独立、等线走西文、缺失回退 7）');

// ② Excel 官方公式：px = floor(((256*w + floor(128/MDW))/256)*MDW)
assert.strictEqual(colWidthToPx(17.2, 8), 138, '宋体基准 17.2 字符 → 138px');
assert.strictEqual(colWidthToPx(17.2, 7), 120, 'Calibri 基准 17.2 字符 → 120px');
console.log('  ✓ 官方公式换算（MDW 8 与 7 差 ~15%，即修复前的偏窄量）');

// ③ 集成：styles.xml 字体表第 0 项决定 MDW（夹具经 jszip 改写默认字体）
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('S');
ws.getColumn(1).width = 17.2;
ws.getCell('A1').value = 'x';
const bufPlain = Buffer.from(await wb.xlsx.writeBuffer());

const zip = await JSZip.loadAsync(bufPlain);
const styles = await zip.file('xl/styles.xml').async('string');
const patched = styles.replace(
  /(<fonts[^>]*>\s*)<font>[\s\S]*?<\/font>/,
  '$1<font><sz val="11"/><name val="宋体"/></font>',
);
assert.notStrictEqual(patched, styles, '夹具应成功改写默认字体');
zip.file('xl/styles.xml', patched);
const bufSong = await zip.generateAsync({ type: 'nodebuffer' });

const mSong = await processTemplate(bufSong, {});
assert.deepStrictEqual(mSong.defaultFont, { name: '宋体', size: 11 });
assert.strictEqual(mSong.columnWidths[0], 138, '宋体 11 模板列宽应按 MDW 8 换算');
const mPlain = await processTemplate(bufPlain, {});
assert.strictEqual(mPlain.columnWidths[0], 120, '默认 Calibri 模板行为不变（MDW 7）');
console.log('  ✓ 集成：宋体模板 138px / Calibri 模板 120px（历史行为不破坏）');

// ④ Pro 覆盖边界：seams.resolveMdw 注入时优先于内置启发式
registerSeams({ resolveMdw: () => 9 });
const mPro = await processTemplate(bufSong, {});
assert.strictEqual(mPro.columnWidths[0], colWidthToPx(17.2, 9), '注入实现应覆盖内置表');
registerSeams({ resolveMdw: null });
console.log('  ✓ seams.resolveMdw 注入优先（Pro 覆盖边界不变）');

console.log('[mdw-guard] 全部通过 ✅');