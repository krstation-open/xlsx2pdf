import { getPageDimensions } from './constants.js';
import { getSeams } from './seams.js';
import { resolvePageSetup } from './pagesetup.js';

/**
 * HTML 渲染器：将 WorksheetModel 渲染为 HTML 字符串
 *
 * 核心功能:
 * - 根据 pageSize/orientation 动态计算页面宽度和缩放比例
 * - 将 Excel 样式映射为 CSS
 * - 将图片以 <img> base64 嵌入
 * - 支持换行、合并单元格
 * - 页面内自适应脚本经内部接缝注入（商业版）；核心缺省不注入任何脚本，
 *   内容超页时走浏览器原生分页
 */

/**
 * @typedef {Object} RenderOptions
 * @property {string} [pageSize='A4']
 * @property {string} [orientation='portrait']
 * @property {Object} [margin] - 页边距 mm
 * @property {number|string} [scale] - 用户原始缩放：百分数（100 = 100%，200 = 200%，有效范围 1~400）或 'auto'；
 *   百分数→小数比例的换算统一在 resolvePageSetup 完成，本层不得二次换算
 * @property {boolean} [fitToPage=true] - 单页自适应（字号收缩 + 行高回收）
 * @property {number} [minFontSize=6] - 自适应时的字号下限 px
 * @property {string[]} [emptyRowPlaceholders] - 视为空行的占位字符，例 ['--']
 */

/** 单元格左右边框占用的宽度余量 (px)，约束图片宽度时预留 */
const CELL_EDGE_PX = 2;

/** Excel 边框样式 → CSS border-style */
const BORDER_STYLE_MAP = {
    thin: 'solid',
    medium: 'solid',
    thick: 'solid',
    hair: 'solid',
    dashed: 'dashed',
    dotted: 'dotted',
    double: 'double',
    dashDot: 'dashed',
    dashDotDot: 'dashed',
    slantDashDot: 'dashed',
};

/** Excel 边框样式 → CSS 宽度 (pt，对齐 Excel 实际线宽) */
const BORDER_WIDTH_MAP = {
    thin: 0.5,
    medium: 1.5,
    thick: 2.5,
    hair: 0.25,
    dashed: 0.5,
    dotted: 0.5,
    double: 0.5,
    dashDot: 0.5,
    dashDotDot: 0.5,
    slantDashDot: 0.5,
};

/**
 * 缩放列宽并取整，确保每条边框落在整数像素上（避免抗锯齿虚化）；
 * 取整可能使总宽超出预算，此时从「向上取整幅度最大」的列逐 1px 回退。
 * 预算 = floor(可打印宽度) - 1：border-collapse 下表格最外侧边框线会向列宽
 * 之外各延伸半条线宽（共 ≈1px），不预留会导致最右列/右边框越出页边被裁切
 *
 * 放大模式（scale > 1）：用户显式放大内容（如小模板放大打印），跳过越界回退，
 * 允许列宽超出可打印宽度，由浏览器/PDF 引擎按版面裁切或分页
 *
 * @param {number[]} columnWidths - 模板原始列宽
 * @param {number} columnCount - 列数
 * @param {number} scale - 缩放比例
 * @param {number} printableWidth - 可打印宽度 px
 * @returns {number[]} 取整后的列宽数组
 */
function scaleColumnWidths(columnWidths, columnCount, scale, printableWidth) {
    const widths = [];
    const roundUps = [];
    for (let c = 0; c < columnCount; c++) {
        const raw = (columnWidths[c] || 75) * scale;
        const rounded = Math.round(raw);
        widths.push(rounded);
        roundUps.push(rounded - raw); // 正值 = 被向上取整的幅度
    }

    // 放大模式（scale > 1）不回收：用户显式放大内容以填充版面，越界回退会抵消放大效果
    if (scale <= 1) {
        let overflow = widths.reduce((s, w) => s + w, 0) - (Math.floor(printableWidth) - 1);
        if (overflow > 0) {
            const order = roundUps
                .map((d, i) => [d, i])
                .sort((a, b) => b[0] - a[0]);
            for (const [, i] of order) {
                if (overflow <= 0) break;
                if (widths[i] > 1) {
                    widths[i]--;
                    overflow--;
                }
            }
        }
    }
    return widths;
}

// 页面内脚本构建器（列宽实测校正 / 单页自适应 / 水印浮层自适应）为商业版
// 增强实现，经 seams.measureScript / seams.fitScript / seams.watermarkScript 注入；
// 核心缺省不注入任何脚本（内容超页走浏览器原生分页）

/**
 * 将 WorksheetModel 渲染为完整 HTML 文档
 *
 * @param {Object} model - engine.processTemplate 的输出
 * @param {RenderOptions} [option]
 * @returns {string} HTML 字符串
 */
export function renderHtml(model, option = {}) {
    // 页面设置统一解析：用户 > 模板 pageSetup > Excel 内建默认（见 pagesetup.js）
    const setup = resolvePageSetup(model, option);
    const { orientation, pageSize, margin } = setup;

    const page = getPageDimensions(pageSize, orientation);
    const marginPx = {
        top: (margin.top / 25.4) * 96,
        right: (margin.right / 25.4) * 96,
        bottom: (margin.bottom / 25.4) * 96,
        left: (margin.left / 25.4) * 96,
    };

    const printableWidth = page.widthPx - marginPx.left - marginPx.right;
    const naturalWidth = model.totalWidth || 700;

    // 缩放：resolvePageSetup 已完成优先级解析，'auto' 表示按可打印宽度自适应。
    // auto 模式下宽度与高度解耦：列宽收缩到可打印宽度，行高/字号保持模板原尺寸
    // （对齐 Excel 编辑视图；总高超出时由 fit 脚本在页面内收敛）。用户显式 scale
    // 保持等比缩放语义；measure 脚本会用实测字体宽重算列宽并校正
    const widthScale = setup.scale === 'auto'
        ? Math.min(1, printableWidth / naturalWidth)
        : setup.scale;
    const heightScale = setup.scale === 'auto' ? 1 : setup.scale;

    // 列宽取整后求和作为表格实际宽度（越界回退见 scaleColumnWidths）
    const scaledColWidths = scaleColumnWidths(model.columnWidths, model.columnCount, widthScale, printableWidth);
    const tableWidth = scaledColWidths.reduce((s, w) => s + w, 0);
    const bodyWidth = tableWidth;

    // 表格水平偏移：统一左对齐（对齐 WPS/Excel 打印预览行为，与 measure 脚本的
    // marginLeft 清零保持一致），宽度不足时右侧自然留白；1px 外沿边框
    // （border-collapse 延伸）的越界回退由 scaleColumnWidths 保证。
    // 不做居中，避免「缺字体环境居中 / 有字体环境左对齐」的环境依赖不一致
    const bodyMarginLeft = 0;

    // 单页自适应配置（脚本由商业版经接缝注入；核心缺省无脚本）
    const seams = getSeams();
    const fitDefaults = seams.fitDefaults || { minFontSize: 6 };
    const fitEnabled = option.fitToPage !== false;
    const minFontSize = option.minFontSize != null ? Number(option.minFontSize) : fitDefaults.minFontSize;
    const placeholders = Array.isArray(option.emptyRowPlaceholders) ? option.emptyRowPlaceholders : [];
    // 单页可用内容高度（与宽度逻辑同源）
    const limitPx = Math.floor(page.heightPx - marginPx.top - marginPx.bottom);

    const { flags: rowFlags, imgRows, watermarkRows } = computeRowFlags(model, placeholders);
    const pageId = option.pageId || null;
    const fitCfg = fitEnabled
        ? {
            limitPx,
            minFontSize,
            emptyRowRatio: fitDefaults.emptyRowRatio,
            emptyRowMinPx: fitDefaults.emptyRowMinPx,
            placeholderRowMinPx: fitDefaults.placeholderRowMinPx,
        }
        : { minFontSize: seams.legacyMinFontSize ?? 2 };
    const fitScript = seams.fitScript ? seams.fitScript(pageId, fitEnabled, fitCfg) : '';
    // 列宽实测校正脚本（商业版接缝）：须在 fit 之前执行
    const measureScript = (seams.measureScript && model.columnWidthUnits && model.defaultFont?.size)
        ? seams.measureScript({
            pageId,
            autoScale: setup.scale === 'auto',
            fontName: model.defaultFont.name || '',
            fontPt: model.defaultFont.size,
            rawWidths: model.columnWidthUnits,
            scale: heightScale,
            printableWidth,
        })
        : '';
    // watermark 水印浮层自适应：须在 measure/fit 之后执行（无水印时不注入）
    const watermarkScript = (seams.watermarkScript && (model.cells || []).some((c) => c.watermarks && c.watermarks.length > 0))
        ? seams.watermarkScript(pageId)
        : '';
    const injectScripts = [measureScript, fitScript, watermarkScript].filter(Boolean).join('\n');

    // 关闭自适应时保留旧的「换行行不限高」行为，保证输出与改动前一致
    const legacyAutoRowCss = fitEnabled ? '' : `
  tr:has(td.pre-wrap) {
    height: auto !important;
  }`;

    // 构建 HTML
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { size: ${page.widthMm}mm ${page.heightMm}mm; margin: ${margin.top}mm ${margin.right}mm ${margin.bottom}mm ${margin.left}mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${bodyWidth}px;
    font-family: "宋体", SimSun, serif;
    margin: 0 0 0 ${bodyMarginLeft}px;
  }
  table {
    width: ${tableWidth}px;
    table-layout: fixed;
    border-collapse: collapse;
  }
  td {
    overflow: visible;
    position: relative;
    word-break: normal;
    white-space: nowrap;
    vertical-align: middle;
  }
  td.pre-wrap {
    white-space: pre-wrap;
    word-break: break-all;
    overflow: hidden;
  }
  td.shrink-to-fit {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: clip;
  }
  /* 图片在 Excel 里是浮在网格上的层，允许越出所在格边界；
     文本仍由 .cb 的 overflow:hidden 裁剪，不受影响。
     带 zindex（非 0）的图片是纯浮层：不撑高行（自适应脚本排除非 0 层叠），
     越界部分同样放行 */
  td.has-img {
    overflow: visible;
  }
  /* watermark 文本水印浮层：高度不受单元格限制，越出部分需放行
     （置于 pre-wrap/shrink-to-fit 之后，同特异性下后者优先） */
  td.has-watermark {
    overflow: visible;
  }
  /* 单元格内容块：行高在 CSS 中是「最小高度」语义，
     只有把文本装进可测量的内层块，才能精确实测内容高度并限制行被撑开 */
  .cb {
    overflow: visible;
    white-space: nowrap;
  }
  td.pre-wrap .cb {
    overflow: hidden;
    white-space: pre-wrap;
    word-break: break-all;
  }${legacyAutoRowCss}
  .img-wrapper {
    position: absolute;
    pointer-events: none;
    padding: 2px;
    /* 隔断单元格的文本排版：pre-wrap / line-height 若渗进来会让图片错位 */
    white-space: normal;
    line-height: 0;
    font-size: 0;
  }
  .img-wrapper img {
    display: block;
    width: 100%;
    height: 100%;
  }
  /* watermark 文本水印浮层：绝对定位浮在单元格上，宽度沿用单元格宽度；
     字号/颜色/粗体/斜体继承单元格，删除线不向绝对定位层传播由内联样式补回；
     宽度不足时由 fitWatermarkBlocks 先缩字号后换行，高度不限制 */
  .watermark-wrapper {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    pointer-events: none;
    white-space: nowrap;
    overflow: visible;
  }
</style>
</head>
<body>
${buildTable(model, heightScale, scaledColWidths, rowFlags, imgRows, watermarkRows, pageId, minFontSize)}
${injectScripts ? `<script>\n${injectScripts}\n</script>` : ''}
</body>
</html>`;
}

/**
 * 渲染表格片段（含 fit 脚本），用于多页拼装
 *
 * @param {Object} model - engine.processTemplate 的输出
 * @param {RenderOptions} [option]
 * @param {string} [option.pageId] - 多页时的页面标识
 * @returns {string} HTML 片段（<table> + <script>）
 */
export function renderTableFragment(model, option = {}) {
    // 页面设置统一解析（与 renderHtml 同源，见 pagesetup.js）
    const setup = resolvePageSetup(model, option);
    const { orientation, pageSize, margin } = setup;

    const page = getPageDimensions(pageSize, orientation);
    const marginPx = {
        top: (margin.top / 25.4) * 96,
        right: (margin.right / 25.4) * 96,
        bottom: (margin.bottom / 25.4) * 96,
        left: (margin.left / 25.4) * 96,
    };

    const printableWidth = page.widthPx - marginPx.left - marginPx.right;
    const naturalWidth = model.totalWidth || 700;

    const widthScale = setup.scale === 'auto'
        ? Math.min(1, printableWidth / naturalWidth)
        : setup.scale;
    const heightScale = setup.scale === 'auto' ? 1 : setup.scale;

    const scaledColWidths = scaleColumnWidths(model.columnWidths, model.columnCount, widthScale, printableWidth);

    const seams = getSeams();
    const fitDefaults = seams.fitDefaults || { minFontSize: 6 };
    const fitEnabled = option.fitToPage !== false;
    const minFontSize = option.minFontSize != null ? Number(option.minFontSize) : fitDefaults.minFontSize;
    const placeholders = Array.isArray(option.emptyRowPlaceholders) ? option.emptyRowPlaceholders : [];
    const limitPx = Math.floor(page.heightPx - marginPx.top - marginPx.bottom);

    const { flags: rowFlags, imgRows, watermarkRows } = computeRowFlags(model, placeholders);
    const pageId = option.pageId || null;
    const fitCfg = fitEnabled
        ? {
            limitPx,
            minFontSize,
            emptyRowRatio: fitDefaults.emptyRowRatio,
            emptyRowMinPx: fitDefaults.emptyRowMinPx,
            placeholderRowMinPx: fitDefaults.placeholderRowMinPx,
        }
        : { minFontSize: seams.legacyMinFontSize ?? 2 };
    const fitScript = seams.fitScript ? seams.fitScript(pageId, fitEnabled, fitCfg) : '';
    const measureScript = (seams.measureScript && model.columnWidthUnits && model.defaultFont?.size)
        ? seams.measureScript({
            pageId,
            autoScale: setup.scale === 'auto',
            fontName: model.defaultFont.name || '',
            fontPt: model.defaultFont.size,
            rawWidths: model.columnWidthUnits,
            scale: heightScale,
            printableWidth,
        })
        : '';
    // watermark 水印浮层自适应：须在 measure/fit 之后执行（无水印时不注入）
    const watermarkScript = (seams.watermarkScript && (model.cells || []).some((c) => c.watermarks && c.watermarks.length > 0))
        ? seams.watermarkScript(pageId)
        : '';
    const injectScripts = [measureScript, fitScript, watermarkScript].filter(Boolean).join('\n');

    return `${buildTable(model, heightScale, scaledColWidths, rowFlags, imgRows, watermarkRows, pageId, minFontSize)}
${injectScripts ? `<script>\n${injectScripts}\n</script>` : ''}`;
}

/**
 * 预扫描行内容，判定哪些行可以被压缩
 *
 * @param {Object} model
 * @param {string[]} placeholders - 视为空的占位字符（如 '--'）
 * @returns {{flags: number[], imgRows: boolean[], watermarkRows: boolean[]}}
 *   flags：每行标记 0 非空 / 1 空行 / 2 占位行；imgRows：该行是否含图片；
 *   watermarkRows：该行是否含 watermark 水印浮层（均不可缩放，该行不参与压缩）
 */
function computeRowFlags(model, placeholders) {
    const rowCount = model.rowHeights.length;
    const flags = new Array(rowCount).fill(1); // 先假定为空行
    const hasPlaceholder = new Array(rowCount).fill(false);
    const locked = new Array(rowCount).fill(false); // 被有内容的跨行合并块覆盖
    const imgRows = new Array(rowCount).fill(false); // 含图片（图片不能缩放，该行不参与压缩）
    const watermarkRows = new Array(rowCount).fill(false); // 含 watermark 水印浮层（同样不参与压缩）

    for (const cell of model.cells) {
        const r = cell.row - 1;
        if (r < 0 || r >= rowCount) continue;

        const text = (cell.text || '').trim();
        const hasImage = !!(cell.images && cell.images.length > 0);
        const hasWatermark = !!(cell.watermarks && cell.watermarks.length > 0);

        // 图片所在行（含跨行合并所覆盖的行）全部标记，即使图片附在被合并覆盖的格子上；
        // 这些行既不算空行，也不参与比例压缩，否则会直接吃掉图片。
        // zindex 浮层图片不撑高行（fit 脚本 imgBottom 排除非 0 层叠），
        // 但行标记保持：行高稳定不变，浮层锚定位置不随压缩漂移
        if (hasImage) {
            const span = cell.rowspan > 1 ? cell.rowspan : 1;
            for (let i = 0; i < span && r + i < rowCount; i++) imgRows[r + i] = true;
        }
        // watermark 水印同理：浮层高度不受单元格限制，行被压缩会破坏叠放位置
        if (hasWatermark) {
            const span = cell.rowspan > 1 ? cell.rowspan : 1;
            for (let i = 0; i < span && r + i < rowCount; i++) watermarkRows[r + i] = true;
        }

        // 跨行合并且有内容 → 所跨各行强制视为非空，避免压缩破坏合并块
        if (cell.isMergeStart && cell.rowspan > 1 && (text !== '' || hasImage || hasWatermark)) {
            for (let i = 0; i < cell.rowspan && r + i < rowCount; i++) locked[r + i] = true;
        }

        // 被覆盖的格子内容由起始格代表
        if (cell.isInMerge) continue;

        if (hasImage || hasWatermark) {
            flags[r] = 0;
        } else if (text !== '') {
            if (placeholders.indexOf(text) >= 0) hasPlaceholder[r] = true;
            else flags[r] = 0;
        }
    }

    for (let r = 0; r < rowCount; r++) {
        if (locked[r] || imgRows[r] || watermarkRows[r]) flags[r] = 0;
        else if (flags[r] === 1 && hasPlaceholder[r]) flags[r] = 2;
    }

    return { flags, imgRows, watermarkRows };
}

/**
 * 构建 <table> HTML
 *
 * @param {Object} model
 * @param {number} scale
 * @param {number[]} scaledColWidths - 已取整的缩放列宽
 * @param {number[]} rowFlags - 每行空行标记（0/1/2）
 * @param {boolean[]} imgRows - 每行是否含图片
 * @param {boolean[]} [watermarkRows] - 每行是否含 watermark 水印浮层
 * @param {string} [pageId] - 多页时的页面标识（用于 fit 脚本隔离）
 * @param {number} [minFontPx] - 自适应字号下限 px（watermark 未配 minsize 时的缩字号下限）
 */
function buildTable(model, scale, scaledColWidths, rowFlags = [], imgRows = [], watermarkRows = [], pageId, minFontPx = 6) {
    const { rowHeights, cells, columnCount } = model;

    // 建立单元格索引: key = "row,col"
    const cellMap = new Map();
    for (const c of cells) {
        cellMap.set(`${c.row},${c.col}`, c);
    }

    // 记录哪些格子已被合并覆盖（skip）
    const skipSet = new Set();

    let html = '<table>';

    // colgroup
    html += '<colgroup>';
    for (let c = 0; c < columnCount; c++) {
        html += `<col style="width:${scaledColWidths[c]}px">`;
    }
    html += '</colgroup>';

    const rowCount = rowHeights.length;

    for (let r = 0; r < rowCount; r++) {
        const rh = Math.round((rowHeights[r] || 20) * scale);
        const imgAttr = imgRows[r] ? ' data-img="1"' : '';
        const watermarkAttr = watermarkRows[r] ? ' data-watermark="1"' : '';
        html += `<tr data-h="${rh}" data-empty="${rowFlags[r] || 0}"${imgAttr}${watermarkAttr} style="height:${rh}px">`;

        for (let c = 0; c < columnCount; c++) {
            const key = `${r + 1},${c + 1}`;

            if (skipSet.has(key)) continue;

            const cell = cellMap.get(key);

            // 跳过合并区域内的非起始单元格
            if (cell && cell.isInMerge) {
                continue;
            }

            if (!cell) {
                html += '<td><div class="cb"></div></td>';
                continue;
            }

            // 标记合并区域被占用的格子
            if (cell.rowspan > 1 || cell.colspan > 1) {
                for (let rr = 0; rr < cell.rowspan; rr++) {
                    for (let cc = 0; cc < cell.colspan; cc++) {
                        if (rr === 0 && cc === 0) continue;
                        skipSet.add(`${r + 1 + rr},${c + 1 + cc}`);
                    }
                }
            }

            // 图片可用宽度：图片在 Excel 里浮在网格上，允许越出本格，但不能越出表格右边界
            // （越出纸张宽度会被打印成额外的横向页）
            let roomW = 0;
            for (let cc = c; cc < columnCount; cc++) {
                roomW += scaledColWidths[cc] || 0;
            }

            html += buildCellHtml(cell, scale, roomW, minFontPx);
        }

        html += '</tr>';
    }

    html += '</table>';
    if (pageId != null) {
        html = `<div data-page="${pageId}">${html}</div>`;
    }
    return html;
}

/**
 * 构建单个 <td>
 *
 * @param {Object} cell
 * @param {number} scale
 * @param {number} [roomWidth=0] - 图片可用宽度（本格左边界到表格右边界，已缩放），0 表示不约束
 * @param {number} [minFontPx=6] - 自适应字号下限 px（全局默认值：text 与 watermark 未配 minsize 时的缩字号下限）
 */
function buildCellHtml(cell, scale, roomWidth = 0, minFontPx = 6) {
    const styles = [];
    const classes = [];

    // 字体（bold/italic 通过内联样式生效，见下方 inlineStyle）
    let fontSize = cell.font?.size;
    if (fontSize) {
        const px = Math.round(fontSize * 1.333 * scale);
        styles.push(`font-size:${px}px`);
    } else {
        styles.push(`font-size:${Math.round(14 * scale)}px`);
    }

    if (cell.font?.color) {
        styles.push(`color:#${cell.font.color.replace(/^FF/, '')}`);
    }

    // 对齐
    const halign = cell.alignment?.horizontal || 'left';
    const valign = cell.alignment?.vertical || 'top';
    styles.push(`text-align:${halign}`);
    styles.push(`vertical-align:${valign === 'middle' ? 'middle' : valign}`);

    // 换行 / 字体自动缩放：二者在 Excel UI 中互斥，模板里同时置位时以「换行」为准，
    // 否则会被强制单行并裁剪，换行效果丢失（换行格同样会缩字号，由自适应脚本处理）
    // 注：Excel 中 Alt+Enter 会在单元格内插入 \n，无论 wrapText 是否显式开启都应换行
    const hasLineBreak = (cell.text || '').includes('\n');
    if (cell.alignment?.wrapText || hasLineBreak) {
        classes.push('pre-wrap');
    } else if (cell.alignment?.shrinkToFit) {
        classes.push('shrink-to-fit');
    }

    // 边框（仅在 Excel 中定义了边框时才渲染）
    // border-collapse:collapse 下相邻单元格的边框会自动合并去重，无需手动处理互反
    if (cell.border) {
        for (const side of ['top', 'left', 'bottom', 'right']) {
            const b = cell.border[side];
            if (b && b.style) {
                const cssStyle = BORDER_STYLE_MAP[b.style] || 'solid';
                const width = BORDER_WIDTH_MAP[b.style] || 0.5;
                const color = b.color?.argb ? `#${b.color.argb.replace(/^FF/, '')}` : '#000000';
                styles.push(`border-${side}:${width}pt ${cssStyle} ${color}`);
            }
        }
    }

    // 背景色
    if (cell.fill?.fgColor) {
        styles.push(`background-color:#${cell.fill.fgColor.replace(/^FF/, '')}`);
    }

    // 下划线策略：纯文本格或用 border-bottom 占满单元格；多段文本格只有在存在
    // 局部取消下划线时才取消 border-bottom，改由 seg span 逐段输出 text-decoration。
    const hasUnderlineCancel = cell.font?.underline
        && cell.segments?.length > 0
        && cell.segments.some((seg) => seg.underline === false);
    const useTdUnderline = cell.font?.underline && !hasUnderlineCancel;

    // 内容：同格多标记独立样式参数或模板富文本局部格式时按段输出独立 span，
    // 否则维持纯文本输出（无样式差异的 HTML 零变化）
    let content;
    if (cell.segments && cell.segments.length > 0) {
        content = cell.segments.map((seg) => buildSegmentHtml(seg, cell, scale, useTdUnderline)).join('');
    } else {
        content = escapeHtml(cell.text || '').replace(/\n/g, '<br>');
    }

    // 嵌入图片：置于 .cb 之外，避免被内容块的 overflow:hidden 裁剪
    let imgHtml = '';
    if (cell.images && cell.images.length > 0) {
        classes.push('has-img');
        for (const img of cell.images) {
            let iw = Math.round(img.width * scale);
            let ih = Math.round(img.height * scale);
            const ox = Math.round((img.offsetX || 0) * scale);
            const oy = Math.round((img.offsetY || 0) * scale);
            const zi = img.zIndex || 0;
            // 层级（z-index）支持堆叠：0 同层/负数在模板下/正数在上方；opacity 0~1（同 CSS）
            const opCss = img.opacity != null ? `;opacity:${clampOpacity(img.opacity)}` : '';

            // 只在会越出表格右边界时才等比缩小；越出本格但仍在表内的情形照 Excel 的
            // “图片浮在网格上”保留原尺寸（由 td.has-img 的 overflow:visible 放行）
            const maxW = roomWidth - ox - CELL_EDGE_PX;
            if (roomWidth > 0 && maxW > 0 && iw > maxW) {
                ih = Math.max(1, Math.round((ih * maxW) / iw));
                iw = maxW;
            }

            // 标签之间不留空白：td 若带 pre-wrap，缩进换行会被当作真实文本渲染，把图片顶下一行
            imgHtml += `<div class="img-wrapper" style="left:${ox}px;top:${oy}px;width:${iw}px;height:${ih}px;z-index:${zi}${opCss}"><img src="${img.dataUrl}" style="width:100%;height:100%" /></div>`;
        }
    }

    // watermark 文本水印浮层：绝对定位叠在单元格上，宽度沿用单元格宽度，高度不受限；
    // 字号/颜色/粗体/斜体继承模板单元格样式，宽度不足时先缩字号后换行（见 fitWatermarkBlocks）
    let watermarkHtml = '';
    if (cell.watermarks && cell.watermarks.length > 0) {
        classes.push('has-watermark');
        for (const p of cell.watermarks) {
            const zi = p.zIndex || 0;
            const parts = [];
            if (p.opacity != null) parts.push(`opacity:${clampOpacity(p.opacity)}`);
            // text-decoration 不向绝对定位层传播，删除线需显式补回；粗体/斜体/颜色可继承但也显式写出，
            // 避免后续样式调整导致水印与单元格文本样式漂移
            if (cell.font?.bold) parts.push('font-weight:bold');
            if (cell.font?.italic) parts.push('font-style:italic');
            if (cell.font?.strike) parts.push('text-decoration:line-through');
            // lineheight 与模板字号/行高同为 pt 单位，按同系数换算成渲染像素；主要影响换行后的行间距
            if (p.lineHeight > 0) parts.push(`line-height:${Math.round(p.lineHeight * 1.333 * scale)}px`);
            parts.push(`z-index:${zi}`);
            // minsize 与模板字号同为 pt 单位，按同系数换算成渲染像素；未配置时兜底全局字号下限
            const minPx = p.minSize > 0 ? Math.max(1, Math.round(p.minSize * 1.333 * scale)) : minFontPx;
            const text = escapeHtml(p.text).replace(/\n/g, '<br>');
            watermarkHtml += `<div class="watermark-wrapper" data-min="${minPx}" style="${parts.join(';')}">${text}</div>`;
        }
    }

    const rowspan = cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '';
    const colspan = cell.colspan > 1 ? ` colspan="${cell.colspan}"` : '';

    // 下划线：用 border-bottom 模拟（占满单元格）；纯文本格或整段都带下划线的多段格使用。
    // 存在局部取消下划线时由 buildSegmentHtml 逐段输出 text-decoration。
    if (useTdUnderline) {
        // 仅在单元格没有显式底边框时添加下划线边框
        if (!cell.border?.bottom) {
            const underlineColor = cell.font?.color ? `#${cell.font.color.replace(/^FF/, '')}` : '#000000';
            styles.push(`border-bottom:0.5pt solid ${underlineColor}`);
        }
    }
    let inlineStyle = styles.join(';');
    if (cell.font?.bold) inlineStyle += ';font-weight:bold';
    if (cell.font?.italic) inlineStyle += ';font-style:italic';
    if (cell.font?.strike) inlineStyle += ';text-decoration:line-through';

    const classAttr = classes.length ? ` class="${classes.join(' ')}"` : '';

    // 标记 minsize（text 缩字号下限）→ 单元格级下限 px（pt 同系数换算，不低于全局下限），供自适应脚本读取
    const minAttr = cell.minSize > 0
        ? ` data-min="${Math.max(minFontPx, Math.max(1, Math.round(cell.minSize * 1.333 * scale)))}"`
        : '';

    return `<td${rowspan}${colspan}${classAttr}${minAttr} style="${inlineStyle}"><div class="cb">${content}</div>${imgHtml}${watermarkHtml}</td>`;
}

/**
 * 渲染单个文本段（同格多标记独立参数 / 模板富文本局部格式）：无样式覆盖的段直出纯文本；
 * 带样式的段包独立 span：bold/italic（true/false，false 用于取消单元格级样式）、
 * underline/strike/color/size；minsize 以 data-min 携带（px，pt 同系数换算），
 * 供 fit 脚本在单元格字号低于段下限时锁定该段字号
 *
 * @param {Object} seg - { text, bold?, italic?, underline?, strike?, color?, size?, minSize? }（size/minSize 单位 pt，color 为 CSS 色值）
 * @param {Object} cell - CellModel（取 wrapText 对齐）
 * @param {number} scale - 缩放比例
 * @param {boolean} useTdUnderline - 单元格已用 border-bottom 模拟下划线（占满单元格），段内不再重复加 underline
 */
function buildSegmentHtml(seg, cell, scale, useTdUnderline = false) {
    let text = escapeHtml(seg.text || '');
    // Excel Alt+Enter 产生的 \n 无论 wrapText 是否显式开启都应换行
    if (cell.alignment?.wrapText || (cell.text || '').includes('\n')) {
        text = text.replace(/\n/g, '<br>');
    }
    // 未声明下划线/删除线时继承单元格级设置
    const resolvedUnderline = seg.underline !== undefined ? seg.underline : !!cell.font?.underline;
    const resolvedStrike = seg.strike !== undefined ? seg.strike : !!cell.font?.strike;
    const hasExplicitStyle = seg.bold !== undefined || seg.italic !== undefined
        || seg.underline !== undefined || seg.strike !== undefined || seg.color || seg.size > 0 || seg.minSize > 0;
    // 只要单元格进入 segments 模式（存在样式差异），所有段都包 seg span 并固定字号，
    // 避免无显式样式的段因 自适应脚本收缩 td 字号而被带小，导致与显式小字号段大小关系反转。
    const styled = hasExplicitStyle || (cell.segments?.length > 0 && cell.font?.size > 0);
    if (!styled) return text;
    const parts = [];
    if (seg.bold !== undefined) parts.push(`font-weight:${seg.bold ? 'bold' : 'normal'}`);
    if (seg.italic !== undefined) parts.push(`font-style:${seg.italic ? 'italic' : 'normal'}`);
    const deco = [];
    // td 已用 border-bottom 占满单元格时，段内不再重复加 underline；仅在局部取消/局部添加时由段控制
    if (resolvedUnderline && !useTdUnderline) deco.push('underline');
    if (resolvedStrike) deco.push('line-through');
    if (deco.length) parts.push(`text-decoration:${deco.join(' ')}`);
    if (seg.color) parts.push(`color:${seg.color}`);
    if (seg.size > 0) {
        parts.push(`font-size:${Math.max(1, Math.round(seg.size * 1.333 * scale))}px`);
    } else if (styled && cell.font?.size > 0) {
        // 样式段未声明字号时，固定为单元格原始字号；避免 自适应脚本收缩 td 字号时
        // 把继承 td 的段也带小，导致与显式小字号段的大小关系反转
        parts.push(`font-size:${Math.max(1, Math.round(cell.font.size * 1.333 * scale))}px`);
    }
    const minAttr = seg.minSize > 0
        ? ` data-min="${Math.max(1, Math.round(seg.minSize * 1.333 * scale))}"`
        : '';
    const styleAttr = parts.length ? ` style="${parts.join(';')}"` : '';
    return `<span class="seg"${minAttr}${styleAttr}>${text}</span>`;
}

/**
 * 标记参数 opacity → CSS opacity（0~1，与 CSS 一致），越界按边界收敛；
 * 值 > 1 时按百分数兼容旧写法（opacity50 → 0.5），避免已部署模板静默变全不透明
 * @param {number|string} value
 * @returns {number}
 */
function clampOpacity(value) {
    const v = Number(value);
    if (!Number.isFinite(v)) return 1;
    if (v > 1) return Math.min(100, v) / 100;
    return Math.max(0, v);
}

/**
 * HTML 转义
 */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
