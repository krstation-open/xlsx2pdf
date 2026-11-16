/**
 * 社区版明细行守卫（#数组.字段 索引映射下放后的回归基线）
 *
 * 语义：同一 #数组.字段 标记每出现一次取下一个数组下标（arr.0.field、arr.1.field…），
 * 行数由模板固定（作者按行重复标记），非自动展开循环。
 * 覆盖：多行索引递增 / 嵌套字段 / 多数组独立计数 / numFmt 继承 / 与 text 混排 /
 * 空数组清除 / 数据少于模板行时多余行清除（不出现 undefined）/ excel2pdf 全链路。
 * 运行：node test/detail-row-guard.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { excel2html, excel2pdf, configure, closeBrowser } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'output');
fs.mkdirSync(outDir, { recursive: true });

// 现场生成明细行模板（3 行重复标记 + 独立数组 + text 混排）
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Detail');
ws.getColumn(1).width = 16;
ws.getColumn(2).width = 16;
ws.getColumn(3).width = 16;
for (const r of [1, 2, 3]) {
  ws.getCell(`A${r}`).value = '${#items.name}';
  ws.getCell(`B${r}`).value = '${#items.spec.label}';
  ws.getCell(`C${r}`).value = '${#items.amount}';
  ws.getCell(`C${r}`).numFmt = '¥#,##0.00';
}
ws.getCell('A4').value = '${#tags.label}';      // 独立数组，计数器互不干扰
ws.getCell('A5').value = '合计：${total}';        // 与 text 标记混排
const tpl = path.join(outDir, 'tpl-detail.xlsx');
await wb.xlsx.writeFile(tpl);

const DATA = {
  items: [
    { name: '甲', spec: { label: '规格A' }, amount: 10 },
    { name: '乙', spec: { label: '规格B' }, amount: 20 },
    { name: '丙', spec: { label: '规格C' }, amount: 30 },
  ],
  tags: [{ label: '标签1' }],
  total: 60,
};

try {
  // 1. 索引映射逐行递增 + 嵌套字段 + numFmt + 独立数组 + 混排
  const { html } = await excel2html({ template: tpl, data: DATA });
  for (const s of ['甲', '乙', '丙', '规格A', '规格B', '规格C', '¥10.00', '¥20.00', '¥30.00', '标签1', '合计：60']) {
    assert.ok(html.includes(s), `应包含 ${s}`);
  }
  assert.ok(!html.includes('${'), '标记全部清除');
  assert.ok(!html.includes('undefined'), '无 undefined 泄漏');
  assert.ok(!html.includes('<script'), '产物无脚本注入');
  console.log('  ✓ 多行索引递增 + 嵌套字段 + numFmt + 独立数组 + text 混排');

  // 2. 空数组 → 明细标记清除（不报错、不残留）
  const empty = await excel2html({ template: tpl, data: { items: [], tags: [], total: 0 } });
  assert.ok(!empty.html.includes('${'), '空数组标记清除');
  assert.ok(!empty.html.includes('甲'), '空数组无数据泄漏');
  assert.ok(empty.html.includes('合计：0'), 'text 标记仍生效');
  console.log('  ✓ 空数组清除标记');

  // 3. 数据少于模板行 → 多余行清除，不出现 undefined
  const short = await excel2html({ template: tpl, data: { items: [{ name: '甲', spec: { label: '规格A' }, amount: 10 }], tags: [], total: 10 } });
  assert.ok(short.html.includes('甲'), '首行取值');
  assert.ok(!short.html.includes('undefined'), '多余行不泄漏 undefined');
  assert.ok(!short.html.includes('${'), '多余行标记清除');
  console.log('  ✓ 数据少于模板行时多余行清除');

  // 4. excel2pdf 全链路（复用 pro 内置 Chrome；缺失则跳过）
  const proChrome = path.resolve(here, '../../xlsx2pdf-pro/browsers/chrome/win64-135.0.7049.114/chrome-win64/chrome.exe');
  if (fs.existsSync(proChrome)) {
    configure({ browserPath: proChrome });
    const { pdf } = await excel2pdf({ template: tpl, data: DATA });
    assert.ok(Buffer.isBuffer(pdf) && pdf.subarray(0, 5).toString() === '%PDF-', 'PDF 魔数');
    assert.ok(pdf.length > 1000, 'PDF 非空');
    fs.writeFileSync(path.join(outDir, 'out-detail.pdf'), pdf);
    console.log(`  ✓ excel2pdf 明细行全链路（${(pdf.length / 1024).toFixed(1)}KB → test/output/out-detail.pdf）`);
  } else {
    console.warn('  ⚠ 跳过 excel2pdf：未找到可复用浏览器');
  }

  console.log('[detail-row-guard] 社区版明细行守卫全部通过');
} finally {
  await closeBrowser();
}