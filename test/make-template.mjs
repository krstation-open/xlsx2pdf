/**
 * 演示模板生成（社区版测试专用）
 *
 * 不复制任何私有测试模板：用 exceljs 现场生成 A4 标准纸演示模板。
 * 覆盖社区版免费能力：text 标记 / 嵌套点路径 / 标记默认值 / numFmt 继承 /
 * 合并格 / 边框 / 背景色 / 富文本 / 自定义扩展（插件标记类型 / 自定义语法）。
 */
import ExcelJS from 'exceljs';
import path from 'node:path';

/** 细边框（四边 thin），模拟常见报表表格 */
const THIN_BORDER = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

/**
 * 生成全部测试模板
 * @param {string} outDir - 输出目录（不存在时自动创建）
 * @returns {Promise<{basic: string, proMarker: string, detailRow: string, extMarker: string, customSyntax: string}>} 各模板绝对路径
 */
export async function makeTemplates(outDir) {
  const basic = path.join(outDir, 'tpl.xlsx');
  const proMarker = path.join(outDir, 'tpl-pro-marker.xlsx');
  const detailRow = path.join(outDir, 'tpl-detail-row.xlsx');
  const extMarker = path.join(outDir, 'tpl-ext-marker.xlsx');
  const customSyntax = path.join(outDir, 'tpl-custom-syntax.xlsx');

  // ============ 基础演示模板（A4 纵向，文本报告） ============
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('报告');
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: 'portrait',
    margins: { top: 0.75, bottom: 0.75, left: 0.7, right: 0.7 },
  };
  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 32;

  // 标题：合并格 + 大字号加粗居中
  ws.mergeCells('A1:B1');
  const title = ws.getCell('A1');
  title.value = '检测报告';
  title.font = { size: 16, bold: true };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;

  const rows = [
    ['姓名', '${name}'],
    ['部门', '${dept}'],
    ['级别', '${info.level}'], // 嵌套点路径
    ['金额', '${amount}'],
    ['日期', '${date}'],
    ['备注', '${note|text_default:--}'], // 标记默认值
  ];
  rows.forEach(([label, marker], i) => {
    const r = i + 2;
    ws.getCell(`A${r}`).value = label;
    ws.getCell(`B${r}`).value = marker;
    ws.getRow(r).height = 20;
  });

  // numFmt 自动继承：金额货币格式 / 日期格式
  ws.getCell('B5').numFmt = '¥#,##0.00';
  ws.getCell('B6').numFmt = 'yyyy-mm-dd';

  // 静态结论行：背景色 + 富文本局部格式（「合格」加粗）
  ws.getCell('A8').value = '结论';
  ws.getCell('B8').value = {
    richText: [
      { text: '检验结果：' },
      { text: '合格', font: { bold: true } },
    ],
  };
  ws.getCell('B8').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };

  // 同格多段标记 + 静态文本混排（宣传亮点用例）
  ws.getCell('A9').value = '环境';
  ws.getCell('B9').value = '${temp}℃ / ${humi}%';
  ws.getRow(9).height = 20;

  // 表格边框（含标题行以下全部区域）
  for (let r = 1; r <= 9; r++) {
    for (const col of ['A', 'B']) {
      ws.getCell(`${col}${r}`).border = THIN_BORDER;
    }
  }
  await wb.xlsx.writeFile(basic);

  // ============ Pro 标记模板（image 标记 → 应抛 Pro 引导错误） ============
  const wb2 = new ExcelJS.Workbook();
  const ws2 = wb2.addWorksheet('Pro');
  ws2.getCell('A1').value = '${photo|image_w100}';
  await wb2.xlsx.writeFile(proMarker);

  // ============ 明细行模板（#数组.字段 → 应抛 Pro 引导错误） ============
  const wb3 = new ExcelJS.Workbook();
  const ws3 = wb3.addWorksheet('Pro');
  ws3.getCell('A1').value = '${#items.name}';
  await wb3.xlsx.writeFile(detailRow);

  // ============ 扩展插件模板（自定义标记类型 upper + 解析器字段 virt） ============
  const wb4 = new ExcelJS.Workbook();
  const ws4 = wb4.addWorksheet('Ext');
  ws4.getCell('A1').value = '${code|upper}';
  ws4.getCell('A2').value = '${virt}';
  await wb4.xlsx.writeFile(extMarker);

  // ============ 自定义语法模板（{{...}} + 分隔符 ::） ============
  const wb5 = new ExcelJS.Workbook();
  const ws5 = wb5.addWorksheet('Custom');
  ws5.getCell('A1').value = '{{name}}';
  ws5.getCell('A2').value = '{{note::text_default:--}}';
  await wb5.xlsx.writeFile(customSyntax);

  return { basic, proMarker, detailRow, extMarker, customSyntax };
}