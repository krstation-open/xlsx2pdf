import axios from 'axios';
import path from 'node:path';
import fs from 'node:fs';
import { xlsxError } from './errors.js';

// ============================================================
// 远程下载安全限制：防慢速拖死/超大响应打爆内存（SSRF 面由服务侧出口策略兜底）
export const IMAGE_HTTP_OPTIONS = {
  timeout: 30000,
  maxContentLength: 20 * 1024 * 1024,
  maxBodyLength: 20 * 1024 * 1024,
};

/**
 * 把 axios 原始错误翻译成中文友好报错（统一带 [xlsx2pdf] 前缀，便于服务侧识别），
 * 携带稳定错误码（E_DOWNLOAD_*）并追加英文
 * @param {Error} err - axios 抛出的错误
 * @param {string} url - 请求地址（附在报错里便于定位）
 * @param {string} scene - 场景描述，如「模板文件」「远程图片」
 * @returns {import('./errors.js').Xlsx2pdfError}
 */
function toFriendlyHttpError(err, url, scene) {
  const msg = err?.message || '';
  if (/maxContentLength|maxBodyLength/.test(msg)) {
    const limitMB = IMAGE_HTTP_OPTIONS.maxContentLength / 1024 / 1024;
    return xlsxError('E_DOWNLOAD_SIZE',
      `[xlsx2pdf] ${scene}下载失败：文件超过 ${limitMB}MB 下载上限，URL: ${url}`,
      `Failed to download ${scene}: file exceeds the ${limitMB}MB download cap. URL: ${url}`);
  }
  if (err?.code === 'ECONNABORTED' || /timeout/i.test(msg)) {
    return xlsxError('E_DOWNLOAD_TIMEOUT',
      `[xlsx2pdf] ${scene}下载超时（${IMAGE_HTTP_OPTIONS.timeout / 1000} 秒），URL: ${url}`,
      `Download of ${scene} timed out (${IMAGE_HTTP_OPTIONS.timeout / 1000}s). URL: ${url}`);
  }
  const status = err?.response?.status;
  if (status) {
    return xlsxError('E_DOWNLOAD_HTTP',
      `[xlsx2pdf] ${scene}下载失败：HTTP ${status}，URL: ${url}`,
      `Failed to download ${scene}: HTTP ${status}. URL: ${url}`);
  }
  if (err?.code) {
    return xlsxError('E_DOWNLOAD_NETWORK',
      `[xlsx2pdf] ${scene}下载失败：网络错误 ${err.code}，URL: ${url}`,
      `Failed to download ${scene}: network error ${err.code}. URL: ${url}`);
  }
  return xlsxError('E_DOWNLOAD_NETWORK',
    `[xlsx2pdf] ${scene}下载失败：${msg}，URL: ${url}`,
    `Failed to download ${scene}: ${msg}. URL: ${url}`);
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

// ============================================================
// 模板跨调用缓存（opt-in 有界 LRU，configure({ templateCacheMB }) 开启）
// ============================================================

/** 缓存条目 Map（key → {buf, bytes, at}）；插入序即 LRU 序（命中时 delete+set 刷新） */
const templateCache = new Map();
let templateCacheBytes = 0;
const TEMPLATE_URL_TTL_MS = 60000;

function templateCacheBudget() {
  // 惰性读配置：避免 utils ↔ browser 循环依赖（browser 不 import utils）
  try {
    // eslint-disable-next-line no-undef
    return (globalThis.__xlsx2pdfTemplateCacheMB ?? 0);
  } catch (_) { return 0; }
}

/** 供 browser.configure 同步缓存预算（解耦循环依赖的轻量信号面） */
export function setTemplateCacheBudget(mb) {
  globalThis.__xlsx2pdfTemplateCacheMB = mb;
  if (!(mb > 0)) { templateCache.clear(); templateCacheBytes = 0; }
}

function cacheGet(key, ttlMs) {
  const hit = templateCache.get(key);
  if (!hit) return null;
  if (ttlMs && Date.now() - hit.at > ttlMs) { templateCache.delete(key); templateCacheBytes -= hit.bytes; return null; }
  templateCache.delete(key); templateCache.set(key, hit);
  return hit.buf;
}

function cachePut(key, buf, budgetMB) {
  if (!(budgetMB > 0)) return;
  const bytes = buf.length;
  if (bytes > budgetMB * 1024 * 1024) return; // 单条目超预算不入缓存
  if (templateCache.has(key)) { templateCacheBytes -= templateCache.get(key).bytes; templateCache.delete(key); }
  templateCache.set(key, { buf, bytes, at: Date.now() });
  templateCacheBytes += bytes;
  while (templateCacheBytes > budgetMB * 1024 * 1024 && templateCache.size > 1) {
    const oldest = templateCache.keys().next().value;
    templateCacheBytes -= templateCache.get(oldest).bytes;
    templateCache.delete(oldest);
  }
}

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

  const budgetMB = templateCacheBudget();

  // 远程 URL（缓存带 TTL，避免长期持有过期模板）
  if (/^https?:\/\//i.test(source)) {
    const cached = cacheGet(`url:${source}`, TEMPLATE_URL_TTL_MS);
    if (cached) return cached;
    const response = await httpGetBuffer(source, '模板文件');
    const buf = Buffer.from(response.data);
    cachePut(`url:${source}`, buf, budgetMB);
    return buf;
  }

  // 纯 base64 字符串（非路径、非 URL 的长字符串，且解码后为有效 ZIP/PK 头）
  if (typeof source === 'string' && source.length > 200 && /^[A-Za-z0-9+/\r\n=]+$/.test(source)) {
    const buf = Buffer.from(source, 'base64');
    // Excel 本质是 ZIP 文件，前两字节为 PK（0x50, 0x4B）
    if (buf[0] === 0x50 && buf[1] === 0x4B) {
      return buf;
    }
  }

  // 本地路径（缓存 key 带 mtime+size，模板更新自动失效）
  const absPath = path.isAbsolute(source) ? source : path.resolve(source);
  let key = null;
  if (budgetMB > 0) {
    try {
      const st = await fs.promises.stat(absPath);
      key = `file:${absPath}:${st.mtimeMs}:${st.size}`;
      const cached = cacheGet(key, 0);
      if (cached) return cached;
    } catch (_) { key = null; }
  }
  const buf = await fs.promises.readFile(absPath);
  if (key) cachePut(key, buf, budgetMB);
  return buf;
}

// ============================================================
// 标记解析器
// ============================================================

/** 核心内置规范标记类型（解析默认识别面；与 engine 内置注册保持同步） */
export const CONTENT_TYPES = ['text', 'image', 'barcode', 'qrcode', 'watermark'];

/** 内置默认标记类型别名（img/print 历史别名；markerAliases 替换式配置，null 恢复本表、{} 清空） */
export const DEFAULT_MARKER_ALIASES = { img: 'image', print: 'watermark' };

/** 解析默认识别 token：内置规范类型 + 默认别名 keys */
const DEFAULT_KNOWN_TYPES = [...CONTENT_TYPES, ...Object.keys(DEFAULT_MARKER_ALIASES)];

/** 商业版独占标记类型引导名单：富媒体基础形态（image/barcode/qrcode/watermark）自 1.7.0 已内置社区版，
 * 当前为空；机制保留——未来 Pro 独占类型加入本表后，未注册时模板中出现即显式报错引导（不静默当文本渲染） */
export const PRO_MARKER_TYPES = [];

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
    throw xlsxError('E_MARKER_REGEX',
      'markerRegex 必须是 RegExp 实例，如 /\\{\\{([^}]+)\\}\\}/g',
      'markerRegex must be a RegExp instance, e.g. /\\{\\{([^}]+)\\}\\}/g.');
  }
  if (!regex.global) {
    throw xlsxError('E_MARKER_REGEX',
      'markerRegex 必须带 g 标志（需逐处匹配全部标记）',
      'markerRegex must carry the g flag (every marker occurrence must be matched).');
  }
  // 用捕获组 1 取标记内部内容；无捕获组则永远取不到字段，直接拒绝
  if (!/\(/.test(regex.source)) {
    throw xlsxError('E_MARKER_REGEX',
      'markerRegex 必须含至少一个捕获组（捕获组 1 = 标记内部内容）',
      'markerRegex must contain at least one capture group (group 1 = marker inner content).');
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
 * @param {string[]} [knownTypes] - 可识别的类型 token（默认内置规范类型 + 默认别名；含注册表自定义类型与生效别名时由 engine 传入）
 * @param {Object<string,string>} [aliases] - 生效别名映射（别名 token → 规范类型名；默认内置 img/print）
 * @returns {{ type: string, width?: number, height?: number, offsetX?: number, offsetY?: number, zIndex?: number, opacity?: number, minSize?: number, lineHeight?: number, defaultValue?: string }}
 *   自定义标记类型的扩展键（如 format:xxx）以原始键名透传在返回对象上
 * @throws {Error} 内置默认别名（img/print）被禁用且未注册专属类型时抛 E_MARKER_ALIAS（不静默降级文本）
 */
export function parseMarkerOption(optionStr = '', knownTypes = DEFAULT_KNOWN_TYPES, aliases = DEFAULT_MARKER_ALIASES) {
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

  // 第一个部分可能是类型：未注册的 Pro 独占类型显式引导商业版，已注册类型正常消费
  // （富媒体基础形态自 1.7.0 已内置社区版，PRO_MARKER_TYPES 当前为空，机制保留）
  if (PRO_MARKER_TYPES.includes(parts[0]) && !knownTypes.includes(parts[0])) {
    throw xlsxError('E_MARKER_PRO',
      `[xlsx2pdf] 标记类型 "${parts[0]}" 是商业版 Pro 能力，社区版不提供。商业版咨询：business@krstation.com`,
      `Marker type "${parts[0]}" is a Pro capability and is not available in the community edition. Pro inquiries: business@krstation.com`);
  }
  // 内置默认别名（img/print）被禁用且未注册专属类型：显式报错引导，
  // 不静默降级文本（历史缺陷：别名移除后水印语义丢失无告警）
  if (DEFAULT_MARKER_ALIASES[parts[0]] !== undefined && !knownTypes.includes(parts[0])
    && !(aliases && aliases[parts[0]] !== undefined)) {
    throw xlsxError('E_MARKER_ALIAS',
      `[xlsx2pdf] 标记类型 "${parts[0]}" 的内置别名已禁用（markerAliases）且未注册专属类型。` +
      '请经 use() 注册该类型，或恢复别名映射（configure({ markerAliases: null }) 恢复内置默认）',
      `The built-in alias for marker type "${parts[0]}" is disabled (markerAliases) and no dedicated type is registered. ` +
      'Register the type via use(), or restore the alias mapping (configure({ markerAliases: null }) restores the built-in defaults).');
  }
  if (knownTypes.includes(parts[0])) {
    const token = parts.shift();
    // 别名归一为规范类型名（插件注册的同名类型已在 engine 侧排除出映射，优先命中插件 handler）
    option.type = (aliases && aliases[token]) || token;
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
 * @param {Object<string,string>} [aliases] - 生效别名映射（透传给 parseMarkerOption；默认内置 img/print）
 * @returns {Array<{ raw: string, field: string, option: Object }>}
 */
export function parseCellMarkers(cellText, knownTypes, markerRegex = DEFAULT_MARKER_REGEX, markerSeparator = DEFAULT_MARKER_SEPARATOR, aliases = DEFAULT_MARKER_ALIASES) {
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
    const option = parseMarkerOption(optionStr, knownTypes, aliases);

    markers.push({ raw, field, option });
  }

  return markers;
}