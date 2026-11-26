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

/** 来源摘要（长 URL/base64 截断，避免告警文案膨胀） */
function sourceBrief(fieldValue) {
  const s = String(fieldValue);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

/**
 * Data URL 严格形式：前缀限定 image/<mime>;base64,，负载限定 base64 字母表。
 * 不用宽松的 Buffer.from(str, 'base64') 直解——它会把 `" onerror="` 这类尾部
 * 非法字符静默丢弃，于是“合法图片前缀 + 属性尾巴”既能通过内容校验，
 * 又会被原样拼进 <img src>，形成属性注入。
 */
const DATA_URL_RE = /^data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i;

/** 单图解码上限：避免超大 base64 在解码/解析阶段把进程内存放大 */
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

/** 降级告警：同时写调用级收集数组与控制台（深导入直调时可能没有 warnings） */
function warnDegrade(warnings, msg) {
  console.warn(msg);
  if (warnings) warnings.push(msg);
}

/**
 * 图片内容校验：image-size 能解析出宽高 = 魔数与结构有效（不盲信 content-type/扩展名）。
 * 损坏/非图片内容降级为 null（清除标记）+ 告警，不抛错——报表业务不因单图损坏整单失败。
 * warnings 为调用级收集数组（可选，缺省仅 console 告警，兼容深导入直调）
 */
function checkImageContent(buf, fieldValue, warnings) {
  try {
    const meta = sizeOf(buf);
    if (meta && meta.width && meta.height) return true;
  } catch (_) { /* 解析失败按损坏处理 */ }
  const msg = `[engine] 图片内容损坏或不是有效图片，已按空值降级: ${sourceBrief(fieldValue)}`;
  warnDegrade(warnings, msg);
  return false;
}

/**
 * 内容校验的对外形式（商业版本地路径/远程 URL 分支复用）：
 * 魔数与结构有效才算图片，否则告警并返回 false。
 *
 * @param {Buffer} buf
 * @param {string} source - 告警里的来源摘要（路径/URL/前缀）
 * @param {string[]} [warnings]
 * @returns {boolean}
 */
export function isValidImageBuffer(buf, source, warnings) {
  return checkImageContent(buf, source, warnings);
}

/**
 * 严格解析 data URL 并用重编码结果替换原串：
 * 校验（魔数/结构）只说明前若干字节像图片，不能证明整个字符串没夹带；
 * 只有重新 base64 编码解码后的 Buffer，才能保证落进 HTML 属性的是干净负载。
 *
 * @param {string} fieldValue
 * @param {string[]} [warnings]
 * @returns {string|null} 规范化后的 data URL；格式或内容不合法返回 null
 */
export function normalizeImageDataUrl(fieldValue, warnings) {
  const s = String(fieldValue);
  const m = DATA_URL_RE.exec(s);
  if (!m) {
    warnDegrade(warnings, `[engine] 图片 Data URL 格式非法（仅支持 data:image/*;base64,）已按空值降级: ${sourceBrief(s)}`);
    return null;
  }
  const mime = m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase();
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) {
    warnDegrade(warnings, `[engine] 图片 Data URL 负载为空，已按空值降级: ${sourceBrief(s)}`);
    return null;
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    warnDegrade(warnings, `[engine] 图片超过 ${MAX_IMAGE_BYTES} 字节上限，已按空值降级: ${sourceBrief(s)}`);
    return null;
  }
  if (!checkImageContent(buf, s, warnings)) return null;
  return `data:image/${mime};base64,${buf.toString('base64')}`;
}

/**
 * 根据字段值和配置，解析图片为 base64 Data URL
 *
 * @param {string} fieldValue - 字段值（base64/URL/文本）
 * @param {Object} option - 标记配置
 * @param {string[]} [warnings] - 调用级降级告警收集数组（可选）
 * @returns {Promise<string|null>}
 */
export async function resolveImage(fieldValue, option, warnings) {
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
    // base64 Data URL：严格格式 + 内容校验 + 重编码，坏魔数/截断/夹带尾巴一律降级
    if (fieldValue.startsWith('data:image/')) {
      return normalizeImageDataUrl(fieldValue, warnings);
    }

    // HTTP(S) URL：下载后按内容校验，不盲信响应 content-type
    if (/^https?:\/\//i.test(fieldValue)) {
      const response = await httpGetBuffer(fieldValue, '远程图片');
      const buf = Buffer.from(response.data);
      if (!checkImageContent(buf, fieldValue, warnings)) return null;
      const contentType = response.headers['content-type'] || 'image/png';
      const ext = contentType.split('/')[1] || 'png';
      return bufferToDataUrl(buf, ext);
    }

    // 本地文件路径：读取失败不再静默吞掉，同样记告警
    try {
      const absPath = path.isAbsolute(fieldValue) ? fieldValue : path.resolve(fieldValue);
      if (fs.existsSync(absPath)) {
        const buf = fs.readFileSync(absPath);
        if (!checkImageContent(buf, fieldValue, warnings)) return null;
        const ext = path.extname(fieldValue).slice(1) || 'png';
        return bufferToDataUrl(buf, ext);
      }
    } catch (err) {
      const msg = `[engine] 图片文件读取失败，已按空值降级: ${sourceBrief(fieldValue)}（${err.message}）`;
      console.warn(msg);
      if (warnings) warnings.push(msg);
      return null;
    }

    // 不支持的值（占位符如 "--"、"/" 静默跳过）
    if (fieldValue && !/^[\-/]+$/.test(fieldValue)) {
      const msg = `[engine] 不支持的图片值: ${fieldValue}`;
      console.warn(msg);
      if (warnings) warnings.push(msg);
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
 * @param {string[]} [warnings] - 调用级降级告警收集数组（可选；缓存命中时不重复告警）
 * @returns {Promise<string|null>}
 */
export async function resolveImageCached(cache, fieldValue, option, warnings) {
  // 已是 base64 时无外部开销，且做 key 会白白多存一份大字串
  if (typeof fieldValue === 'string' && fieldValue.startsWith('data:image/')) {
    return resolveImage(fieldValue, option, warnings);
  }

  const key = `${option.type}|${option.width}|${option.height}|${fieldValue}`;
  if (!cache.has(key)) {
    // 缓存 Promise 而非结果：同 key 并发调用共享同一次下载/编码，
    // 避免 await 窗口内重复下载（引擎当前逐格串行，接缝/插件并行化时即触发）
    cache.set(key, resolveImage(fieldValue, option, warnings));
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
        const m = DATA_URL_RE.exec(String(img.dataUrl));
        const meta = m ? sizeOf(Buffer.from(m[2], 'base64')) : null;
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