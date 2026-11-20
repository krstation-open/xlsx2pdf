/**
 * 工作簿默认字体 → MDW（数字「0」的像素宽，Excel 列宽单位的度量基准）。
 * Excel 列宽单位 = 默认字体下 1 个数字字符的宽度，不同字体/字号差异明显
 * （宋体 11pt 为 8px，Calibri 11pt 为 7px）；固定按 Calibri 系数换算会把
 * 中文模板所有列渲染得偏窄（表格铺不满纸张、右侧留白过大）。
 *
 * 社区版内置常见字体启发式表（1.6.0 起）：中文等宽字体按字号查表/推算，
 * 西文字体按保守比例。商业版经 seams.resolveMdw 注入覆盖实现，并在渲染期
 * 经浏览器逐列实测校正（measureScript），精度差异化保留在商业版。
 * 默认字体缺失时维持公开常数 7（Excel 现代版本默认 Calibri 11），与历史行为一致。
 */

/** 中文等宽字体（宋体/黑体/楷体/仿宋）字号 → MDW 实测表 */
const CJK_MDW_TABLE = [
  { size: 9, mdw: 7 },
  { size: 11, mdw: 8 }, // 中文模板最常见
  { size: 12, mdw: 9 },
];

/** 微软雅黑族（非等宽，数字比宋体宽）字号 → MDW 实测表；1.6.1 起独立判定 */
const YAHEI_MDW_TABLE = [
  { size: 9, mdw: 7 },
  { size: 10, mdw: 8 },
  { size: 11, mdw: 9 },
  { size: 12, mdw: 9 },
];

/** 西文字体（Times New Roman 等）数字宽约为同字号宋体的 75~85% */
const WESTERN_MDW_TABLE = [
  { size: 9, mdw: 6 },
  { size: 10, mdw: 7 }, // TNR 10pt 数字宽约 6.67px，向上取整为 7（与 Excel/WPS 打印预览对齐）
  { size: 11, mdw: 7 },
  { size: 12, mdw: 8 },
];

/** 默认字体缺失时的公开常数（Calibri 11pt 基准） */
export const CORE_DEFAULT_MDW = 7;

/**
 * 按工作簿默认字体取 MDW（社区版启发式；seams.resolveMdw 注入时优先用注入实现）
 * @param {Object|null} defaultFont - styles.xml 解析出的默认字体 {name, size}
 * @returns {number} MDW（px）
 */
export function resolveCoreMdw(defaultFont) {
  const size = defaultFont?.size;
  if (!size) return CORE_DEFAULT_MDW;
  const name = String(defaultFont?.name || '');
  // 雅黑族先判：中文名含「黑」会误触 CJK 等宽表，英文名（Microsoft YaHei）则漏判落西文；
  // 雅黑非等宽，数字比宋体宽约 1px，独立查表/按 11pt→9 推算
  if (/雅黑|YaHei/i.test(name)) {
    const hit = YAHEI_MDW_TABLE.find((f) => Math.abs(f.size - size) < 0.5);
    return hit ? hit.mdw : Math.round((size / 11) * 9);
  }
  // 宋体/黑体等中文字体为等宽字体，MDW 可按字号推算；西文字体比例不定，取保守值。
  // 等线/DengXian 有意走西文分支：其数字度量与 Calibri 同源（中文版 Excel 默认列
  // 8.43 字符 = 64px，与 Calibri 11 一致，MDW=7）；canvas 实测 7.72px 是未整像素化
  // 的分数宽，进位到 8 反而比 Excel 宽，勿归入 CJK 表
  const cjk = /宋|黑|楷|仿宋|SimSun|SimHei|KaiTi|FangSong/.test(name);
  if (cjk) {
    const hit = CJK_MDW_TABLE.find((f) => Math.abs(f.size - size) < 0.5);
    return hit ? hit.mdw : Math.round((size / 11) * 8);
  }
  const latin = WESTERN_MDW_TABLE.find((f) => Math.abs(f.size - size) < 0.5);
  if (latin) return latin.mdw;
  return Math.max(5, Math.round(size * 0.67)); // 数字宽约 0.5em，px = size*96/72*0.5 ≈ size*0.67
}