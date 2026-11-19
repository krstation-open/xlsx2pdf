/**
 * 页面设置统一解析层（单一事实来源）
 *
 * 页面设置类参数（纸张 / 方向 / 页边距 / 缩放）遵循统一优先级：
 *   用户显式传参 > 模板 pageSetup > Excel 内建默认值
 *
 * 兜底默认值只在「模板也没有设置」时生效，绝不越过模板页面设置生效。
 * 模板显式设置了无法确定尺寸的纸张（自定义纸张 / 不支持的代码）而调用方
 * 又未传 option.pageSize 时抛错，绝不静默回退 A4（会生成错误尺寸的 PDF）。
 * 渲染行为类参数（fitToPage / minFontSize / emptyRowPlaceholders）
 * 在模板中无对应概念，不在此处理。
 */

import { PAGE_SIZES } from './constants.js';
import { xlsxError } from './errors.js';

/**
 * 判断用户传入的 pageSize 是否有效（视为「显式指定」）
 * 空字符串 / null / undefined 均视为未传；对象型必须同时带有效的 width/height（mm），
 * 否则也按未传处理（如 { heigth, wifth } 拼写错误、{ width: undefined }），
 * 避免 truthy 对象短路模板纸张，导致后续查名失败或生成错误尺寸的 PDF
 * 导出供 pdf.js 直接调用链复用，保证两条链路的「未传」语义一致
 */
export function isMeaningfulPageSize(pageSize) {
  if (pageSize == null || pageSize === '') return false;
  if (typeof pageSize === 'object') {
    const w = Number(pageSize.width);
    const h = Number(pageSize.height);
    return Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0;
  }
  return true;
}

/**
 * 判断用户传入的单个页边距值是否有效（视为「显式指定」）
 * 仅接受有限非负数字（mm），显式 0 有效（小票无边距场景）；
 * '' / null / undefined / '19mm' 字符串 / NaN / 负数等均按未传处理，
 * 逐字段回退模板边距 > Excel 默认，避免无效值直接当数字用进出 NaN 尺寸
 */
function isMeaningfulMargin(v) {
  if (v == null || v === '') return false;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0;
}

/** Excel 内建默认页面设置（模板未显式设置时的兜底，与 Excel 打印行为一致） */
export const EXCEL_DEFAULTS = {
  orientation: 'portrait',
  pageSize: 'A4',
  // Excel 内建默认页边距：上下 0.75 英寸 ≈ 19.1mm，左右 0.7 英寸 ≈ 17.8mm
  margin: { top: 19.1, bottom: 19.1, left: 17.8, right: 17.8 },
};

/**
 * 统一解析页面设置，返回完整解析结果（无 undefined 字段）
 *
 * @param {Object} model - engine.processTemplate 的输出（使用其 pageSetup）
 * @param {Object} [userOptions] - 用户 option（可含 pageSize/orientation/margin/scale）
 * @returns {{ orientation: string, pageSize: string|Object, margin: Object, scale: number|'auto' }}
 *   scale 为 'auto' 时表示按可打印宽度自适应，由渲染器结合页面宽度计算
 * @throws {Error} 模板为自定义纸张（代码 >= 256）或不支持的纸张代码，且未通过 option.pageSize 指定尺寸
 */
export function resolvePageSetup(model, userOptions = {}) {
  const ps = model?.pageSetup || {};

  // 方向：用户 > 模板 > Excel 默认
  const orientation = userOptions.orientation || ps.orientation || EXCEL_DEFAULTS.orientation;

  // 纸张：用户 > 模板具名纸张 > 无法确定尺寸则抛错（绝不静默回退 A4）
  // 自定义纸张（代码 >= 256）的物理尺寸配置在打印机驱动中，文件内无法读取，
  // 需调用方通过 option.pageSize（如 { width: 79.4, height: 47.6 }）显式指定；
  // 静默回退 A4 会把小票/自定义纸内容排到 A4 版面上，属错误产物，直接报错引导传参
  // 无效的 userOptions.pageSize（空串 / 全 undefined 对象等）按未传处理，不短路模板值
  const userPageSize = isMeaningfulPageSize(userOptions.pageSize) ? userOptions.pageSize : null;
  let pageSize = userPageSize || ps.pageSize;
  if (!pageSize && ps.paperSizeCode != null) {
    if (ps.paperSizeCode >= 256) {
      throw xlsxError('E_PAPER_CUSTOM',
        `[pagesetup] 模板使用自定义纸张（代码 ${ps.paperSizeCode}），宽高由打印机驱动配置、文件内无法读取。` +
        `请通过 option.pageSize 显式指定尺寸（如小票 { width: 79.4, height: 47.6 }），否则无法生成正确大小的 PDF`,
        `The template uses custom paper (code ${ps.paperSizeCode}); its dimensions live in the printer driver and cannot be read from the file. ` +
        'Specify the size explicitly via option.pageSize (e.g. receipt { width: 79.4, height: 47.6 }), otherwise a correctly sized PDF cannot be generated.');
    }
    throw xlsxError('E_PAPER_CODE',
      `[pagesetup] 模板纸张代码 ${ps.paperSizeCode} 不在支持列表内，请通过 option.pageSize 显式指定尺寸` +
      `（支持 ${Object.keys(PAGE_SIZES).join('/')} 或 { width, height } mm）`,
      `Template paper code ${ps.paperSizeCode} is not in the supported list; specify the size explicitly via option.pageSize ` +
      `(supports ${Object.keys(PAGE_SIZES).join('/')} or { width, height } mm).`);
  }
  pageSize = pageSize || EXCEL_DEFAULTS.pageSize;

  // 页边距：逐字段合并，用户字段 > 模板字段 > Excel 默认
  // 用 ?? 保证显式 0（小票无边距场景）有效，部分指定时其余字段不回退成 undefined
  // 无效的 margin 字段（'' / '19mm' / NaN / 负数等）按未传处理，不短路模板值
  // 有效值统一 Number() 归一：避免把 '+5' / ' 20 ' 这类原样拼进 `${v}mm` 产生非法 CSS（被浏览器静默按 0 处理）
  const margin = {};
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const uv = userOptions.margin?.[side];
    margin[side] = (isMeaningfulMargin(uv) ? Number(uv) : null) ?? ps.margins?.[side] ?? EXCEL_DEFAULTS.margin[side];
  }

  // 缩放：用户显式数值 > 用户 'auto' > 模板非默认 scale > 宽度自适应
  // 对外单位统一为百分数（与 WPS/Excel 一致）：100 = 100%、80 = 80%、200 = 200%；
  // 有效范围 1~400（与 Excel 上限对齐），内部换算为小数比例供渲染层使用；
  // 模板侧的 Excel 百分数值已在 engine.js 换算（100 → 1.0）
  // ExcelJS 总返回 scale（缺省 100），模板 scale === 1 即 Excel 默认值，
  // 不视为显式设置；否则宽模板在换纸时永远不缩放，表格越出纸张右边界
  let scale;
  if (userOptions.scale != null && userOptions.scale !== 'auto') {
    const percent = Number(userOptions.scale);
    if (!Number.isFinite(percent) || percent <= 0) {
      // 非正数/非数字兼容为 auto，不抛错（避免调用方传参不严谨击穿生成流程）
      scale = 'auto';
    } else {
      // scale === 100 与 'auto' 行为一致（宽度自适应、只缩不放大），统一归入 auto；
      // 用户显式传 100 等价于不传，避免客户困惑「100% 和 auto 有什么区别」
      scale = percent === 100 ? 'auto' : Math.min(percent, 400) / 100;
    }
  } else if (userOptions.scale === 'auto') {
    scale = 'auto';
  } else if (ps.scale != null && ps.scale !== 1) {
    scale = ps.scale;
  } else {
    scale = 'auto';
  }

  return { orientation, pageSize, margin, scale };
}
