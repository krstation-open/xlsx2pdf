import axios from 'axios';
import path from 'node:path';
import fs from 'node:fs';

// ============================================================
// 远程下载安全限制：防慢速拖死/超大响应打爆内存（SSRF 面由服务侧出口策略兜底）
export const IMAGE_HTTP_OPTIONS = {
  timeout: 30000,
  maxContentLength: 20 * 1024 * 1024,
  maxBodyLength: 20 * 1024 * 1024,
};

/**
 * 把 axios 原始错误翻译成中文友好报错（统一带 [xlsx2pdf] 前缀，便于服务侧识别）
 * @param {Error} err - axios 抛出的错误
 * @param {string} url - 请求地址（附在报错里便于定位）
 * @param {string} scene - 场景描述，如「模板文件」「远程图片」
 * @returns {Error}
 */
function toFriendlyHttpError(err, url, scene) {
  const msg = err?.message || '';
  if (/maxContentLength|maxBodyLength/.test(msg)) {
    const limitMB = IMAGE_HTTP_OPTIONS.maxContentLength / 1024 / 1024;
    return new Error(`[xlsx2pdf] ${scene}下载失败：文件超过 ${limitMB}MB 下载上限，URL: ${url}`);
  }
  if (err?.code === 'ECONNABORTED' || /timeout/i.test(msg)) {
    return new Error(`[xlsx2pdf] ${scene}下载超时（${IMAGE_HTTP_OPTIONS.timeout / 1000} 秒），URL: ${url}`);
  }
  const status = err?.response?.status;
  if (status) {
    return new Error(`[xlsx2pdf] ${scene}下载失败：HTTP ${status}，URL: ${url}`);
  }
  if (err?.code) {
    return new Error(`[xlsx2pdf] ${scene}下载失败：网络错误 ${err.code}，URL: ${url}`);
  }
  return new Error(`[xlsx2pdf] ${scene}下载失败：${msg}，URL: ${url}`);
}

/**
 * 带限制与中文错误包装的远程资源下载（模板/图片共用）
 * @param {string} url - http(s) 地址
 * @param {string} scene - 场景描述（用于报错文案）
 * @returns {Promise<import('axios').AxiosResponse>} responseType 为 arraybuffer 的响应
 */
export async function httpGetBuffer(url, scene = '远程资源') {
  try {
    return await axios.get(url, { responseType: 'arraybuffer', ...IMAGE_HTTP_OPTIONS });
  } catch (err) {
    throw toFriendlyHttpError(err, url, scene);
  }
}

// ============================================================
// 对象展平
// ============================================================

/**
 * 把嵌套对象拍平为以 . 连接的扁平 key
 * 如 { a: { b: 1 } } → { 'a.b': 1 }
 * 数组也按下标拍入，如 { a: [{ b: 1 }] } → { 'a.0.b': 1 }
 * @param {Object} obj
 * @param {string} prefix
 * @returns {Object}
 */
export function flattenObject(obj, prefix = '') {
  const result = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value)) {
      Object.assign(result, flattenObject(value, newKey));
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item !== null && typeof item === 'object') {
          Object.assign(result, flattenObject(item, `${newKey}.${index}`));
        } else {
          result[`${newKey}.${index}`] = item;
        }
      });
    } else {
      result[newKey] = value;
    }
  }
  return result;
}

// ============================================================
// 远程文件下载
// ============================================================

/**
 * 从本地路径 / URL / base64 获取文件 Buffer
 * 支持：本地路径 / http(s) URL / base64 字符串 / 已经是 Buffer
 *
 * base64 支持两种格式：
 *   - 纯 base64：UEsDBBQ...
 *   - Data URL：data:application/...;base64,UEsDBBQ...
 *
 * @param {string|Buffer} source
 * @returns {Promise<Buffer>}
 */
export async function getFileBuffer(source) {
  // 已经是 Buffer
  if (Buffer.isBuffer(source)) {
    return source;
  }

  // Data URL（data:...;base64,...）
  if (typeof source === 'string' && /^data:[^;]+;base64,/i.test(source)) {
    const base64 = source.replace(/^data:[^;]+;base64,/i, '');
    return Buffer.from(base64, 'base64');
  }

  // 远程 URL
  if (/^https?:\/\//i.test(source)) {
    const response = await httpGetBuffer(source, '模板文件');
    return Buffer.from(response.data);
  }

  // 纯 base64 字符串（非路径、非 URL 的长字符串，且解码后为有效 ZIP/PK 头）
  if (typeof source === 'string' && source.length > 200 && /^[A-Za-z0-9+/\r\n=]+$/.test(source)) {
    const buf = Buffer.from(source, 'base64');
    // Excel 本质是 ZIP 文件，前两字节为 PK（0x50, 0x4B）
    if (buf[0] === 0x50 && buf[1] === 0x4B) {
      return buf;
    }
  }

  // 本地路径
  const absPath = path.isAbsolute(source) ? source : path.resolve(source);
  return fs.promises.readFile(absPath);
}

// ============================================================
// 标记解析器
// ============================================================

/** 核心内置填充类型（仅 text；图片/条码/水印等增强类型由商业版经注册表注入） */
export const CONTENT_TYPES = ['text'];

/** 商业版增强标记类型：未注册时模板中出现即显式报错引导（不静默当文本渲染） */
export const PRO_MARKER_TYPES = ['image', 'img', 'barcode', 'qrcode', 'watermark'];

/**
 * 内置标记语法 ${...} 的匹配正则（默认值）。
 * 自定义语法时替换为自有正则，契约见 validateMarkerRegex
 */
export const DEFAULT_MARKER_REGEX = /\$\{([^}]+)\}/g;

/** 标记内部「字段 / 类型_参数」的分隔符（默认值），可经 markerSeparator 自定义 */
export const DEFAULT_MARKER_SEPARATOR = '|';

/**
 * 校验自定义标记正则（不合法直接抛错，避免模板静默不替换）。
 *
 * 契约（与内置正则一致）：
 *  - 必须带 g 标志（逐处匹配）
 *  - 捕获组 1 = 标记内部内容（即 `字段|类型_参数` 结构），match[0] = 完整标记原文（用于替换）
 *
 * @param {RegExp} regex
 */
export function validateMarkerRegex(regex) {
  if (!(regex instanceof RegExp)) {
    throw new Error('markerRegex 必须是 RegExp 实例，如 /\\{\\{([^}]+)\\}\\}/g');
  }
  if (!regex.global) {
    throw new Error('markerRegex 必须带 g 标志（需逐处匹配全部标记）');
  }
  // 用捕获组 1 取标记内部内容；无捕获组则永远取不到字段，直接拒绝
  if (!/\(/.test(regex.source)) {
    throw new Error('markerRegex 必须含至少一个捕获组（捕获组 1 = 标记内部内容）');
  }
}

/**
 * 解析标记配置字符串
 *
 * 语法: ${字段名|type_w100_h80_默认:默认值}（_default: / _dft: 为同义别名）
 *
 * 示例:
 *   ${姓名}                        → { field:'姓名', type:'text' }
 *   ${姓名|text_默认:未知}           → { field:'姓名', type:'text', defaultValue:'未知' }
 *   ${姓名|text_default:未知}       → 同上（default 别名）
 *
 * @param {string} optionStr - 配置字符串（| 之后的部分，不含字段名）
 * @param {string[]} [knownTypes] - 可识别的类型 token（默认内置类型；含注册表自定义类型时由 engine 传入）
 * @returns {{ type: string, width?: number, height?: number, offsetX?: number, offsetY?: number, zIndex?: number, opacity?: number, minSize?: number, lineHeight?: number, defaultValue?: string }}
 *   自定义标记类型的扩展键（如 format:xxx）以原始键名透传在返回对象上
 * @throws {Error} 出现未注册的增强标记类型（image/img/barcode/qrcode/watermark）时引导商业版
 */
export function parseMarkerOption(optionStr = '', knownTypes = CONTENT_TYPES) {
  const option = { type: 'text' };
  if (!optionStr) return option;

  // 用 _ 分割，但 _默认: 后面的内容整体作为默认值
  let remaining = optionStr;

  // 先提取默认值（必须是最后一个 _default:xxx / _默认:xxx / _dft:xxx）
  const defaultRegex = /_(?:default|默认|dft):(.+)$/;
  const defaultMatch = remaining.match(defaultRegex);
  if (defaultMatch) {
    option.defaultValue = defaultMatch[1];
    // 移除默认值部分（保留前面的内容继续解析）
    remaining = remaining.slice(0, remaining.lastIndexOf(defaultMatch[0]));
  }

  // 按 _ 分割剩余部分
  const parts = remaining.split('_').filter(Boolean);
  if (parts.length === 0) return option;

  // 第一个部分可能是类型：未注册的增强类型显式引导商业版，已注册类型正常消费
  if (PRO_MARKER_TYPES.includes(parts[0]) && !knownTypes.includes(parts[0])) {
    throw new Error(
      `[xlsx2pdf] 标记类型 "${parts[0]}"（图片/条码/二维码/水印）是商业版 Pro 能力，` +
      '社区版仅支持 text 文本标记。商业版咨询：business@krstation.com'
    );
  }
  if (knownTypes.includes(parts[0])) {
    option.type = parts.shift();
  }

  // 解析剩余部分中的键值对（字母+数字）
  for (const part of parts) {
    const match = /^([a-z]+)(-?\d+(\.\d+)?)$/i.exec(part);
    if (!match) continue;

    const key = match[1];
    const value = +match[2];

    switch (key) {
      case 'w': option.width = value; break;
      case 'h': option.height = value; break;
      case 'ox': option.offsetX = value; break;
      case 'oy': option.offsetY = value; break;
      case 'zindex': option.zIndex = value; break;
      case 'opacity': option.opacity = value; break;
      case 'minsize': option.minSize = value; break;
      case 'lineheight': option.lineHeight = value; break;
    }
  }

  // 自定义标记类型的扩展键：key:value 形式透传（如 datefmt_format:YYYY年）；
  // 不含冒号的未识别部分维持原行为丢弃，内置类型行为零变化
  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx <= 0) continue;
    const key = part.slice(0, colonIdx);
    if (option[key] !== undefined) continue; // 已解析的内置键优先
    option[key] = part.slice(colonIdx + 1);
  }

  return option;
}

/**
 * 解析完整的单元格标记文本，提取所有占位符
 * 返回结构化数组
 *
 * @param {string} cellText - 单元格原始文本
 * @param {string[]} [knownTypes] - 可识别的类型 token（透传给 parseMarkerOption）
 * @param {RegExp} [markerRegex] - 标记匹配正则（默认内置 ${...}；自定义语法时传入，契约见 validateMarkerRegex）
 * @param {string} [markerSeparator] - 标记内部「字段 / 类型_参数」分隔符（默认 |，仅取首次出现处切分）
 * @returns {Array<{ raw: string, field: string, option: Object }>}
 */
export function parseCellMarkers(cellText, knownTypes, markerRegex = DEFAULT_MARKER_REGEX, markerSeparator = DEFAULT_MARKER_SEPARATOR) {
  const markers = [];
  // 每次新建正则实例：g 标志正则的 lastIndex 有状态，若前次解析中途抛错
  // （如增强标记引导）会残留偏移，复用模块级实例将导致后续调用标记漏检
  const regex = new RegExp(markerRegex.source, markerRegex.flags);
  let match;

  while ((match = regex.exec(cellText)) !== null) {
    const raw = match[0];               // 完整标记如 ${姓名|text_默认:未知}
    const inner = match[1];             // 标记内部内容: 姓名|text_默认:未知
    const sepIdx = inner.indexOf(markerSeparator);
    const field = sepIdx === -1 ? inner : inner.slice(0, sepIdx);
    const optionStr = sepIdx === -1 ? '' : inner.slice(sepIdx + markerSeparator.length);
    const option = parseMarkerOption(optionStr, knownTypes);

    markers.push({ raw, field, option });
  }

  return markers;
}