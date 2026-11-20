/**
 * 稳定错误码与双语报错（单一事实来源）
 *
 * 契约：
 *  - 所有可预期的失败抛 Xlsx2pdfError，携带稳定 err.code（E_* 大写蛇形），
 *    调用方可按码编程处理，不必匹配文案
 *  - message 保留中文原文逐字不变（不破坏既有字符串匹配），其后追加英文翻译
 *  - 码表与修复建议见 docs/errors.md（每个码一个锚点 #e_xxx）
 *  - Pro 能力引导类错误同样给码（E_OPTION_PRO / E_MARKER_PRO），转化入口不弱化
 */

/** 携带稳定错误码的 xlsx2pdf 错误（instanceof Error 恒成立） */
export class Xlsx2pdfError extends Error {
  /**
   * @param {string} code - 稳定错误码（E_*，见 docs/errors.md）
   * @param {string} message - 完整报错文案（中文原文 + 英文）
   */
  constructor(code, message) {
    super(message);
    this.name = 'Xlsx2pdfError';
    this.code = code;
  }
}

/**
 * 构造双语错误：中文原文逐字保留，英文追加在后
 * @param {string} code - 稳定错误码
 * @param {string} zh - 中文原文（含既有前缀，保持不变）
 * @param {string} [en] - 英文翻译（新包装的错误可只传 zh 并直接给双语）
 * @returns {Xlsx2pdfError}
 */
export function xlsxError(code, zh, en) {
  return new Xlsx2pdfError(code, en ? `${zh} ${en}` : zh);
}

/** 已是带码错误则原样重抛（避免层层包装丢失原始码） */
export function isCodedError(err) {
  return err instanceof Xlsx2pdfError;
}

/** 构造取消错误（option.signal 触发；排队摘除/渲染中断/入口预检共用） */
export function cancelledError() {
  return xlsxError('E_CANCELLED',
    '[xlsx2pdf] 生成已取消（option.signal 已 abort）',
    'Generation cancelled (option.signal aborted).');
}

/** signal 已 abort 时抛 E_CANCELLED（未传 signal 时零开销） */
export function throwIfAborted(signal) {
  if (signal && signal.aborted) throw cancelledError();
}