/**
 * 页面尺寸配置（单位：mm）
 */
import { xlsxError } from './errors.js';

export const PAGE_SIZES = {
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  // JIS B4（Excel 纸张代码 12）与 JIS B5（代码 13），与 PAPER_SIZE_MAP 保持对应，
  // 缺失时会令 getPageDimensions 静默落回 A4，生成错误尺寸的 PDF
  B4: { width: 257, height: 364 },
  B5: { width: 182, height: 257 },
  letter: { width: 215.9, height: 279.4 },
  legal: { width: 215.9, height: 355.6 },
};

/** 屏幕 DPI（CSS 标准 96） */
export const DPI = 96;

/** 1 inch = 25.4 mm */
export const MM_PER_INCH = 25.4;

/** Excel paperSize 代码 → 页面名称 */
export const PAPER_SIZE_MAP = {
  1: 'letter',
  5: 'legal',
  8: 'A3',
  9: 'A4',
  11: 'A5',
  12: 'B4',
  13: 'B5',
};

/**
 * 毫米转 CSS 像素
 * @param {number} mm
 * @returns {number}
 */
export function mmToPx(mm) {
  return (mm / MM_PER_INCH) * DPI;
}

/**
 * 根据 pageSize 和 orientation 获取页面像素尺寸
 * @param {string|Object} pageSize - A3/A4/A5/B4/B5/letter/legal 或自定义 {width,height}mm；缺省按 A4
 * @param {string} orientation - portrait / landscape
 * @returns {{ widthPx: number, heightPx: number, widthMm: number, heightMm: number }}
 */
export function getPageDimensions(pageSize, orientation) {
  let widthMm, heightMm;

  if (typeof pageSize === 'object' && pageSize.width && pageSize.height) {
    // Number() 归一：上游可能传数值字符串（如表单/JSON 传来 '79.4'），
    // 不转则 widthMm 保持字符串，`${widthMm}mm` 遇 '+79.4' / ' 79.4 ' 会拼成非法 CSS
    widthMm = Number(pageSize.width);
    heightMm = Number(pageSize.height);
  } else {
    // 未知具名纸张直接报错：静默回退 A4 会生成错误尺寸的 PDF
    // （调用方显式传了 pageSize 却得到 A4，排查成本高）；缺省（undefined/null）仍按 A4
    if (pageSize != null && !PAGE_SIZES[pageSize]) {
      // 对象型不能直接插值（会显示成 [object Object]），序列化出实际内容方便定位无效字段；
      // undefined 字段经 JSON.stringify 会被丢键显示成 {}，用 replacer 归一成 null
      const shown = typeof pageSize === 'object'
        ? `对象 ${JSON.stringify(pageSize, (k, v) => (v === undefined ? null : v))}（{ width, height } 必须同时为有效正数）`
        : `名称 "${pageSize}"`;
      throw xlsxError('E_PAPER_UNSUPPORTED',
        `[getPageDimensions] 不支持的纸张${shown}，支持 ${Object.keys(PAGE_SIZES).join('/')} 或 { width, height } mm`,
        `Unsupported paper size ${shown}; supports ${Object.keys(PAGE_SIZES).join('/')} or { width, height } mm.`);
    }
    const size = PAGE_SIZES[pageSize] || PAGE_SIZES.A4;
    widthMm = size.width;
    heightMm = size.height;
  }

  const isLandscape = orientation === 'landscape';
  const w = isLandscape ? heightMm : widthMm;
  const h = isLandscape ? widthMm : heightMm;

  return {
    widthMm: w,
    heightMm: h,
    widthPx: mmToPx(w),
    heightPx: mmToPx(h),
  };
}
