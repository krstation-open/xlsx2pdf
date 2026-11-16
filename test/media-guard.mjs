/**
 * 社区版富媒体守卫（image/img/barcode/qrcode 基础形态下放后的回归基线）
 *
 * 覆盖：image 未设宽高归一(image-size@96DPI) / 只设一边按比例 / barcode(code128) /
 * qrcode / zIndex+opacity 浮层 / 空值清除标记 / helpers.generateCode/bufferToDataUrl /
 * 产物无脚本注入 / excel2pdf 全链路（有浏览器时）。
 * 运行：node test/media-guard.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { excel2html, excel2pdf, helpers, configure, closeBrowser } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'output');
fs.mkdirSync(outDir, { recursive: true });

// 1×1 透明 PNG（尺寸归一用例的原图）
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// 现场生成富媒体模板（不复制私有模板）
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Media');
ws.getColumn(1).width = 45;
ws.getCell('A1').value = '${photo|image}';                 // 未设宽高 → 原图尺寸归一
ws.getCell('A2').value = '${photo|image_w60}';            // 只设宽 → 高按比例
ws.getCell('A3').value = '${code|barcode_w120_h40}';      // 条形码
ws.getCell('A4').value = '${qr|qrcode_w80_h80}';          // 二维码
ws.getCell('A5').value = '${photo|image_w50_zindex2_opacity0.5}'; // 浮层
ws.getCell('A6').value = '${empty|image}';                // 空值 → 清除
const tpl = path.join(outDir, 'tpl-media.xlsx');
await wb.xlsx.writeFile(tpl);

const DATA = { photo: PNG, code: 'KR-2026-0001', qr: 'https://www.krstation.com/', empty: '' };

try {
  const { html } = await excel2html({ template: tpl, data: DATA });
  const imgCount = (html.match(/<img/g) || []).length;
  assert.ok(imgCount >= 4, `应嵌入 ≥4 张图（image×3 + barcode + qrcode，空值清除），实际 ${imgCount}`);
  assert.ok(html.includes('data:image/png'), '条码/二维码/图片 dataUrl 嵌入');
  assert.ok(html.includes('z-index:2'), 'zIndex 浮层生效');
  assert.ok(html.includes('opacity:0.5'), 'opacity 浮层生效');
  assert.ok(!html.includes('${'), '标记全部清除');
  assert.ok(!html.includes('<script'), '社区版产物无脚本注入');
  console.log('  ✓ image/barcode/qrcode 嵌入 + 浮层 + 空值清除 + 无脚本');

  // helpers：条码生成与 Buffer→DataUrl（社区版同源）
  const codeUrl = await helpers.generateCode('barcode', 'KR-2026-0001', { width: 120, height: 40 });
  assert.ok(codeUrl.startsWith('data:image/png;base64,'), 'helpers.generateCode 返回 PNG DataUrl');
  const qrUrl = await helpers.generateCode('qrcode', 'https://www.krstation.com/');
  assert.ok(qrUrl.startsWith('data:image/png;base64,'), 'helpers.generateCode qrcode');
  assert.ok(helpers.bufferToDataUrl(Buffer.from([1, 2, 3]), 'png').startsWith('data:image/png;base64,'), 'helpers.bufferToDataUrl');
  await assert.rejects(() => helpers.generateCode('pdf417', 'x'), /不支持的条码类型/, '非法条码类型拒绝');
  console.log('  ✓ helpers.generateCode / bufferToDataUrl');

  // excel2pdf 全链路（复用 pro 内置 Chrome，避免重复下载；缺失则跳过）
  const proChrome = path.resolve(here, '../../xlsx2pdf-pro/browsers/chrome/win64-135.0.7049.114/chrome-win64/chrome.exe');
  if (fs.existsSync(proChrome)) {
    configure({ browserPath: proChrome });
    const { pdf } = await excel2pdf({ template: tpl, data: DATA });
    assert.ok(Buffer.isBuffer(pdf) && pdf.subarray(0, 5).toString() === '%PDF-', 'PDF 魔数');
    assert.ok(pdf.length > 1000, 'PDF 非空');
    fs.writeFileSync(path.join(outDir, 'out-media.pdf'), pdf);
    console.log(`  ✓ excel2pdf 富媒体全链路（${(pdf.length / 1024).toFixed(1)}KB → test/output/out-media.pdf）`);
  } else {
    console.warn('  ⚠ 跳过 excel2pdf：未找到可复用浏览器');
  }

  console.log('[media-guard] 社区版富媒体守卫全部通过');
} finally {
  await closeBrowser();
}