/**
 * xlsx2pdf 类型声明（社区版）
 *
 * 社区版 API 面：单页对象数据 + 精简 option + 自定义扩展（use/plugins/标记语法）
 * + 内置富媒体基础标记（image/img/barcode/qrcode）+ #数组.字段 明细行索引映射。
 * 商业版 Pro 能力（数组多页批量/watermark/自适应/精确缩放/护栏等）传入时运行时抛引导错误。
 * 可预期失败均抛 Xlsx2pdfError（携带稳定 err.code，码表见 docs/errors.md）。
 */

/// <reference types="node" />

// ============================================================
// 通用类型
// ============================================================

/** 页边距（mm） */
export interface Margin {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/** 具名标准纸张（社区版仅支持标准纸；自定义纸张为商业版 Pro 能力） */
export type StandardPageSize = 'A3' | 'A4' | 'A5' | 'B4' | 'B5' | 'letter' | 'legal';

/** 标记类型 handler 返回值：string → 文本替换；images/watermarks → 浮层嵌入；混合对象；null/undefined → 清除标记 */
export type MarkerResult =
  | string
  | null
  | void
  | {
      text?: string;
      images?: Array<{
        dataUrl: string;
        width?: number;
        height?: number;
        offsetX?: number;
        offsetY?: number;
        zIndex?: number;
        opacity?: number;
      }>;
      watermarks?: Array<{
        text: string;
        zIndex?: number;
        opacity?: number;
        minSize?: number;
        lineHeight?: number;
      }>;
    };

/** 扩展插件（三层扩展点；全局 use() 或调用级 option.plugins 注册） */
export interface Plugin {
  /** 插件名（全局重名覆盖并告警） */
  name?: string;
  /** 自定义标记类型：async (value, option, ctx) => MarkerResult */
  markerTypes?: Record<string, (value: unknown, option: Record<string, unknown>, ctx: unknown) => MarkerResult | Promise<MarkerResult>>;
  /** 字段解析器：async (field, data, ctx) => value；返回 undefined 回退后续链路 */
  fieldResolvers?: Array<(field: string, data: Record<string, unknown>, ctx: unknown) => unknown>;
  /** 模型后处理钩子：(model, ctx) => model|void */
  transformModel?: (model: unknown, ctx: unknown) => unknown;
}

/** 生成配置项（页面设置类优先级：用户传参 > 模板 pageSetup > Excel 内建默认；兜底默认只在模板也未设置时生效） */
export interface GenerateOptions {
  /**
   * 具名标准纸张 A3/A4/A5/B4/B5/letter/legal。
   * 优先级：用户传参 > 模板 pageSetup > 'A4'。
   * '' / null / undefined 均视同未传；无效对象（缺有效 width/height）也视同未传，不短路模板值。
   * 对象型自定义纸张 { width, height } mm 为商业版 Pro 能力（传入抛 E_OPTION_PRO）。
   */
  pageSize?: StandardPageSize;
  /** portrait / landscape；优先级：用户传参 > 模板 pageSetup > 'portrait'；'' / null / undefined 视同未传 */
  orientation?: 'portrait' | 'landscape';
  /**
   * 全局默认值 { 字段名: '默认值' }，取值链路的最后兜底：
   * fieldResolvers（首个非 undefined 命中）→ data 拍平取值 → 标记内默认值（_default:）→ option.defaults。
   * 字段值为 undefined / null / '' 均视同缺失，逐层走兜底；兜底后仍无值则清除标记。
   */
  defaults?: Record<string, unknown>;
  /**
   * 页边距 mm，逐字段合并：用户字段 > 模板字段 > Excel 内建默认（上下 19.1 / 左右 17.8mm）。
   * 显式 0 有效（小票无边距场景）；'' / null / undefined / NaN / 负数 / 带单位字符串（如 '19mm'）视同未传。
   */
  margin?: Margin;
  /** 调用级扩展插件（仅本次生成生效，冲突时覆盖全局） */
  plugins?: Plugin[];
  /**
   * 自定义标记语法匹配正则（契约：g 标志 + 捕获组 1 = 标记内部内容，违约抛 E_MARKER_REGEX）。
   * 优先级：调用级 option.markerRegex > configure({ markerRegex }) 全局默认 > 内置 ${...}。
   */
  markerRegex?: RegExp;
  /**
   * 标记内部「字段 / 类型_参数」分隔符，默认 '|'；空串/非字符串抛 E_MARKER_SEPARATOR。
   * 优先级：调用级 > configure({ markerSeparator }) 全局默认 > '|'。
   */
  markerSeparator?: string;
  /**
   * 同时渲染的标签页上限（超限排队），只接受正整数（0/负数/小数抛 E_OPTION_INVALID），默认 1。
   * 优先级：调用级 > configure({ maxConcurrency }) 全局默认 > 1。
   * 风险：社区版无内存准入守卫，Chrome 内存随标签页数线性增长，调大前请确认宿主内存余量（见 README 部署节）。
   */
  maxConcurrency?: number;
}

/** 生成入参 */
export interface GenerateParams {
  /** Excel 模板路径/URL/Buffer（缺失抛 E_TEMPLATE_MISSING；读取/解析失败抛 E_TEMPLATE_LOAD） */
  template: string | Buffer;
  /**
   * 数据对象（支持嵌套点路径取值）；缺省 / null 时渲染一页空模板。
   * 字段值 undefined / null / '' 视同缺失，走标记默认值 → option.defaults 兜底。
   * 数组多页批量为商业版 Pro 能力（传入抛 E_OPTION_PRO）。
   */
  data?: Record<string, unknown>;
  /** 配置项 */
  option?: GenerateOptions;
}

// ============================================================
// 生成函数
// ============================================================

/** Excel 模板 → PDF（一站式生成，内置无头 Chrome） */
export function excel2pdf(params: GenerateParams): Promise<{ pdf: Buffer; html: string }>;

/** Excel 模板 → HTML（只走 engine+render，不启动浏览器） */
export function excel2html(params: GenerateParams): Promise<{ html: string }>;

// ============================================================
// 浏览器管理
// ============================================================

/** 浏览器行为配置 */
export interface BrowserOptions {
  /** 外部浏览器可执行文件路径（优先于内置浏览器与环境变量 XLSX2PDF_BROWSER_PATH） */
  browserPath?: string;
  /** puppeteer headless 模式，默认 'new' */
  headless?: boolean | 'new';
  /** 追加的浏览器启动参数 */
  launchArgs?: string[];
  /** 自定义标记语法匹配正则（全局默认；传 null 恢复内置 ${...}） */
  markerRegex?: RegExp | null;
  /** 标记内部分隔符（全局默认，默认 '|'；传 null 恢复默认） */
  markerSeparator?: string | null;
  /**
   * 同时渲染的标签页上限（全局默认，默认 1，超限排队），只接受正整数（违约抛 E_OPTION_INVALID）。
   * 风险：社区版无内存准入守卫，Chrome 内存随标签页数线性增长；设为 >1 时库会打一次性告警，
   * 小内存容器（如 2C4G）建议维持默认 1，详见 README 部署节。
   */
  maxConcurrency?: number;
}

/** 配置浏览器行为（模块级单例；closeBrowser 后下次启动按新配置重建），返回当前生效配置 */
export function configure(option?: BrowserOptions): Readonly<BrowserOptions>;

/** 确保内置浏览器已就绪（幂等；{ force } 强制重装），返回可执行文件路径 */
export function ensureBrowser(option?: { force?: boolean }): Promise<string>;

/** 关闭单例浏览器（通常在进程退出时调用） */
export function closeBrowser(): Promise<void>;

// ============================================================
// 扩展
// ============================================================

/** 全局注册扩展插件（进程内生效；调用级 option.plugins 仅本次生成生效） */
export function use(plugin: Plugin): void;

/** 扩展开发工具方法（与引擎内部同一实现，行为不会漂移） */
export const helpers: {
  /** 本地路径 / http(s) URL / base64（含 Data URL）→ Buffer */
  getFileBuffer(source: string): Promise<Buffer>;
  /** 嵌套对象/数组拍平为点路径键（与引擎取值同规则） */
  flattenObject(obj: Record<string, unknown>, prefix?: string): Record<string, unknown>;
  /** 解析标记 option 串（`类型_w100_自定义:值`） */
  parseMarkerOption(optionStr?: string, knownTypes?: string[]): Record<string, unknown>;
  /** 校验自定义标记正则契约（g 标志 + 捕获组 1），违约抛错 */
  validateMarkerRegex(regex: RegExp): void;
  /** 按 Excel 数字格式渲染值（与 numFmt 自动继承同一实现） */
  formatValue(value: unknown, fmt?: string): string;
  /** 条码/二维码文本 → base64 Data URL */
  generateCode(type: 'barcode' | 'qrcode', text: string, opts?: { width?: number; height?: number }): Promise<string>;
  /** Buffer → base64 Data URL */
  bufferToDataUrl(buffer: Buffer, extension: string): string;
};

// ============================================================
// 错误
// ============================================================

/**
 * 携带稳定错误码的 xlsx2pdf 错误（所有可预期失败均抛此类型）。
 * message 为双语（中文原文在前 + 英文在后）；按 code 编程处理，不要匹配文案。
 * 码表与修复建议见 docs/errors.md（每个码一个锚点 #e_xxx）。
 */
export class Xlsx2pdfError extends Error {
  /** 稳定错误码（E_* 大写蛇形，如 E_TEMPLATE_LOAD / E_BROWSER_NOT_FOUND / E_OPTION_PRO） */
  code: string;
  constructor(code: string, message: string);
}

// ============================================================
// 其他
// ============================================================

/** 当前包版本号（运行时读取安装目录 package.json） */
export function getVersion(): string;

declare const _default: {
  excel2pdf: typeof excel2pdf;
  excel2html: typeof excel2html;
  configure: typeof configure;
  ensureBrowser: typeof ensureBrowser;
  closeBrowser: typeof closeBrowser;
  use: typeof use;
  getVersion: typeof getVersion;
  helpers: typeof helpers;
  Xlsx2pdfError: typeof Xlsx2pdfError;
};
export default _default;