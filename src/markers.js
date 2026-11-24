/**
 * 内置富媒体标记 handler（社区版）：image/barcode/qrcode/watermark。
 * 自商业版同源迁入；解析/取值链路复用核心通用机制（engine + registry）。
 * img/print 历史别名经内置默认别名映射归一（markerAliases 可配，见 utils.js）。
 * 水印随版面自动收敛（缩字号/换行）由商业版经 seams.watermarkScript 注入，社区版不生效。
 */
import { resolveImageCached } from './image.js';
import { formatValue } from './numfmt.js';

/** image/img/barcode/qrcode：空值返回 null（清除标记）；否则解析 dataUrl 返回图片嵌入结果。
 * image/img 宽高未设置（或为 0）时传 0，由尺寸归一（社区 image-size 兜底 / 商业 sharp 管线）
 * 按图片原始尺寸/宽高比归一化（未设宽高 → 原图大小；只设一边 → 另一边按原图比例）；
 * barcode/qrcode 为生成图（无原图概念），未设时维持默认 100×20 */
export async function imageLikeHandler(value, option, ctx) {
  if (value === undefined || value === null || value === '') return null;
  const dataUrl = await resolveImageCached(ctx.imageCache, value, option, ctx.warnings);
  if (!dataUrl) return null;
  const natural = option.type === 'image' || option.type === 'img';
  return {
    images: [{
      dataUrl,
      width: natural ? (option.width > 0 ? option.width : 0) : (option.width || 100),
      height: natural ? (option.height > 0 ? option.height : 0) : (option.height || 20),
      offsetX: option.offsetX || 0,
      offsetY: option.offsetY || 0,
      zIndex: option.zIndex || 0,
      opacity: option.opacity ?? null,
    }],
  };
}

/** watermark：文本水印浮层。空值返回 null（清除标记）；数字格式自动继承（同 text）；
 * 层级/透明度由标记参数 zindex/opacity 控制，渲染层以浮层实现；
 * minsize 透传供商业版水印自适应脚本读取（社区版不生效）；lineheight 换算为浮层行间距（社区版生效） */
export function watermarkHandler(value, option, ctx) {
  if (value === undefined || value === null || value === '') return null;
  let text = value;
  if (ctx?.numFmt) {
    const out = formatValue(value, ctx.numFmt);
    if (typeof out === 'string') text = out;
  }
  return {
    watermarks: [{
      text: String(text),
      zIndex: option.zIndex || 0,
      opacity: option.opacity ?? null,
      minSize: option.minSize || 0,
      lineHeight: option.lineHeight || 0,
    }],
  };
}