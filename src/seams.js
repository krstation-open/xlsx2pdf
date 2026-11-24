/**
 * 内部接缝（@internal，不属于公开 API）
 *
 * 本模块是开源核心与商业版之间的唯一注入面：核心保留通用渲染架构，
 * 生产增强能力（列宽精确度量、单页自适应脚本、图片/条码/水印标记、
 * 自定义纸张解包、内存/字体守卫、横向 /Rotate 改写等）由商业版经
 * registerSeams 注入；未注入时核心按社区版精简行为运行。
 *
 * 仅供商业版深导入（xlsx2pdf/internal/seams），不随公开入口导出、
 * 不在公开类型与文档中承诺，接口可随时调整。
 */

/** 接缝注册表（模块级单例） */
const seams = {
  /** 能力开关集合：注册后入口校验放行对应 Pro 入参 */
  capabilities: new Set(),

  // —— 模板引擎接缝 ——
  /** (workbook, defaultFont) => number：列宽度量基准 MDW；缺省按公开常数 7 */
  resolveMdw: null,
  /** async (buf) => {width,height}|null：自定义纸张文件内宽高读；缺省 null */
  readCustomPaper: null,
  /** async (ctx) => void：无标记单元格按字段值匹配插图；缺省不插图 */
  autoInsertImage: null,
  /** async (cells, columnWidths, rowHeights) => void：嵌入图片压缩管线；缺省不处理 */
  optimizeImages: null,

  // —— 渲染脚本接缝（缺省空串 = 不注入任何脚本，超页走浏览器原生分页） ——
  /** () => string：多页共用函数源单次注入（head）；缺省 null（逐页内联全量源码） */
  scriptPreamble: null,
  /** (p) => string：列宽实测校正脚本 */
  measureScript: null,
  /** (pageId, fitEnabled, cfg) => string：单页自适应脚本 */
  fitScript: null,
  /** (pageId) => string：水印浮层自适应脚本 */
  watermarkScript: null,
  /** 自适应默认参数（minFontSize/emptyRowRatio/emptyRowMinPx/placeholderRowMinPx） */
  fitDefaults: null,
  /** 关闭自适应时的旧版字号下限 */
  legacyMinFontSize: null,

  // —— PDF 链路接缝 ——
  /** async (guardCfg, pageCount, signal) => releaseFn：内存准入（pageCount 为本次出片页数，
   *  供守卫按页数放大估算；signal 供排队期取消摘队）；缺省直接放行 */
  memoryAdmit: null,
  /** async (input {pages,data,option}, signal) => releaseFn：请求级准入（buildHtml 之前，
   *  整份报告估算守住 Node 渲染期堆；商业版注入，缺省 no-op） */
  requestAdmit: null,
  /** (releaseFn, admitResult, fn) => fn()：请求上下文包裹（商业版 sidecar 客户端用
   *  AsyncLocalStorage 把准入结果（ticket/local 标记）传给同一请求链的 renderBackend；
   *  缺省直接调 fn） */
  withRequestContext: null,
  /** async (htmlStr, option) => {buffer,warnings}：渲染后端委托（商业版 sidecar 客户端注入后
   *  本地 Chrome 路径整体让位；缺省 null 走本地 htmlToPdf） */
  renderBackend: null,
  /** () => {add(buf), source()}：批产物收集器（商业版磁盘 spill 注入；缺省 null 用内存数组） */
  createBatchStore: null,
  /** async (option, ctx {pages}) => optionPatch：调用级参数自动调优（降级阶梯等；缺省 null） */
  tuneOptions: null,
  /** async (pg, mode) => void：字体缺失检测与告警/抛错；缺省不检测 */
  fontGuardCheck: null,
  /** 字体守卫合法取值列表（configure/option 校验用） */
  fontGuardModes: null,
  /** async (pdfBuf) => Buffer：横向页 /Rotate 改写；缺省原样返回 */
  rotateLandscape: null,
  /** async (buffers|{count,read(i)}, opt {rotate}) => Buffer：多批出片产物按序合并
   *  （批源 v2 支持磁盘 spill；rotate=true 时合并层就地完成 /Rotate 改写单 pass）；
   *  缺省 null（不分批，单文档出片） */
  mergePdf: null,
  /** (evt {step,...metrics}) => void：可观测性事件发射（商业版日志 sink 注入；
   *  缺省 null 零开销）。核心在关键步骤发射耗时/字节/页数计量，
   *  宿主接管/落盘/轮转由商业版 sink 承接 */
  emitEvent: null,

  // —— 配置接缝 ——
  /** configure 额外接受的键（护栏参数化等）；缺省仅浏览器三键 */
  extraConfigKeys: [],
};

/**
 * 注入接缝实现（商业版注册入口；重复注册按键覆盖，capabilities 累加）
 * @param {Object} patch - seams 的部分键值
 */
export function registerSeams(patch = {}) {
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'capabilities') {
      for (const cap of value) seams.capabilities.add(cap);
    } else if (key === 'extraConfigKeys') {
      seams.extraConfigKeys = [...new Set([...seams.extraConfigKeys, ...value])];
    } else if (key in seams) {
      seams[key] = value;
    }
  }
}

/** 读取接缝注册表（内部使用） */
export function getSeams() {
  return seams;
}

/** 能力是否已注册 */
export function hasCapability(name) {
  return seams.capabilities.has(name);
}