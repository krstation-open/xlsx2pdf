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
 * （use/plugins 三层扩展点、自定义标记语法）；富媒体基础形态
 * （图片/条码/水印标记）与精确缩放/空行占位识别/规模守卫参数化自 1.7.0 内置。
 * 生产化能力（数组多页批量、单页自适应、水印自适应收敛、精确列宽、
 * 自定义纸张、内存护栏等）由商业版经内部接缝
 * 注册后启用；未注册时传入对应入参显式报错引导，不静默降级。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseTemplateSkeleton, fillSkeleton } from './engine.js';
import { renderHtml, renderTableFragment } from './render.js';
import { htmlToPdf, closeBrowser } from './pdf.js';
import { resolvePageSetup, isMeaningfulPageSize } from './pagesetup.js';
import { getPageDimensions } from './constants.js';
import { configure, ensureBrowser, getConfig, pkgRoot, validateMaxConcurrency, warnConcurrencyRisk, warnResourceRisk } from './browser.js';
import { getSeams, hasCapability } from './seams.js';
import { use, validateMarkerAliases } from './registry.js';
import { flattenObject, getFileBuffer, parseMarkerOption, validateMarkerRegex } from './utils.js';
import { formatValue } from './numfmt.js';
import { generateCode, bufferToDataUrl } from './barcode.js';
import { Xlsx2pdfError, xlsxError, throwIfAborted } from './errors.js';

/** 商业版 Pro 能力咨询方式（统一文案，见 README「社区版 vs Pro」） */
const PRO_CONTACT = '商业版咨询：business@krstation.com';
/** 英文报错中的同义咨询入口（邮箱与中文一致） */
const PRO_CONTACT_EN = 'Pro inquiries: business@krstation.com';

/** 分批出片默认批大小：页数超过此值时分批渲染再合并（option.batchSize 可覆盖） */
const DEFAULT_BATCH_SIZE = 10;

/**
 * 商业版 Pro 专属 option 键：能力未注册时传入任一项即显式报错引导（不静默忽略）。
 * 键 → [能力键, 能力说明（用于错误文案）]
 */
const PRO_OPTION_KEYS = {
  fitToPage: ['fit', '单页自适应（内容超页自动收敛不裁剪）'],
  minFontSize: ['fit', '自适应字号下限'],
  pageRotate: ['pageRotate', '横向 /Rotate 打印链路适配'],
  fontGuard: ['fontGuard', '默认字体缺失守卫'],
  maxPages: ['resourceGuards', '产出页数上限参数化'],
  memoryGuard: ['resourceGuards', '内存准入守卫'],
  batchSize: ['arrayData', '分批出片（页数多时分批渲染再合并）'],
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

  // 调用级并发上限（1.4.0 起社区版开放）：只接受正整数，两个生成 API 同一校验；
  // 生效链路在 excel2pdf（excel2html 不启动浏览器，仅校验不消费）
  if (option.maxConcurrency !== undefined) validateMaxConcurrency(option.maxConcurrency, 'option');

  // 空行占位识别（1.7.0 起社区版开放）：只接受字符串数组（自适应收缩联动仍 Pro）
  if (option.emptyRowPlaceholders !== undefined
    && (!Array.isArray(option.emptyRowPlaceholders) || option.emptyRowPlaceholders.some((s) => typeof s !== 'string'))) {
    throw xlsxError('E_OPTION_INVALID',
      `[xlsx2pdf] option.emptyRowPlaceholders 只接受字符串数组（如 ['--']），收到：${JSON.stringify(option.emptyRowPlaceholders)}`,
      `option.emptyRowPlaceholders accepts an array of strings only (e.g. ['--']), received: ${JSON.stringify(option.emptyRowPlaceholders)}.`);
  }

  // 规模守卫参数化（1.7.0 起社区版开放）：数值必需，0/负数=关闭语义保留
  for (const key of ['maxCells', 'maxTemplateSize']) {
    if (option[key] !== undefined && typeof option[key] !== 'number') {
      throw xlsxError('E_OPTION_INVALID',
        `[xlsx2pdf] option.${key} 只接受数值（0/负数关闭守卫），收到：${JSON.stringify(option[key])}`,
        `option.${key} accepts a number only (0/negative disables the guard), received: ${JSON.stringify(option[key])}.`);
    }
  }

  // 标记类型别名（1.7.0 起）：替换式映射，null 恢复内置默认；
  // 调用级插件注册的类型同样计入已知规范类型（目标校验面）
  if (option.markerAliases !== undefined) {
    const extraTypes = [];
    if (Array.isArray(option.plugins)) {
      for (const p of option.plugins) {
        if (p && typeof p === 'object' && p.markerTypes) extraTypes.push(...Object.keys(p.markerTypes));
      }
    }
    validateMarkerAliases(option.markerAliases, 'option', extraTypes);
  }

  // 分批出片批大小：只接受正整数；页数超过此值时分批渲染再合并（能力闸门由 PRO_OPTION_KEYS 统一把守）
  if (option.batchSize !== undefined && (!Number.isInteger(option.batchSize) || option.batchSize < 1)) {
    throw xlsxError('E_OPTION_INVALID',
      `[xlsx2pdf] option.batchSize 只接受正整数，收到：${JSON.stringify(option.batchSize)}`,
      `option.batchSize accepts positive integers only, received: ${JSON.stringify(option.batchSize)}.`);
  }

  // 产出页数上限：只接受正整数（configure 级非负整数含 0=不限，调用级不允许 0 歧义）
  if (option.maxPages !== undefined && (!Number.isInteger(option.maxPages) || option.maxPages < 1)) {
    throw xlsxError('E_OPTION_INVALID',
      `[xlsx2pdf] option.maxPages 只接受正整数，收到：${JSON.stringify(option.maxPages)}`,
      `option.maxPages accepts positive integers only, received: ${JSON.stringify(option.maxPages)}.`);
  }

  // 取消信号（1.5.0 起）：只接受 AbortSignal，两个生成 API 同口径
  if (option.signal !== undefined && !(option.signal instanceof AbortSignal)) {
    throw xlsxError('E_OPTION_INVALID',
      `[xlsx2pdf] option.signal 只接受 AbortSignal（如 new AbortController().signal），收到：${typeof option.signal}`,
      `option.signal accepts an AbortSignal only (e.g. new AbortController().signal), received: ${typeof option.signal}.`);
  }

  // 未知 option 键同样拒绝：拼错入参不应被静默忽略
  // （plugins/markerRegex/markerSeparator/maxConcurrency/signal 与 1.7.0 下放键为社区版能力，恒放行）
  const ALLOWED_KEYS = ['pageSize', 'orientation', 'margin', 'defaults', 'plugins', 'markerRegex', 'markerSeparator', 'maxConcurrency', 'signal',
    'scale', 'emptyRowPlaceholders', 'maxCells', 'maxTemplateSize', 'markerAliases'];
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
 * 骨架只解析一遍 + 逐页数据填充：模板读取/守卫/ExcelJS 加载/几何/静态格建模
 * 均与数据无关，多页批量复用同一骨架（shared 上下文承载 buffer/预检/字体/
 * 页面设置/图片缓存），避免同一份模板被重复解析 N 次
 *
 * @param {Object} params
 * @param {string|Buffer} params.template - Excel 模板路径/URL/Buffer
 * @param {Object|Object[]} [params.data] - 数据对象（支持嵌套点路径取值）；数组多页需商业版
 *   注册 arrayData 能力；缺省或空数组时按 [{}] 渲染一页空模板
 * @param {Object} [params.option] - 配置项（页面设置类优先级：用户传参 > 模板 pageSetup > Excel 内建默认，见 pagesetup.js）
 * @returns {Promise<{ pages: Array, warnings: string[] }>} pages 为逐页解析结果（内部使用）；
 *   warnings 为本次生成的降级告警（图片损坏/handler 失败等，逐次独立，并发安全）。
 *   不在此拼装全量 HTML：分批出片路径的全量 HTML 推迟到出片完成后才拼，
 *   避免与在途批的 HTML 叠加驻留（Node 堆峰值放大）
 */
async function buildHtml({ template, data, option = {} }) {
  validateParams({ template, data, option });
  throwIfAborted(option.signal);

  // 降级告警收集：逐次生成独立数组，经 markerCtx.warnings 透传给内置/插件 handler
  const warnings = [];

  // data 缺省或空数组时兜底为 [{}]，渲染一页空模板
  const dataItems = Array.isArray(data)
    ? (data.length > 0 ? data : [{}])
    : (data ? [data] : [{}]);

  const engineOpts = {
    defaults: option.defaults,
    plugins: option.plugins,
    // 标记语法：调用级 option.markerRegex > 全局 configure({ markerRegex }) > 内置 ${...}
    markerRegex: option.markerRegex ?? getConfig().markerRegex,
    // 标记内部分隔符：调用级 > 全局 > 内置 |
    markerSeparator: option.markerSeparator ?? getConfig().markerSeparator,
    // 模板规模守卫：调用级 > 全局 > 内置默认（见 browser.js config）
    maxCells: option.maxCells ?? getConfig().maxCells,
    maxTemplateSize: option.maxTemplateSize ?? getConfig().maxTemplateSize,
    // 标记类型别名：调用级 > 全局 > 内置默认（engine 内解析，null 恢复内置）
    markerAliases: option.markerAliases,
    warnings,
    signal: option.signal,
    shared: {},
  };
  // 规模上限放宽的运行期风险告警（一次性；configure 级同口径，见 browser.js）
  warnResourceRisk(engineOpts.maxCells, engineOpts.maxTemplateSize);
  const skeleton = await parseTemplateSkeleton(template, engineOpts);

  const pages = [];
  let handled = 0;
  for (const item of dataItems) {
    // 逐页取消检查：多页批量中途 abort 不再继续后续页
    throwIfAborted(option.signal);
    const model = await fillSkeleton(skeleton, item, engineOpts);

    // 页面设置统一解析：用户 > 模板 pageSetup > Excel 内建默认（见 pagesetup.js）
    const setup = resolvePageSetup(model, option);
    pages.push({ model, ...setup });

    // 逐页填充是主线程 CPU 密集型，await 微任务不让出宏任务：连续多页会把
    // abort 定时器/租约心跳推迟（压测实测 40 页并发下推迟最高 587ms）。
    // 每 YIELD_PAGES 页让出一轮事件循环，取消与心跳及时执行；
    // 让出期间 abort 可能已经触发，恢复后必须重新检查，否则已取消请求会继续跑完
    if (++handled % YIELD_PAGES === 0) {
      await yieldToLoop();
      throwIfAborted(option.signal);
    }
  }

  return { pages, warnings };
}

/**
 * 让出一轮事件循环（宏任务）：让 abort 定时器/租约心跳/其它请求得到执行。
 * 纯 await 只跑微任务队列，定时器仍会被推迟，故用 setImmediate。
 */
const yieldToLoop = () => new Promise((resolve) => { setImmediate(resolve); });
/**
 * 每处理多少页让出一次。
 *
 * 口径：一轮宏任务里会连续恢复所有在途请求的让出点（8 并发 × 每段页数 ×
 * 单页填充耗时 ≈ 阻塞窗口）。实测每页约 15ms，取 4 页时 8 并发下仍有
 * 约 0.5s 连续阻塞（定时器/取消被推迟）；取 1 页把窗口压到 ~120ms，
 * 而 2000 页只多 2000 次事件循环轮询（量级 <0.5s，对分钟级任务可忽略）
 */
const YIELD_PAGES = 1;

/**
 * 把一组页面拼装为完整 HTML 文档（单页走 renderHtml；多页逐页 fragment +
 * page-break-before 分隔，纸张参数取组内首页）。全量文档与分批出片共用，
 * 保证同一页面集合两条路径产出一致
 *
 * @param {Array} pages - buildHtml 的逐页解析结果（model + 页面设置）
 * @param {Object} option - 用户原始 option（取 scale 与渲染行为类参数）
 * @returns {Promise<string>} HTML 字符串（分片拼装，期间会让出事件循环）
 */
async function assembleHtml(pages, option) {
  // 进入拼装前先复核取消：buildHtml 让出期间 abort 可能已经触发
  throwIfAborted(option.signal);
  // 仅含渲染行为类参数；页面设置类逐页从解析结果取（多页可各自不同）
  const renderOpts = {
    fitToPage: option.fitToPage,
    minFontSize: option.minFontSize,
    emptyRowPlaceholders: option.emptyRowPlaceholders,
  };

  if (pages.length === 1) {
    const p = pages[0];
    return renderHtml(p.model, {
      pageSize: p.pageSize,
      orientation: p.orientation,
      margin: p.margin,
      // scale 传用户原始值：renderHtml 内部会再走一次 resolvePageSetup，
      // 若传已解析的小数比例会被百分数换算二次除 100（100% → 1 → 0.01）
      scale: option.scale,
      ...renderOpts,
    });
  }

  const fragments = [];
  let head = '';
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const pageId = `p${i}`;
    const pageOpts = { ...renderOpts, scale: option.scale, pageSize: p.pageSize, orientation: p.orientation, margin: p.margin, pageId };
    if (i === 0) {
      const fullHtml = renderHtml(p.model, pageOpts);
      const bodyMatch = fullHtml.match(/<body>([\s\S]*)<\/body>/);
      fragments.push(bodyMatch ? bodyMatch[1] : fullHtml);
      // 复用同一次渲染结果提取 head，避免第 0 页二次全量渲染
      const headMatch = fullHtml.match(/([\s\S]*<body>)/);
      head = headMatch ? headMatch[1] : '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>';
    } else {
      fragments.push(`<div style="page-break-before: always;"></div>${renderTableFragment(p.model, pageOpts)}`);
    }
    // 大页数拼装是同步 CPU 段：定期让出，避免 160p/2000p 批量把取消定时器拖住；
    // 让出后重新检查取消，避免已取消请求继续拼完剩余页
    if ((i + 1) % YIELD_PAGES === 0) {
      await yieldToLoop();
      throwIfAborted(option.signal);
    }
  }
  throwIfAborted(option.signal);
  return `${head}\n${fragments.join('\n')}\n</body>\n</html>`;
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
 * @param {number} [params.option.batchSize] - 分批出片批大小（Pro，默认 10）：页数超过此值时
 *   分批独立标签页渲染再经接缝合并，批间并发受 maxConcurrency/内存准入天然限流
 * @param {Object} [params.option.defaults] - 全局默认值 { 字段名: '默认值' }
 * @param {AbortSignal} [params.option.signal] - 取消信号：排队中摘除、渲染中关闭标签页中断，抛 E_CANCELLED
 * @returns {Promise<{ pdf: Buffer, html: string, warnings: string[] }>} warnings 为降级告警（无降级时为空数组）
 */
export async function excel2pdf({ template, data, option = {} }) {
  const seams = getSeams();
  const t0 = Date.now(); // 可观测性：请求总耗时起点（含准入排队）

  // pageRotate 合法性先于渲染校验：拼错入参不应白占一个并发槽位与渲染耗时
  // （能力未注册时 option.pageRotate 由 validateParams 抛 Pro 引导，此处不重复校验）
  const pageRotate = option.pageRotate ?? getConfig().pageRotate;
  if (hasCapability('pageRotate') && typeof pageRotate !== 'boolean') {
    throw xlsxError('E_OPTION_INVALID',
      `[xlsx2pdf] option.pageRotate 只接受 boolean，收到：${JSON.stringify(option.pageRotate)}`,
      `option.pageRotate accepts boolean only, received: ${JSON.stringify(option.pageRotate)}.`);
  }

  // 调用级并发调大时的运行期风险告警（校验已在 validateParams 统一做过）
  if (option.maxConcurrency !== undefined) warnConcurrencyRisk(option.maxConcurrency);

  // 页数 cap 先于准入：万页请求快速失败，不白占排队名额与 Node 堆
  const maxPages = option.maxPages ?? getConfig().maxPages;
  const estPages = Array.isArray(data) ? (data.length || 1) : 1;
  if (maxPages > 0 && estPages > maxPages) {
    throw xlsxError('E_PAGE_CAP',
      `[xlsx2pdf] 产出页数超上限：data 共 ${estPages} 页，超过 maxPages=${maxPages}，请拆分请求`,
      `Output page cap exceeded: data yields ${estPages} pages, over maxPages=${maxPages}; split the request.`);
  }

  // 请求级准入（商业版接缝）：buildHtml 之前整份报告估算，守住 Node 渲染期堆；
  // 排队请求不建 model/不拼 HTML（重试风暴的堆放大数据此消失）
  // 返回兼容两形态：releaseFn 或 {release, ticket}（sidecar 客户端携带 ticket，
  // 经 withRequestContext 接缝注入请求上下文供 renderBackend 读取）
  const admitResult = seams.requestAdmit
    ? await seams.requestAdmit({ pages: estPages, data, option }, option.signal)
    : null;
  const releaseRequest = typeof admitResult === 'function' ? admitResult : (admitResult && admitResult.release) || (() => { });
  const run = () => generatePdf({ template, data, option, seams, pageRotate, t0 });
  try {
    return await (seams.withRequestContext
      ? seams.withRequestContext(releaseRequest, admitResult, run)
      : run());
  } finally {
    releaseRequest();
  }
}

/** excel2pdf 主体（请求级准入已持有）：buildHtml → 分批/单文档出片 → 合并/旋转 */
async function generatePdf({ template, data, option, seams, pageRotate, t0 }) {
  // 可观测性事件发射：社区 onEvent 钩子与商业版 sink 双通道共存；
  // 两者皆无时零开销（不构造 evt）；钩子异常不击穿渲染
  const emit = (step, fields) => {
    const hook = getConfig().onEvent;
    const sink = seams.emitEvent;
    if (!hook && !sink) return;
    const evt = { step, ts: Date.now(), ...fields };
    if (hook) { try { hook(evt); } catch (_) { /* 钩子异常不击穿渲染 */ } }
    if (sink) sink(evt);
  };
  const tHtml = Date.now();
  const { pages, warnings } = await buildHtml({ template, data, option });
  emit('html', { ms: Date.now() - tHtml, pages: pages.length });
  const pageCount = pages.length;
  const maxPages = option.maxPages ?? getConfig().maxPages;
  if (maxPages > 0 && pages.length > maxPages) {
    throw xlsxError('E_PAGE_CAP',
      `[xlsx2pdf] 产出页数超上限：解析得 ${pages.length} 页，超过 maxPages=${maxPages}，请拆分请求`,
      `Output page cap exceeded: parsed ${pages.length} pages, over maxPages=${maxPages}; split the request.`);
  }

  // 全页几何纵向时跳过 /Rotate（按解析后几何判定，兼容自定义纸张 portrait 但几何横向）
  const hasLandscapeGeometry = pages.some((p) => {
    const d = getPageDimensions(p.pageSize, p.orientation);
    return d.widthMm > d.heightMm;
  });

  // 调用级参数自动调优（商业版降级阶梯：内存紧张时自动缩批/降并发）
  if (seams.tuneOptions) option = { ...option, ...(await seams.tuneOptions(option, { pages: pages.length })) };

  // fontGuard：调用级 > 全局 configure > 默认 'warn'；非法值抛错（与 configure 一致）
  const fontGuard = option.fontGuard ?? getConfig().fontGuard;
  const fontGuardModes = seams.fontGuardModes;
  if (fontGuardModes && !fontGuardModes.includes(fontGuard)) {
    throw xlsxError('E_OPTION_INVALID',
      `[xlsx2pdf] option.fontGuard 只接受 ${fontGuardModes.join(' / ')}，收到：${JSON.stringify(option.fontGuard)}`,
      `option.fontGuard accepts ${fontGuardModes.join(' / ')} only, received: ${JSON.stringify(option.fontGuard)}.`);
  }

  // 分批出片：页数超过 batchSize 时按批拆分，每批独立标签页出片（纸张取批内首页，
  // 顺带支持跨批混合纸张/方向），批间并发由标签页信号量与内存准入天然限流，
  // 产物经商业版接缝按序合并。≤ batchSize 保持单文档路径，产物字节不变
  const batchSize = option.batchSize ?? getConfig().batchSize ?? DEFAULT_BATCH_SIZE;
  let pdf;
  let html;
  let batchCount = 1;
  if (pages.length > batchSize && seams.mergePdf) {
    const batches = [];
    for (let i = 0; i < pages.length; i += batchSize) batches.push(pages.slice(i, i + batchSize));
    batchCount = batches.length;
    const batchWarnings = new Array(batches.length);
    // 批产物收集器（商业版磁盘 spill）：超阈落盘，Node 堆与页数解耦；缺省内存数组
    const store = seams.createBatchStore ? seams.createBatchStore() : null;
    const buffers = store ? null : [];
    // 保存任务句柄：Promise.all 首个失败即拒绝，但其余批仍在渲染并写收集器
    const tasks = batches.map(async (batch, bi) => {
      // 逐批取消检查：abort 后未启动的批不再进入渲染（在途批由 htmlToPdf 内部竞态中断）
      throwIfAborted(option.signal);
      const first = batch[0];
      // HTML 传工厂：准入/槽位拿到后才拼装，排队中的批不占 Node 堆；
      // pageCount 传批内页数，内存准入按页数放大估算
      const tR = Date.now();
      const rendered = await htmlToPdf(() => assembleHtml(batch, option), {
        pageSize: first.pageSize,
        orientation: first.orientation,
        margin: first.margin,
        fontGuard,
        maxConcurrency: option.maxConcurrency,
        pageCount: batch.length,
        signal: option.signal,
      });
      emit('render', { ms: Date.now() - tR, pages: batch.length, bytes: rendered.buffer.length, batch: bi, batches: batches.length });
      batchWarnings[bi] = rendered.warnings;
      // 按批序入收集器（Promise.all 完成序不确定，页序靠索引保）；
      // 内存数组同样按索引落位，否则 push 得到的是完成序、合并后页序错乱；
      // add 允许返回 Promise（磁盘 spill 异步写），此处 await 保证合并前数据就位
      if (store) await store.add(rendered.buffer, bi); else buffers[bi] = rendered.buffer;
    });
    try {
      await Promise.all(tasks);
      // 告警按批序聚合（Promise.all 完成序不确定，不直接 push 避免告警顺序漂移）
      for (const w of batchWarnings) warnings.push(...(w || []));
      // 合并层单 pass：rotate=true 时 copyPages 后就地补 /Rotate，省一次全量 parse+save
      const tM = Date.now();
      pdf = await seams.mergePdf(store ? store.source() : buffers, { rotate: pageRotate && hasLandscapeGeometry });
      emit('merge', { ms: Date.now() - tM, bytes: pdf.length, batches: batches.length });
    } finally {
      // 失败时 Promise.all 提前拒绝，其余批仍在写收集器：等它们全部结束后再释放，
      // 否则会出现 dispose 之后仍有 add() 写入（spill 实现会重建目录且无人清理）。
      // allSettled 不抛错，原始错误继续向上传播；清理失败同样不得覆盖原始错误
      await Promise.allSettled(tasks);
      if (store && store.dispose) { try { await store.dispose(); } catch (_) { /* 清理尽力而为 */ } }
    }
    // 全量 HTML 仅供返回：出片完成后才拼；拼完即释放 pages/batches，
    // rotate/返回期峰值不再叠加 Σmodel
    html = await assembleHtml(pages, option);
    pages.length = 0;
    batches.length = 0;
  } else {
    const firstPage = pages[0];
    html = await assembleHtml(pages, option);
    const tR = Date.now();
    const rendered = await htmlToPdf(html, {
      pageSize: firstPage.pageSize,
      orientation: firstPage.orientation,
      margin: firstPage.margin,
      fontGuard,
      maxConcurrency: option.maxConcurrency,
      pageCount: pages.length,
      signal: option.signal,
    });
    emit('render', { ms: Date.now() - tR, pages: pageCount, bytes: rendered.buffer.length, batch: 0, batches: 1 });
    pdf = rendered.buffer;
    warnings.push(...rendered.warnings);
    pages.length = 0;
    // 单文档路径旋转仍走独立接缝（分批路径已在合并层单 pass 完成）
    if (pageRotate && seams.rotateLandscape && hasLandscapeGeometry) {
      const tRot = Date.now();
      pdf = await seams.rotateLandscape(pdf);
      emit('rotate', { ms: Date.now() - tRot, bytes: pdf.length });
    }
  }

  emit('done', { ms: Date.now() - t0, pages: pageCount, pdfBytes: pdf.length, htmlBytes: html.length, batches: batchCount });
  return { pdf, html, warnings };
}

/**
 * Excel 模板 → HTML（只走 engine+render，不启动浏览器）
 *
 * 参数与 excel2pdf 完全一致
 * @returns {Promise<{ html: string, warnings: string[] }>} warnings 为降级告警（无降级时为空数组）
 */
export async function excel2html({ template, data, option = {} }) {
  const { pages, warnings } = await buildHtml({ template, data, option });
  const maxPages = option.maxPages ?? getConfig().maxPages;
  if (maxPages > 0 && pages.length > maxPages) {
    throw xlsxError('E_PAGE_CAP',
      `[xlsx2pdf] 产出页数超上限：解析得 ${pages.length} 页，超过 maxPages=${maxPages}，请拆分请求`,
      `Output page cap exceeded: parsed ${pages.length} pages, over maxPages=${maxPages}; split the request.`);
  }
  return { html: await assembleHtml(pages, option), warnings };
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