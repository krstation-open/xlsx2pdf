/**
 * 一键示例：npm run example
 *
 * 现场生成 A4 演示模板（不含任何私有资产）→ 注入数据 → 出片 PDF。
 * 与 CLI `xlsx2pdf convert` 共用 scripts/convert-lib.mjs 管线；
 * 首次运行若内置 Chrome 未就绪会自动下载（带进度输出，约 150MB，不是卡死）。
 *
 * 产物：examples/output/demo.xlsx / demo.pdf
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { runConvert, printError } from '../scripts/convert-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'output');
fs.mkdirSync(outDir, { recursive: true });

// ============ 1. 现场生成演示模板（检测报告：合并标题 / 边框 / numFmt / 明细行） ============
const tpl = path.join(outDir, 'demo.xlsx');
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('报告');
ws.pageSetup = { paperSize: 9, orientation: 'portrait' }; // A4 纵向
ws.getColumn(1).width = 14;
ws.getColumn(2).width = 34;

const thin = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

ws.mergeCells('A1:B1');
const title = ws.getCell('A1');
title.value = '检测报告（示例）';
title.font = { size: 16, bold: true };
title.alignment = { horizontal: 'center', vertical: 'middle' };
ws.getRow(1).height = 30;

const rows = [
  ['样品名称', '${name}'],
  ['委托单位', '${customer.name}'],
  ['检测金额', '${amount}'],
  ['检测日期', '${date}'],
  ['结论', '${result|text_default:--}'],
];
rows.forEach(([label, marker], i) => {
  const r = i + 2;
  ws.getCell(`A${r}`).value = label;
  ws.getCell(`B${r}`).value = marker;
  ws.getRow(r).height = 20;
});
ws.getCell('B4').numFmt = '¥#,##0.00';
ws.getCell('B5').numFmt = 'yyyy-mm-dd';

// 明细行：同一标记重复三行，逐次取数组下一项（社区版内置索引映射）
ws.getCell('A8').value = '项目';
ws.getCell('B8').value = '结果';
for (const r of [9, 10, 11]) {
  ws.getCell(`A${r}`).value = '${#items.label}';
  ws.getCell(`B${r}`).value = '${#items.value}';
}
for (let r = 1; r <= 11; r++) {
  for (const col of ['A', 'B']) ws.getCell(`${col}${r}`).border = thin;
}
await wb.xlsx.writeFile(tpl);
console.log(`[example] 演示模板已生成: ${tpl}`);

// ============ 2. 注入数据并出片（与 CLI 共用管线） ============
const data = {
  name: '饮用水样品',
  customer: { name: '某某科技有限公司' },
  amount: 1234.5,
  date: new Date('2026-11-19'),
  result: '合格',
  items: [
    { label: 'pH 值', value: '7.2' },
    { label: '浊度', value: '0.3 NTU' },
    { label: '菌落总数', value: '<1 CFU/mL' },
  ],
};

try {
  const { outPath } = await runConvert({
    template: tpl,
    data,
    out: path.join(outDir, 'demo.pdf'),
  });
  console.log(`[example] 打开看看: ${outPath}`);
  console.log('[example] 试试 CLI: npx xlsx2pdf convert examples/output/demo.xlsx --data @你的数据.json');
} catch (err) {
  process.exit(printError(err));
}