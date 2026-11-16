/**
 * 内置富媒体标记 handler（社区版）：image/img/barcode/qrcode。
 * 自商业版同源迁入；解析/取值链路复用核心通用机制（engine + registry）。
 * watermark 类型仍由商业版经内部注册表注入，不在社区版内置。
 */
import { resolveImageCached } from './image.js';

/** image/img/barcode/qrcode：空值返回 null（清除标记）；否则解析 dataUrl 返回图片嵌入结果。
 * image/img 宽高未设置（或为 0）时传 0，由尺寸归一（社区 image-size 兜底 / 商业 sharp 管线）
 * 按图片原始尺寸/宽高比归一化（未设宽高 → 原图大小；只设一边 → 另一边按原图比例）；
 * barcode/qrcode 为生成图（无原图概念），未设时维持默认 100×20 */
export async function imageLikeHandler(value, option, ctx) {
  if (value === undefined || value === null || value === '') return null;
  const dataUrl = await resolveImageCached(ctx.imageCache, value, option);
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