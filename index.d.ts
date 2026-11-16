/**
 * xlsx2pdf 类型声明（社区版）
 *
 * 社区版 API 面：单页对象数据 + 精简 option + 自定义扩展（use/plugins/标记语法）
 * + 内置富媒体基础标记（image/img/barcode/qrcode）。
 * 商业版 Pro 能力（数组批量/watermark/自适应/精确缩放/护栏等）传入时运行时抛引导错误。
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

/** 生成配置项（页面设置类优先级：用户传参 > 模板 pageSetup > Excel 内建默认） */
export interface GenerateOptions {
  /** A3/A4/A5/B4/B5/letter/legal */
  pageSize?: StandardPageSize;
  /** portrait / landscape */
  orientation?: 'portrait' | 'landscape';
  /** 全局默认值 { 字段名: '默认值' } */
  defaults?: Record<string, unknown>;
  /** 页边距 mm，逐字段合并；模板未设时兜底为 Excel 内建默认（上下 19.1 / 左右 17.8mm） */
  margin?: Margin;
  /** 调用级扩展插件（仅本次生成生效，冲突时覆盖全局） */
  plugins?: Plugin[];
  /** 自定义标记语法匹配正则（g 标志 + 捕获组 1；优先于 configure 全局默认） */
  markerRegex?: RegExp;
  /** 标记内部「字段 / 类型_参数」分隔符（默认 '|'；优先于 configure 全局默认） */
  markerSeparator?: string;
}

/** 生成入参 */
export interface GenerateParams {
  /** Excel 模板路径/URL/Buffer */
  template: string | Buffer;
  /** 数据对象（支持嵌套点路径取值）；缺省时渲染一页空模板。数组多页批量为商业版 Pro 能力 */
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
};
export default _default;