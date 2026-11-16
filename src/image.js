/**
 * 图片值解析与社区版尺寸归一（社区版内置，自商业版同源迁入解析/缓存部分）。
 * 解析/缓存不依赖 sharp；尺寸归一用纯 JS image-size（按原图像素 @96DPI）。
 * 压缩优化与 DPI 感知归一（sharp 管线）仍由商业版经 seams.optimizeImages 注入；
 * 未注入时核心以 normalizeImageSizes 兜底，保证未设宽高的嵌入图可见。
 */
import path from 'node:path';
import fs from 'node:fs';
import sizeOf from 'image-size';
import { httpGetBuffer } from './utils.js';
import { generateCode, bufferToDataUrl } from './barcode.js';

/**
 * 根据字段值和配置，解析图片为 base64 Data URL
 *
 * @param {string} fieldValue - 字段值（base64/URL/文本）
 * @param {Object} option - 标记配置
 * @returns {Promise<string|null>}
 */
export async function resolveImage(fieldValue, option) {
  const type = option.type;

  // 条形码/二维码：将文本编码为图片
  if (type === 'barcode' || type === 'qrcode') {
    return generateCode(type, String(fieldValue), {
      width: option.width || 100,
      height: option.height || 20,
    });
  }

  // 图片类型：fieldValue 可能是 base64 / URL
  if (type === 'image' || type === 'img') {
    // base64 Data URL
    if (fieldValue.startsWith('data:image/')) {
      return fieldValue; // 直接使用
    }

    // HTTP(S) URL
    if (/^https?:\/\//i.test(fieldValue)) {
      const response = await httpGetBuffer(fieldValue, '远程图片');
      const contentType = response.headers['content-type'] || 'image/png';
      const ext = contentType.split('/')[1] || 'png';
      return bufferToDataUrl(Buffer.from(response.data), ext);
    }

    // 本地文件路径
    try {
      const absPath = path.isAbsolute(fieldValue) ? fieldValue : path.resolve(fieldValue);
      if (fs.existsSync(absPath)) {
        const buf = fs.readFileSync(absPath);
        const ext = path.extname(fieldValue).slice(1) || 'png';
        return bufferToDataUrl(buf, ext);
      }
    } catch (_) { /* ignore */ }

    // 不支持的值（占位符如 "--"、"/" 静默跳过）
    if (fieldValue && !/^[\-/]+$/.test(fieldValue)) {
      console.warn(`[engine] 不支持的图片值: ${fieldValue}`);
    }
    return null;
  }

  return null;
}

/**
 * resolveImage 的缓存层：相同值 + 相同尺寸只下载/编码一次
 *
 * @param {Map} cache
 * @param {string} fieldValue
 * @param {Object} option
 * @returns {Promise<string|null>}
 */
export async function resolveImageCached(cache, fieldValue, option) {
  // 已是 base64 时无外部开销，且做 key 会白白多存一份大字串
  if (typeof fieldValue === 'string' && fieldValue.startsWith('data:image/')) {
    return resolveImage(fieldValue, option);
  }

  const key = `${option.type}|${option.width}|${option.height}|${fieldValue}`;
  if (!cache.has(key)) {
    cache.set(key, await resolveImage(fieldValue, option));
  }
  return cache.get(key);
}

/**
 * 社区版尺寸归一兜底（无商业版 sharp 管线时）：
 * width/height 为 0（未设置）的嵌入图按原图像素尺寸换算 CSS 像素（@96DPI，cssScale=1），
 * 只设一边时另一边按原图宽高比例；解析失败兜底历史默认 100×20，避免 0×0 不可见。
 * 不做压缩、不做 DPI 感知（二者留商业版 sharp 管线）。
 *
 * @param {Array} cells - CellModel 数组
 */
export async function normalizeImageSizes(cells) {
  for (const cell of cells) {
    if (!cell.images || cell.images.length === 0) continue;
    for (const img of cell.images) {
      if (!img.dataUrl) continue;
      if (img.width > 0 && img.height > 0) continue;
      let size = null;
      try {
        const commaIdx = img.dataUrl.indexOf(',');
        const buf = Buffer.from(img.dataUrl.slice(commaIdx + 1), 'base64');
        const meta = sizeOf(buf);
        if (meta && meta.width && meta.height) size = { width: meta.width, height: meta.height };
      } catch (_) { /* ignore */ }
      if (size) {
        if (img.width > 0) {
          img.height = Math.max(1, Math.round((img.width * size.height) / size.width));
        } else if (img.height > 0) {
          img.width = Math.max(1, Math.round((img.height * size.width) / size.height));
        } else {
          img.width = Math.max(1, size.width);
          img.height = Math.max(1, size.height);
        }
      } else {
        if (!(img.width > 0)) img.width = 100;
        if (!(img.height > 0)) img.height = 20;
      }
    }
  }
}