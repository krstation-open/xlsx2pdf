/**
 * xlsx2pdf 入口（开源核心）
 *
 * API 面：
 *   excel2pdf({ template, data, option })  → { pdf, html }
 *   excel2html({ template, data, option }) → { html }（不启动浏览器）
 *   configure(opts)      外部浏览器路径 / headless / launchArgs
 *   ensureBrowser(opts?) 确保内置浏览器就绪（幂等，{ force } 强制重装）
 *   closeBrowser()       关闭单例浏览器
 *   use(plugin)          全局注册扩展插件（三层扩展点，见 registry.js）
 *   getVersion()         获取当前包版本
 *   helpers              扩展开发工具方法命名空间（引擎同源实现）
 *
 * 核心定位：文本类报表模板 → PDF 的完整通用链路，含自定义扩展能力
 * （use/plugins 三层扩展点、自定义标记语法）。
 * 生产化能力（数组多页批量、图片/条码/水印标记、单页自适应、精确列宽、
 * 自定义纸张、精确缩放、并发/内存护栏等）由商业版经内部接缝
 * 注册后启用；未注册时传入对应入参显式报错引导，不静默降级。
 */
import fs from 'node:fs';
import path from 'node:path';
import { processTemplate } from './engine.js';
import { renderHtml, renderTableFragment } from './render.js';
import { htmlToPdf, closeBrowser } from './pdf.js';
import { resolvePageSetup, isMeaningfulPageSize } from './pagesetup.js';
import { configure, ensureBrowser, getConfig, pkgRoot } from './browser.js';
import { getSeams, hasCapability } from './seams.js';
import { use } from './registry.js';
import { flattenObject, getFileBuffer, parseMarkerOption, validateMarkerRegex } from './utils.js';
import { formatValue } from './numfmt.js';
import { generateCode, bufferToDataUrl } from './barcode.js';
import { Xlsx2pdfError, xlsxError } from './errors.js';

/** 商业版 Pro 能力咨询方式（统一文案，见 README「社区版 vs Pro」） */
const PRO_CONTACT = '商业版咨询：business@krstation.com';
/** 英文报错中的同义咨询入口（邮箱与中文一致） */
const PRO_CONTACT_EN = 'Pro inquiries: business@krstation.com';

/**
 * 商业版 Pro 专属 option 键：能力未注册时传入任一项即显式报错引导（不静默忽略）。
 * 键 → [能力键, 能力说明（用于错误文案）]
 */
const PRO_OPTION_KEYS = {
  fitToPage: ['fit', '单页自适应（内容超页自动收敛不裁剪）'],
  minFontSize: ['fit', '自适应字号下限'],
  scale: ['scale', '精确缩放（1~400%）'],
  pageRotate: ['pageRotate', '横向 /Rotate 打印链路适配'],
  fontGuard: ['fontGuard', '默认字体缺失守卫'],
  maxCells: ['resourceGuards', '单元格数上限参数化'],
  maxTemplateSize: ['resourceGuards', '模板体积上限参数化'],
  maxConcurrency: ['resourceGuards', '渲染并发参数化'],
  memoryGuard: ['resourceGuards', '内存准入守卫'],
  emptyRowPlaceholders: ['emptyRowPlaceholders', '空行占位字符（自适应配套）'],
};

/**
 * 入参校验：核心默认仅支持单页对象数据 + 精简 option；
 * 商业版注册对应能力后放行。Pro 能力显式引导（转化入口），非法入参快速失败
 *
 * @param {Object} params - { template, data, option }
 */
function validateParams({ template, data, option = {} }) {
  if (template == null || template === '') {
    throw xlsxError('E_TEMPLATE_MISSING',
      '[xlsx2pdf] 缺少 template（Excel 模板路径 / URL / Buffer）',
      'Missing template (Excel template path / URL / Buffer).');
  }

  // data 数组多页批量为 Pro 能力；未注册时仅接受对象（缺省按空数据渲染一页）
  if (Array.isArray(data) && !hasCapability('arrayData')) {
    throw xlsxError('E_OPTION_PRO',
      '[xlsx2pdf] data 传数组（一份模板批量出多页）是商业版 Pro 能力，' +
      `社区版仅支持单页对象数据。${PRO_CONTACT}`,
      'Passing an array as data (batch multi-page from one template) is a Pro capability; the community edition supports single-page object data only. ' + PRO_CONTACT_EN);
  }
  if (data != null && typeof data !== 'object') {
    throw xlsxError('E_DATA_TYPE',
      `[xlsx2pdf] data 只接受对象，收到：${typeof data}`,
      `data must be an object, received: ${typeof data}.`);
  }

  // 对象型 pageSize（自定义纸张 {width,height}mm）为 Pro 能力
  if (isMeaningfulPageSize(option.pageSize) && typeof option.pageSize === 'object' && !hasCapability('customPaper')) {
    throw xlsxError('E_OPTION_PRO',
      '[xlsx2pdf] option.pageSize 传对象（自定义纸张宽高 mm）是商业版 Pro 能力，' +
      `社区版仅支持具名标准纸张。${PRO_CONTACT}`,
      'option.pageSize as an object (custom paper width/height in mm) is a Pro capability; the community edition supports named standard paper sizes only. ' + PRO_CONTACT_EN);
  }

  for (const [key, [cap, desc]] of Object.entries(PRO_OPTION_KEYS)) {
    if (option[key] !== undefined && !hasCapability(cap)) {
      throw xlsxError('E_OPTION_PRO',
        `[xlsx2pdf] option.${key}（${desc}）是商业版 Pro 能力，社区版不提供。${PRO_CONTACT}`,
        `option.${key} (${desc}) is a Pro capability and is not available in the community edition. ${PRO_CONTACT_EN}`);
    }
  }

  // 未知 option 键同样拒绝：拼错入参不应被静默忽略
  // （plugins/markerRegex/markerSeparator 为社区版扩展能力，恒放行）
  const ALLOWED_KEYS = ['pageSize', 'orientation', 'margin', 'defaults', 'plugins', 'markerRegex', 'markerSeparator'];
  for (const [key, [cap]] of Object.entries(PRO_OPTION_KEYS)) {
    if (hasCapability(cap)) ALLOWED_KEYS.push(key);
  }
  for (const key of Object.keys(option)) {
    if (!ALLOWED_KEYS.includes(key)) {
      throw xlsxError('E_OPTION_UNKNOWN',
        `[xlsx2pdf] 不支持的 option.${key}，社区版支持：${ALLOWED_KEYS.join(' / ')}`,
        `Unsupported option.${key}; the community edition supports: ${ALLOWED_KEYS.join(' / ')}.`);
    }
  }
}

/** getVersion() 结果缓存（首次调用时读取 package.json 后不再重复 IO） */
let cachedVersion;

/**
 * 获取当前包（xlsx2pdf）的版本号
 *
 * 运行时读取安装目录内的 package.json，与用户实际安装的版本天然一致
 * （而非构建期注入的快照）；pkgRoot() 兼容 CJS/ESM 双产物与 src 直跑场景，
 * 首次调用后结果缓存。
 *
 * @returns {string} 语义化版本号（如 '0.1.0'）；极端场景下 package.json 缺失/损坏时返回 'unknown'
 */
export function getVersion() {
  if (cachedVersion === undefined) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot(), 'package.json'), 'utf8'));
      cachedVersion = typeof pkg.version === 'string' ? pkg.version : 'unknown';
    } catch {
      cachedVersion = 'unknown';
    }
  }
  return cachedVersion;
}

/**
 * 公共生成链路：模板 → 逐页 model → 单份 HTML 字符串（不启动浏览器）
 *
 * @param {Object} params
 * @param {string|Buffer} params.template - Excel 模板路径/URL/Buffer
 * @param {Object|Object[]} [params.data] - 数据对象（支持嵌套点路径取值）；数组多页需商业版
 *   注册 arrayData 能力；缺省或空数组时按 [{}] 渲染一页空模板
 * @param {Object} [params.option] - 配置项（页面设置类优先级：用户传参 > 模板 pageSetup > Excel 内建默认，见 pagesetup.js）
 * @returns {Promise<{ html: string, pages: Array }>} pages 为逐页解析结果（内部使用）
 */
async function buildHtml({ template, data, option = {} }) {
  validateParams({ template, data, option });

  // data 缺省或空数组时兑底为 [{}]，渲染一页空模板
  const dataItems = Array.isArray(data)
    ? (data.length > 0 ? data : [{}])
    : (data ? [data] : [{}]);

  const pages = [];
  for (const item of dataItems) {
    const model = await processTemplate(template, item, {
      defaults: option.defaults,
      plugins: option.plugins,
      // 标记语法：调用级 option.markerRegex > 全局 configure({ markerRegex }) > 内置 ${...}
      markerRegex: option.markerRegex ?? getConfig().markerRegex,
      // 标记内部分隔符：调用级 > 全局 > 内置 |
      markerSeparator: option.markerSeparator ?? getConfig().markerSeparator,
      // 模板规模守卫：调用级 > 全局 > 内置默认（见 browser.js config）
      maxCells: option.maxCells ?? getConfig().maxCells,
      maxTemplateSize: option.maxTemplateSize ?? getConfig().maxTemplateSize,
    });

    // 页面设置统一解析：用户 > 模板 pageSetup > Excel 内建默认（见 pagesetup.js）
    const setup = resolvePageSetup(model, option);
    pages.push({ model, ...setup });
  }

  let html;
  if (pages.length === 1) {
    const p = pages[0];
    html = renderHtml(p.model, {
      pageSize: p.pageSize,
      orientation: p.orientation,
      margin: p.margin,
      // scale 传用户原始值：renderHtml 内部会再走一次 resolvePageSetup，
      // 若传已解析的小数比例会被百分数换算二次除 100（100% → 1 → 0.01）
      scale: option.scale,
      fitToPage: option.fitToPage,
      minFontSize: option.minFontSize,
      emptyRowPlaceholders: option.emptyRowPlaceholders,
    });
  } else {
    const first = pages[0];
    // 仅含渲染行为类参数；页面设置类逐页从解析结果取（多页可各自不同）
    const renderOpts = {
      fitToPage: option.fitToPage,
      minFontSize: option.minFontSize,
      emptyRowPlaceholders: option.emptyRowPlaceholders,
    };

    const fragments = [];
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const pageId = `p${i}`;
      const pageOpts = { ...renderOpts, scale: option.scale, pageSize: p.pageSize, orientation: p.orientation, margin: p.margin, pageId };
      if (i === 0) {
        const fullHtml = renderHtml(p.model, pageOpts);
        const bodyMatch = fullHtml.match(/<body>([\s\S]*)<\/body>/);
        fragments.push(bodyMatch ? bodyMatch[1] : fullHtml);
      } else {
        fragments.push(`<div style="page-break-before: always;"></div>${renderTableFragment(p.model, pageOpts)}`);
      }
    }

    const headHtml = renderHtml(first.model, {
      scale: option.scale,
      pageSize: first.pageSize,
      orientation: first.orientation,
      margin: first.margin,
      ...renderOpts,
      pageId: 'p0',
    });
    const headMatch = headHtml.match(/([\s\S]*<body>)/);
    const head = headMatch ? headMatch[1] : '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>';
    html = `${head}\n${fragments.join('\n')}\n</body>\n</html>`;
  }

  return { html, pages };
}

/**
 * Excel 模板 → PDF（一站式生成）
 *
 * @param {Object} params
 * @param {string|Buffer} params.template - Excel 模板路径/URL/Buffer
 * @param {Object|Object[]} [params.data] - 数据对象（支持嵌套点路径取值）；数组多页需商业版能力
 * @param {Object} [params.option] - 配置项（页面设置类优先级：用户传参 > 模板 pageSetup > Excel 内建默认，见 pagesetup.js）
 * @param {string} [params.option.pageSize] - A3/A4/A5/B4/B5/letter/legal（具名标准纸张；自定义纸张对象需商业版能力）
 * @param {string} [params.option.orientation] - portrait / landscape
 * @param {Object} [params.option.margin] - 页边距 mm { top, right, bottom, left }，逐字段合并，
 *   模板未设时兜底为 Excel 内建默认（上下 19.1 / 左右 17.8mm）
 * @param {Object} [params.option.defaults] - 全局默认值 { 字段名: '默认值' }
 * @returns {Promise<{ pdf: Buffer, html: string }>}
 */
export async function excel2pdf({ template, data, option = {} }) {
  const seams = getSeams();

  // pageRotate 合法性先于渲染校验：拼错入参不应白占一个并发槽位与渲染耗时
  // （能力未注册时 option.pageRotate 由 validateParams 抛 Pro 引导，此处不重复校验）
  const pageRotate = option.pageRotate ?? getConfig().pageRotate;
  if (hasCapability('pageRotate') && typeof pageRotate !== 'boolean') {
    throw xlsxError('E_OPTION_INVALID',
      `[xlsx2pdf] option.pageRotate 只接受 boolean，收到：${JSON.stringify(option.pageRotate)}`,
      `option.pageRotate accepts boolean only, received: ${JSON.stringify(option.pageRotate)}.`);
  }

  const { html, pages } = await buildHtml({ template, data, option });

  // fontGuard：调用级 > 全局 configure > 默认 'warn'；非法值抛错（与 configure 一致）
  const fontGuard = option.fontGuard ?? getConfig().fontGuard;
  const fontGuardModes = seams.fontGuardModes;
  if (fontGuardModes && !fontGuardModes.includes(fontGuard)) {
    throw xlsxError('E_OPTION_INVALID',
      `[xlsx2pdf] option.fontGuard 只接受 ${fontGuardModes.join(' / ')}，收到：${JSON.stringify(option.fontGuard)}`,
      `option.fontGuard accepts ${fontGuardModes.join(' / ')} only, received: ${JSON.stringify(option.fontGuard)}.`);
  }

  const firstPage = pages[0];
  let pdf = await htmlToPdf(html, {
    pageSize: firstPage.pageSize,
    orientation: firstPage.orientation,
    margin: firstPage.margin,
    fontGuard,
  });

  // 横向标记补写（商业版接缝）：Chromium 只用「交换 MediaBox 宽高」表达横向且绝不写 /Rotate，
  // WPS 打印模块 / Clodop 按 /Rotate 选纸会退回纵向纸。纵向页由实现按几何自行判定并原样返回
  if (pageRotate && seams.rotateLandscape) pdf = await seams.rotateLandscape(pdf);

  return { pdf, html };
}

/**
 * Excel 模板 → HTML（只走 engine+render，不启动浏览器）
 *
 * 参数与 excel2pdf 完全一致
 * @returns {Promise<{ html: string }>}
 */
export async function excel2html({ template, data, option = {} }) {
  const { html } = await buildHtml({ template, data, option });
  return { html };
}

/**
 * 扩展开发工具方法命名空间：自定义标记类型/字段解析器可复用引擎同款能力，
 * 避免重复实现与行为漂移（商业版另追加条码/图片类工具，见其 README）
 */
export const helpers = {
  /** 本地路径 / http(s) URL / base64（含 Data URL）→ Buffer：getFileBuffer(source) */
  getFileBuffer,
  /** 嵌套对象/数组拍平为点路径键（与引擎取值同规则）：flattenObject(obj) */
  flattenObject,
  /** 解析标记 option 串（`类型_w100_自定义:值`）：parseMarkerOption(optionStr, knownTypes) */
  parseMarkerOption,
  /** 校验自定义标记正则契约（g 标志 + 捕获组 1）：validateMarkerRegex(regex) */
  validateMarkerRegex,
  /** 按 Excel 数字格式渲染值（与 numFmt 自动继承同一实现）：formatValue(value, fmt) */
  formatValue,
  /** 条码/二维码文本 → base64 Data URL：generateCode('barcode'|'qrcode', text, { width, height }) */
  generateCode,
  /** Buffer → base64 Data URL：bufferToDataUrl(buffer, extension) */
  bufferToDataUrl,
};

export { configure, ensureBrowser, closeBrowser, use, Xlsx2pdfError };

export default { excel2pdf, excel2html, configure, ensureBrowser, closeBrowser, use, getVersion, helpers, Xlsx2pdfError };