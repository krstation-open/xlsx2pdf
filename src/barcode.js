/**
 * 条码/二维码生成与 Buffer→Data URL（社区版内置，自商业版同源迁入）。
 * 纯 JS 依赖 bwip-js，无 native 二进制；压缩/DPI 归一等生产增强仍由商业版 sharp 管线提供。
 */
import bwipjs from 'bwip-js';
import { xlsxError } from './errors.js';

/**
 * 生成条形码/二维码，返回 base64 Data URL
 *
 * @param {string} type - 'barcode' | 'qrcode'
 * @param {string} text - 要编码的文本
 * @param {Object} [opts]
 * @param {number} [opts.width] - 宽度 px
 * @param {number} [opts.height] - 高度 px
 * @returns {Promise<string>} base64 Data URL，如 data:image/png;base64,...
 */
export async function generateCode(type, text, opts = {}) {
  const bcidMap = {
    barcode: 'code128',
    qrcode: 'qrcode',
  };

  const bcid = bcidMap[type];
  if (!bcid) {
    throw xlsxError('E_CODE_TYPE',
      `不支持的条码类型: ${type}，可选: barcode, qrcode`,
      `Unsupported code type: ${type}; options: barcode, qrcode.`);
  }

  const buffer = await bwipjs.toBuffer({
    bcid,
    text,
    scale: 1,
    width: opts.width || 100,
    height: opts.height || 20,
    includetext: false,
    textxalign: 'center',
  });

  return `data:image/png;base64,${buffer.toString('base64')}`;
}

/**
 * 将图片 Buffer 转为 base64 Data URL
 * @param {Buffer} buffer
 * @param {string} extension - 图片扩展名 (png/jpeg/gif)
 * @returns {string}
 */
export function bufferToDataUrl(buffer, extension) {
  const mimeMap = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', gif: 'image/gif' };
  const mime = mimeMap[extension] || 'image/png';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}