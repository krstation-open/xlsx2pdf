import ExcelJS from 'exceljs';

import zlib from 'node:zlib';

import { flattenObject, getFileBuffer, parseCellMarkers, DEFAULT_MARKER_REGEX, DEFAULT_MARKER_SEPARATOR, validateMarkerRegex } from './utils.js';
import { formatValue } from './numfmt.js';
import { PAPER_SIZE_MAP } from './constants.js';
import { getSeams, hasCapability } from './seams.js';
import {
  registerBuiltinMarkerTypes,
  resolveEffectivePlugins,
  lookupMarkerType,
  listMarkerTypes,
} from './registry.js';
import { imageLikeHandler } from './markers.js';
import { normalizeImageSizes } from './image.js';
import { resolveCoreMdw } from './mdw.js';
import { xlsxError, isCodedError, throwIfAborted } from './errors.js';

/**
 * 定位 zip 条目并返回压缩块（中央目录解析，不解压）
 * @param {Buffer} buf - xlsx 文件内容
 * @param {string} entryName - 条目路径（如 'xl/worksheets/sheet1.xml'）
 * @returns {{method: number, raw: Buffer}|null}
 */
export function locateZipEntry(buf, entryName) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const cmtLen = buf.readUInt16LE(off + 32);
    const lhOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    if (name === entryName) {
      const nLen = buf.readUInt16LE(lhOff + 26);
      const eLen = buf.readUInt16LE(lhOff + 28);
      const start = lhOff + 30 + nLen + eLen;
      return { method, raw: buf.slice(start, start + compSize) };
    }
    off += 46 + nameLen + extraLen + cmtLen;
  }
  return null;
}

/**
 * 从 xlsx Buffer 中读取指定条目文本（最小 zip 解析：中央目录 + raw inflate）
 * @param {Buffer} buf - xlsx 文件内容
 * @param {string} entryName - 条目路径（如 'xl/styles.xml'）
 * @returns {string|null}
 */
export function unzipEntryToString(buf, entryName) {
  const entry = locateZipEntry(buf, entryName);
  if (!entry) return null;
  return entry.method === 8 ? zlib.inflateRawSync(entry.raw).toString('utf8') : entry.raw.toString('utf8');
}

/**
 * 流式解压 zip 条目并按块回调（onData 返回 true 时提前中止）。
 * 用于大 sheet 的头部探测/提前拦截，避免整块 inflate 的大字符串瞬时占用
 * @param {{method: number, raw: Buffer}} entry - locateZipEntry 结果
 * @param {(text: string) => boolean|void} onData - 每块解压文本回调，返回 true 中止
 * @returns {Promise<void>}
 */
export function streamZipEntryText(entry, onData) {
  return new Promise((resolve) => {
    if (entry.method !== 8) {
      onData(entry.raw.toString('utf8'));
      return resolve();
    }
    const inf = zlib.createInflateRaw();
    inf.on('data', (chunk) => {
      if (onData(chunk.toString('utf8')) === true) inf.destroy();
    });
    inf.on('error', () => resolve()); // 条目损坏按不可读处理，由后续 ExcelJS 报真实错误
    inf.on('close', () => resolve());
    inf.end(entry.raw);
  });
}

/**
 * 快速预检模板的单元格规模，在 ExcelJS 加载前拦截明显超限的大文件
 * （ExcelJS 内存模型会膨胀近一个数量级，18 万格工作簿加载即占 ~500MB 堆），
 * 避免大模板在并发下反复冲击瞬时内存。取值链路：
 *   ① 流式探测头部 <dimension> 声明 → ② 无声明时流式扫 <row> 行号（行号升序存储，
 *      估算超限即提前中止；行号×已见最大列，只可能偏小不可能偏大）
 * 故仅作提前拒绝，不作为放行依据（加载后另有实测守卫兜底）
 * @param {Buffer} buf - xlsx 文件内容
 * @param {number} maxCells - 单元格数上限（供 ② 提前中止）
 * @returns {Promise<number|null>} 估算的行×列单元格数；无法估算时返回 null（跳过预检）
 */
async function declaredCellCount(buf, maxCells) {
  try {
    const entry = locateZipEntry(buf, 'xl/worksheets/sheet1.xml');
    if (!entry) return null;

    const colOf = (ref) => {
      let n = 0;
      for (const ch of ref) {
        if (ch < 'A' || ch > 'Z') break;
        n = n * 26 + (ch.charCodeAt(0) - 64);
      }
      return n;
    };

    // ① <dimension> 声明（部分生成器不写；只解头部，读够即中止）
    let dimResult = null;
    let head = '';
    await streamZipEntryText(entry, (text) => {
      head += text;
      const m = head.match(/<dimension\s+ref="([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?"/);
      if (m) {
        const cols = m[3] ? Math.max(colOf(m[1]), colOf(m[3])) : colOf(m[1]);
        const rows = m[4] ? Math.max(+m[2], +m[4]) : +m[2];
        dimResult = rows * cols;
        return true;
      }
      return head.includes('<sheetData') || head.length > 65536; // 声明区已过
    });
    if (dimResult !== null) return dimResult;

    // ② 无声明：流式扫 <row r="N" 与单元格列号；行号升序存储，
    // 估算（当前行号×已见最大列）超限即中止，漏网由加载后实测守卫兜底
    let lastRow = 0;
    let maxCol = 0;
    let exceeded = null;
    let carry = '';
    await streamZipEntryText(entry, (text) => {
      const s = carry + text;
      let m;
      const rowRe = /<row[^>]*\br="(\d+)"/g;
      while ((m = rowRe.exec(s)) !== null) lastRow = +m[1];
      const cellRe = /<c\s+r="([A-Z]+)\d+"/g;
      while ((m = cellRe.exec(s)) !== null) {
        const cn = colOf(m[1]);
        if (cn > maxCol) maxCol = cn;
      }
      // 跨块边界的不完整标签留到下一块拼接（限长防无界增长）
      const lt = s.lastIndexOf('<');
      carry = lt >= 0 && s.length - lt < 256 ? s.slice(lt) : '';
      if (maxCol > 0 && lastRow * maxCol > maxCells) {
        exceeded = lastRow * maxCol;
        return true;
      }
      return false;
    });
    if (exceeded !== null) return exceeded;
    return maxCol > 0 && lastRow > 0 ? lastRow * maxCol : null;
  } catch (_) {
    return null;
  }
}

/**
 * 解析工作簿默认字体（styles.xml 字体表第 0 项）。
 * ExcelJS 不暴露该信息，但列宽换算的基准（MDW）依赖默认字体，
 * 拿不到会把 Times New Roman 等窄字体按宋体估算，列宽虚高 20%+
 * @param {Buffer} buf - xlsx 文件内容
 * @returns {{name: string, size: number|null}|null}
 */
function parseDefaultFont(buf) {
  try {
    const xml = unzipEntryToString(buf, 'xl/styles.xml');
    if (!xml) return null;
    const m = xml.match(/<fonts[^>]*>([\s\S]*?)<\/fonts>/);
    if (!m) return null;
    const first = m[1].match(/<font>([\s\S]*?)<\/font>/);
    if (!first) return null;
    const size = first[1].match(/<sz val="([^"]+)"/);
    const name = first[1].match(/<name val="([^"]+)"/);
    return { name: name ? name[1] : '', size: size ? parseFloat(size[1]) : null };
  } catch (_) {
    return null;
  }
}

// 自定义纸张文件内宽高解包为商业版增强实现，经 seams.readCustomPaper 注入，核心缺省不解包；
// MDW 度量核心内置常见字体启发式表（mdw.js），商业版经 seams.resolveMdw 注入覆盖

/**
 * Excel 列宽（字符宽单位）→ px，按 Excel 官方公式换算：
 * px = floor(((256 * width + floor(128 / MDW)) / 256) * MDW)
 * 亚字符列用线性插值 round(width * MDW)，在 width=1 处与官方公式连续
 */
export function colWidthToPx(width, mdw) {
  if (width < 1) return Math.round(width * mdw);
  return Math.floor(((256 * width + Math.floor(128 / mdw)) / 256) * mdw);
}

/**
 * 模板引擎：读取 Excel 模板，解析标记，替换数据，生成图片
 *
 * 返回一个 WorksheetModel，供渲染器使用：
 * {
 *   columnCount, columnWidths, rowHeights,
 *   merges: [{ top, bottom, left, right }],
 *   cells: CellModel[],   // 只含「有内容」或「非合并起始」的单元格
 *   totalWidth, totalHeight  // 表格总宽高（px）
 * }
 */

/**
 * @typedef {Object} CellModel
 * @property {number} row
 * @property {number} col
 * @property {string} text
 * @property {Array}  images
 * @property {Array}  watermarks - watermark 文本水印浮层（{ text, zIndex, opacity, minSize, lineHeight }）
 * @property {number} minSize - 文本缩字号下限 pt（单元格级：仅当全部文本均有下限时输出，取各标记配置的最小值）
 * @property {Array} [segments] - 文本段级样式（模板富文本局部格式 + 同格多标记独立 minSize），存在时渲染层按段输出独立 span；段可含 size（pt）
 * @property {Object} font
 * @property {Object} alignment
 * @property {Object} border
 * @property {Object} fill
 * @property {number} rowspan
 * @property {number} colspan
 */

/**
 * @typedef {Object} EngineOptions
 * @property {Object} [defaults] - 全局默认值映射
 * @property {Array} [plugins] - 调用级扩展插件（见 registry.js，仅本次生成生效）
 * @property {RegExp} [markerRegex] - 自定义标记语法匹配正则（默认内置 ${...}，契约见 utils.js validateMarkerRegex）
 * @property {string} [markerSeparator] - 标记内部「字段 / 类型_参数」分隔符（默认 |）
 * @property {number} [maxTemplateSize] - 模板文件体积上限（字节；超限报错，0/负数不限）
 * @property {number} [maxCells] - 模板单元格数上限（实际行×列；超限报错，0/负数不限）
 * @property {string[]} [warnings] - 调用级降级告警收集数组（入口创建，逐次生成独立，并发安全）
 * @property {AbortSignal} [signal] - 取消信号（已 abort 时抛 E_CANCELLED）
 */

/**
 * 判断单元格是否带有可见样式（边框/背景/字体/对齐/数字格式）。
 * 模板里大量表格边框挂在「无值的空格子」上（尤其合并区域的锚点格），
 * ExcelJS eachCell 默认按 hasValue 过滤会整格跳过它们，边框随之丢失
 * @param {Object} cell - ExcelJS Cell
 * @returns {boolean}
 */
function hasCellVisualStyle(cell) {
  return !!(
    cell.border ||
    cell.fill?.fgColor ||
    cell.font ||
    cell.alignment ||
    cell.numFmt
  );
}

/**
 * 核心：处理 Excel 模板，解析并替换标记，返回 WorksheetModel
 *
 * @param {string|Buffer} templateSource - 模板来源（本地路径/URL/Buffer）
 * @param {Object} data - 数据对象
 * @param {EngineOptions} [option]
 * @returns {Promise<Object>} WorksheetModel
 */
export async function processTemplate(templateSource, data, option = {}) {
  // 取消预检：已 abort 的请求不进入模板加载/下载
  throwIfAborted(option.signal);

  // 1. 加载模板（读取/下载失败统一包装为 E_TEMPLATE_LOAD；已带码的下载错误原样重抛）
  let buffer;
  try {
    buffer = await getFileBuffer(templateSource);
  } catch (err) {
    if (isCodedError(err)) throw err;
    throw xlsxError('E_TEMPLATE_LOAD',
      `[xlsx2pdf] 模板读取失败：${err.message}`,
      `Failed to read the template: ${err.message}`);
  }

  // 体积守卫：超大文件会让 ExcelJS 内存模型与后续整条链路成比例膨胀，
  // 单页渲染下产物也必然被裁剪无意义，早拒绝优于击穿服务
  // （实测 20.8MB/18万格模板：单请求 Node 峰值 1.3GB + 87MB PDF，2C4G 服务必宕）
  const maxSize = option.maxTemplateSize;
  if (maxSize > 0 && buffer.length > maxSize) {
    throw xlsxError('E_SIZE_CAP',
      `[xlsx2pdf] 模板文件过大：${(buffer.length / 1024 / 1024).toFixed(1)}MB，超过上限 ${(maxSize / 1024 / 1024).toFixed(0)}MB。` +
      '单页渲染无法承载超大模板（产物必被裁剪），请拆分数据分批生成。',
      `Template file too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB exceeds the ${(maxSize / 1024 / 1024).toFixed(0)}MB cap. ` +
      'Single-page rendering cannot carry oversized templates (output would be clipped); split the data and generate in batches.');
  }

  // 单元格数快速预检：在 ExcelJS 加载前拦截明显超限的大文件，
  // 省掉大文件加载的近 500MB 瞬时堆占用（估算值不可信时由加载后实测守卫兜底）
  const maxCells = option.maxCells;
  if (maxCells > 0) {
    const declared = await declaredCellCount(buffer, maxCells);
    if (declared !== null && declared > maxCells) {
      throw xlsxError('E_CELL_CAP',
        `[xlsx2pdf] 模板过大：预检估算约 ${declared} 个单元格，单元格数超过上限 ${maxCells}。` +
        '单页渲染无法承载超大表格（产物必被裁剪），请按业务分页拆分数据分批生成。',
        `Template too large: pre-check estimates ~${declared} cells, exceeding the ${maxCells}-cell cap. ` +
        'Single-page rendering cannot carry oversized sheets (output would be clipped); split the data by business pages and generate in batches.');
    }
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    if (isCodedError(err)) throw err;
    throw xlsxError('E_TEMPLATE_LOAD',
      `[xlsx2pdf] 模板解析失败（不是有效的 xlsx 文件或已损坏）：${err.message}`,
      `Failed to parse the template (not a valid xlsx file, or corrupted): ${err.message}`);
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw xlsxError('E_TEMPLATE_LOAD',
      '[xlsx2pdf] 模板中没有工作表，无法渲染',
      'The template contains no worksheet to render.');
  }

  // 2. 拍平数据
  const flatData = flattenObject(data);
  const globalDefaults = option.defaults || {};

  // 扩展上下文：全局插件 + 调用级 option.plugins 合并（冲突时调用级覆盖）
  const effective = resolveEffectivePlugins(option.plugins);
  // 标记解析器除内置类型外识别已注册的自定义类型 token
  const knownTypes = listMarkerTypes(effective);
  // 标记语法：默认 ${...}；自定义正则先校验契约（g 标志 + 捕获组 1）再用
  const markerRegex = option.markerRegex || DEFAULT_MARKER_REGEX;
  if (markerRegex !== DEFAULT_MARKER_REGEX) validateMarkerRegex(markerRegex);
  // 标记内部分隔符：默认 |；显式传入须为非空字符串（空串会令所有标记字段解析错乱）
  const markerSeparator = option.markerSeparator ?? DEFAULT_MARKER_SEPARATOR;
  if (typeof markerSeparator !== 'string' || markerSeparator.length === 0) {
    throw xlsxError('E_MARKER_SEPARATOR',
      'markerSeparator 必须是非空字符串（默认 "|"）',
      'markerSeparator must be a non-empty string (default "|").');
  }

  // 3. 收集列宽、行高、合并区域

  // 3a. 先收集合并区域（用于辅助检测实际使用范围）
  const merges = [];
  if (worksheet._merges) {
    for (const key of Object.keys(worksheet._merges)) {
      const m = worksheet._merges[key].model || worksheet._merges[key];
      merges.push({ top: m.top, bottom: m.bottom, left: m.left, right: m.right });
    }
  }

  // 3b. 检测实际使用的最大列和最大行（排除空列/空行）
  // ExcelJS 的 columnCount 可能包含大量空列，导致宽度计算错误
  let actualMaxCol = 0;
  let actualMaxRow = 0;
  worksheet.eachRow((row) => {
    if (row.number > actualMaxRow) actualMaxRow = row.number;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.col > actualMaxCol) actualMaxCol = cell.col;
    });
  });
  for (const m of merges) {
    if (m.right > actualMaxCol) actualMaxCol = m.right;
    if (m.bottom > actualMaxRow) actualMaxRow = m.bottom;
  }

  const columnCount = actualMaxCol || worksheet.columnCount;
  const rowCount = actualMaxRow || worksheet.rowCount;

  // 单元格数守卫（实测兜底）：须在后续逐格处理/渲染前拦截（18 万格会产出 1.1GB+ 堆占用与
  // 数十 MB HTML/近百 MB PDF，且 fit 单页布局必然裁剪，产物无意义）
  if (maxCells > 0 && rowCount * columnCount > maxCells) {
    throw xlsxError('E_CELL_CAP',
      `[xlsx2pdf] 模板过大：实际范围 ${rowCount} 行 × ${columnCount} 列 = ${rowCount * columnCount} 个单元格，单元格数超过上限 ${maxCells}。` +
      '单页渲染无法承载超大表格（产物必被裁剪），请按业务分页拆分数据分批生成。',
      `Template too large: actual range ${rowCount} rows × ${columnCount} columns = ${rowCount * columnCount} cells, exceeding the ${maxCells}-cell cap. ` +
      'Single-page rendering cannot carry oversized sheets (output would be clipped); split the data by business pages and generate in batches.');
  }

  // 3c. 收集列宽（仅取实际使用的列）
  // 列宽单位基于工作簿默认字体的数字字符宽（MDW），须用官方公式换算，
  // 固定系数会把列渲染得偏窄，导致 Excel 中单行的文本转 PDF 后被挤换行
  const defaultFont = parseDefaultFont(buffer);
  const seams = getSeams();
  const mdw = seams.resolveMdw ? seams.resolveMdw(workbook, defaultFont) : resolveCoreMdw(defaultFont);
  const columnWidths = [];
  const columnWidthUnits = []; // 原始字符宽单位，供商业版注入的浏览器端度量脚本重算
  for (let c = 1; c <= columnCount; c++) {
    const col = worksheet.getColumn(c);
    // 未显式设置 width 时按默认宽度 8.43 字符计算，而非直接给 75px
    const units = col.width || 8.43;
    columnWidthUnits.push(units);
    columnWidths.push(colWidthToPx(units, mdw));
  }

  // 3d. 收集行高（补全空行，避免行号错位）
  // Excel 行高单位是 pt，需按 96 DPI 换算为 px（1pt = 4/3 px），
  // 与字号换算（fontSize * 1.333）保持一致；否则所有行会偏矮约 25%
  const rowHeights = [];
  for (let r = 1; r <= rowCount; r++) {
    const row = worksheet.getRow(r);
    rowHeights.push((row.height || 15) * 4 / 3); // pt → px
  }

  const totalWidth = columnWidths.reduce((s, w) => s + w, 0);
  const totalHeight = rowHeights.reduce((s, h) => s + h, 0);

  // 3e. 边缘边框推断：
  // Excel 中合并区域的边缘边框可能未存储在边缘单元格上，
  // 导致 ExcelJS 读不到。预扫描最右/最左列，构建边框查找表。
  // 仅在已有边框的行范围内（firstRow ~ lastRow）做推断，避免给标题/底部区域误加边框。
  const rightBorderRef = {};  // row → right border style
  const leftBorderRef = {};   // row → left border style
  let rightBorderFirstRow = -1, rightBorderLastRow = -1;
  let leftBorderFirstRow = -1, leftBorderLastRow = -1;
  for (let r = 1; r <= rowCount; r++) {
    const rightCell = worksheet.getCell(r, columnCount);
    if (rightCell.border?.right) {
      rightBorderRef[r] = rightCell.border.right;
      if (rightBorderFirstRow === -1) rightBorderFirstRow = r;
      rightBorderLastRow = r;
    }
    const leftCell = worksheet.getCell(r, 1);
    if (leftCell.border?.left) {
      leftBorderRef[r] = leftCell.border.left;
      if (leftBorderFirstRow === -1) leftBorderFirstRow = r;
      leftBorderLastRow = r;
    }
  }

  /**
   * 在边框范围内查找最近的行边框（仅当 row 在 [firstRow, lastRow] 内时）
   */
  function findNearestBorderInRange(refMap, row, firstRow, lastRow) {
    // 仅在有边框的行范围内推断，避免误加
    if (row < firstRow || row > lastRow) return null;
    if (refMap[row]) return refMap[row];
    // 向上搜索（不超出范围）
    for (let r = row - 1; r >= firstRow; r--) {
      if (refMap[r]) return refMap[r];
    }
    // 向下搜索（不超出范围）
    for (let r = row + 1; r <= lastRow; r++) {
      if (refMap[r]) return refMap[r];
    }
    return null;
  }

  // 提取模板页面设置（自定义纸张时解包读文件内 paperWidth/paperHeight 兜底）
  const pageSetup = await extractPageSetup(worksheet, buffer);

  // 构建边框推断上下文
  const borderCtx = {
    columnCount,
    rightBorderRef,
    leftBorderRef,
    rightBorderFirstRow,
    rightBorderLastRow,
    leftBorderFirstRow,
    leftBorderLastRow,
    findNearestBorderInRange,
  };

  // 4. 遍历单元格、解析标记
  const cells = [];
  const arrayIndexMap = {}; // 记录 #数组.字段 的序号
  // 同一份报告里同一张图（签名/条码）常被多处引用，缓存避免重复下载与重复编码
  const imageCache = new Map();

  const rows = [];
  worksheet.eachRow((r) => rows.push(r));

  for (const row of rows) {
    const rowCells = [];
    // includeEmpty 遍历整行后手动过滤：无值但有样式的格子必须保留，
    // 否则其边框（含合并区域锚点格收集入口）在渲染时整格丢失
    // （ExcelJS 4.x 的 Cell 没有 hasValue 属性，只能按 value 判空）
    row.eachCell({ includeEmpty: true }, (c) => {
      if (c.value !== null && c.value !== undefined) return rowCells.push(c);
      if (hasCellVisualStyle(c)) rowCells.push(c);
    });

    for (const cell of rowCells) {
      const cellText = displayCellText(cell);
      const markers = parseCellMarkers(cellText, knownTypes, markerRegex, markerSeparator);

      // 无标记 → 尝试 key 匹配插入图片（商业版接缝），否则原样保留
      if (markers.length === 0) {
        const cellModel = buildCellModel(cell, merges, worksheet, borderCtx, defaultFont);
        let imageMatched = false;
        if (seams.autoInsertImage) {
          imageMatched = await seams.autoInsertImage({
            cell, cellText, cellModel, flatData, columnWidths, rowHeights, imageCache,
          });
        }
        // 模板富文本局部格式（Excel 单元格内局部加粗/斜体/颜色等）：无样式差异时保持纯文本输出零变化
        if (!imageMatched) {
          const runBounds = richTextSegStyles(cell, cellText, defaultFont?.size ?? null);
          if (runBounds) {
            cellModel.segments = runBounds
              .filter((b) => b.end > b.start)
              .map((b) => (b.style ? { text: cellText.slice(b.start, b.end), ...b.style } : { text: cellText.slice(b.start, b.end) }));
          }
        }
        cells.push(cellModel);
        continue;
      }

      // 有标记 → 替换处理
      let resolvedText = cellText;
      const images = [];
      const watermarks = [];
      // 模板富文本局部格式 + 同格多标记独立 minsize：text 标记替换值继承所在 run 的局部格式，
      // 逐段记录并由渲染层输出独立 span；单元格级 minSize 仅在全部文本
      // 均有下限时保留（取配置最小值，段级下限由各自 span 携带，不再相互合并掩盖）
      const segments = [];
      let hasStyledSegment = false;
      let textMinSize = 0;       // 已配置 minsize 的 text 标记下限最小值（pt）
      let textAllFloored = true; // 全部文本内容是否均有 minsize 下限
      let restText = cellText;   // 原文未消费部分（与标记出现顺序并行，供分段切分）
      const runBounds = richTextSegStyles(cell, cellText, defaultFont?.size ?? null); // 富文本 run 字位边界 + 样式差异（null = 无局部格式）
      let consumed = 0;          // 原文已消费字数（与 restText 并行，供 run 样式定位）

      /** 原文指定字位所在 run 的样式差异（供替换文本继承局部格式）；无则 null */
      const runStyleAt = (pos) => {
        if (!runBounds) return null;
        for (const b of runBounds) {
          if (pos >= b.start && pos < b.end) return b.style;
        }
        return null;
      };

      /** 静态文本按富文本 run 切分推入（各自携带局部样式）；无 run 时整段推入 */
      const pushStaticSegs = (text, startPos) => {
        if (!text) return;
        if (!runBounds) {
          segments.push({ text });
        } else {
          const end = startPos + text.length;
          for (const b of runBounds) {
            if (b.end <= startPos) continue;
            if (b.start >= end) break;
            const s = Math.max(startPos, b.start);
            const e = Math.min(end, b.end);
            if (e > s) {
              segments.push(b.style ? { text: cellText.slice(s, e), ...b.style } : { text: cellText.slice(s, e) });
              if (b.style) hasStyledSegment = true;
            }
          }
        }
        // 非空白静态文本无下限 → 单元格级下限退回全局（空白不限制收缩，不打断）
        if (text.trim()) textAllFloored = false;
      };

      /** 按标记顺序切分段落并归集单元格级下限（替换主链路共用，防御分支同样走这里） */
      const pushSegments = (marker, replaceText, opt, isTextLike) => {
        let inherit = null;
        const at = restText.indexOf(marker.raw);
        if (at !== -1) {
          pushStaticSegs(restText.slice(0, at), consumed);
          inherit = isTextLike ? runStyleAt(consumed + at) : null;
          consumed += at + marker.raw.length;
          restText = restText.slice(at + marker.raw.length);
        } else if (isTextLike) {
          inherit = runStyleAt(consumed);
        }
        // 段样式：继承标记所在富文本 run 的局部格式（加粗/斜体/下划线/删除线/字色）
        const segStyle = {};
        if (inherit && inherit.bold !== undefined) segStyle.bold = inherit.bold;
        if (inherit && inherit.italic !== undefined) segStyle.italic = inherit.italic;
        if (inherit && inherit.underline !== undefined) {
          segStyle.underline = inherit.underline;
        } else if (cell.font?.underline) {
          segStyle.underline = true;
        }
        if (inherit && inherit.strike !== undefined) {
          segStyle.strike = inherit.strike;
        } else if (cell.font?.strike) {
          segStyle.strike = true;
        }
        if (inherit?.color) segStyle.color = inherit.color;
        if (inherit?.size > 0) segStyle.size = inherit.size;
        const styled = isTextLike
          && (segStyle.bold !== undefined || segStyle.italic !== undefined || segStyle.underline !== undefined || segStyle.strike !== undefined || segStyle.color || segStyle.size > 0 || opt.minSize > 0);
        if (styled) hasStyledSegment = true;
        segments.push({
          text: replaceText,
          bold: styled ? segStyle.bold : undefined,
          italic: styled ? segStyle.italic : undefined,
          underline: styled ? segStyle.underline : undefined,
          strike: styled ? segStyle.strike : undefined,
          color: styled && segStyle.color ? segStyle.color : undefined,
          size: styled && segStyle.size > 0 ? segStyle.size : undefined,
          minSize: styled && opt.minSize > 0 ? opt.minSize : undefined,
        });
        // 单元格级下限归集：有输出文本且无下限的 text 标记打断「全有下限」；有下限者取最小
        if (isTextLike && replaceText !== '') {
          if (opt.minSize > 0) textMinSize = textMinSize > 0 ? Math.min(textMinSize, opt.minSize) : opt.minSize;
          else textAllFloored = false;
        }
      };

      for (const marker of markers) {
        // 解析字段（处理 # 数组标记）
        let field = marker.field;
        if (field.startsWith('#')) {
          // #数组.字段 明细行（社区版内置）：索引映射语义——同一标记每出现一次取下一个
          // 数组下标（arr.0.field、arr.1.field…），行数由模板固定，作者按行重复标记。
          // 非自动展开循环；数组多页批量（data 传数组）仍为商业版 Pro 能力。
          let idx = arrayIndexMap[field] ?? -1;
          arrayIndexMap[field] = idx + 1;
          field = field.replace(/#([^.]+)\./, `$1.${idx + 1}.`);
        }

        const markerCtx = { data, field, row: cell.row, col: cell.col, imageCache, numFmt: cell.numFmt, warnings: option.warnings };

        // 字段取值链路：fieldResolvers 依次调用（首个非 undefined 命中）→ flatData 扁平取值 → 标记内默认值 → 全局默认值
        // 解析器运行失败影响整份产物取值，降级无意义：包装 E_PLUGIN_RUNTIME 快速失败（已带码原样重抛）
        let fieldValue;
        for (let ri = 0; ri < effective.fieldResolvers.length; ri++) {
          try {
            fieldValue = await effective.fieldResolvers[ri](field, data, markerCtx);
          } catch (err) {
            if (isCodedError(err)) throw err;
            throw xlsxError('E_PLUGIN_RUNTIME',
              `[xlsx2pdf] 字段解析器运行失败（fieldResolvers[${ri}]，字段: ${field}）：${err.message}`,
              `Field resolver failed (fieldResolvers[${ri}], field: ${field}): ${err.message}`);
          }
          if (fieldValue !== undefined) break;
        }
        if (fieldValue === undefined) {
          fieldValue = flatData[field];
          if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
            fieldValue = marker.option.defaultValue ?? globalDefaults[field] ?? undefined;
          }
        }

        const opt = marker.option;

        // text 类标记：样式/下限逐段独立（单元格级下限归集见 pushSegments）
        const isTextLike = opt.type === 'text' || opt.type === '' || opt.type === undefined;

        // 注册表查表：插件 handler > 内置 handler（text/image/img/barcode/qrcode/watermark）
        const handler = lookupMarkerType(opt.type, effective);
        if (!handler) {
          // 理论不可达：解析器只识别已注册类型 token；防御性兜底按文本处理
          const fbText = String(fieldValue ?? '');
          pushSegments(marker, fbText, opt, isTextLike);
          // 函数式替换：避免替换文本中的 $& / $' 等序列被 replace 误解释
          resolvedText = resolvedText.replace(marker.raw, () => fbText);
          continue;
        }

        let result = null;
        try {
          result = await handler(fieldValue, opt, markerCtx);
        } catch (err) {
          // 单标记失败不拖垮整单：维持降级（清除标记继续渲染），告警入 warnings 通道并标注运行期码
          console.error(`[engine] 标记处理失败 (字段: ${field}, 类型: ${opt.type}):`, err.message);
          if (option.warnings) {
            option.warnings.push(`[engine] 标记处理失败 (字段: ${field}, 类型: ${opt.type}): ${err.message}（E_PLUGIN_RUNTIME，已按空值降级）`);
          }
        }

        // 应用 handler 结果：string → 文本替换；{ text, images } → 混合；null/undefined → 清除标记
        let replaceText = '';
        if (typeof result === 'string') {
          replaceText = result;
        } else if (typeof result === 'number' || typeof result === 'boolean') {
          // 数值/布尔按文本渲染（text handler 无 numFmt 时原样返回值，
          // 不在此兜底会被当空值清除；插件 handler 返回数值同样适用）
          replaceText = String(result);
        } else if (result && typeof result === 'object') {
          if (typeof result.text === 'string') replaceText = result.text;
          if (Array.isArray(result.images)) {
            for (const img of result.images) {
              if (!img || !img.dataUrl) continue;
              images.push({
                dataUrl: img.dataUrl,
                // 0 = 未设置：由压缩管线按图片原始尺寸/宽高比归一化
                //（未设宽高 → 原图大小；只设一边 → 另一边按原图比例）
                width: img.width > 0 ? img.width : 0,
                height: img.height > 0 ? img.height : 0,
                offsetX: img.offsetX || 0,
                offsetY: img.offsetY || 0,
                zIndex: img.zIndex || 0,
                opacity: img.opacity ?? null,
              });
            }
          }
          if (Array.isArray(result.watermarks)) {
            for (const p of result.watermarks) {
              if (!p || typeof p.text !== 'string' || p.text === '') continue;
              watermarks.push({
                text: p.text,
                zIndex: p.zIndex || 0,
                opacity: p.opacity ?? null,
                minSize: p.minSize || 0,
                lineHeight: p.lineHeight || 0,
              });
            }
          }
        }
        pushSegments(marker, replaceText, opt, isTextLike);
        // 函数式替换：避免替换文本中的 $& / $' / $$ 等序列被 replace 特殊解释，
        // 导致同格多标记场景下值被篡改或后续标记残留
        resolvedText = resolvedText.replace(marker.raw, () => replaceText);
      }

      // 收尾静态文本（最后一个标记之后的部分，按富文本 run 携带局部样式）
      pushStaticSegs(restText, consumed);

      // 清理纯空白文本（只剩空格/换行）
      if (resolvedText.trim() === '' && (images.length > 0 || watermarks.length > 0)) {
        resolvedText = '';
        segments.length = 0;
        hasStyledSegment = false;
      }

      const cellModel = buildCellModel(cell, merges, worksheet, borderCtx, defaultFont);
      cellModel.text = resolvedText;
      cellModel.images = images;
      cellModel.watermarks = watermarks;
      // 单元格级缩字号下限：仅当全部文本均有下限时输出（取配置最小值，段级下限各自独立）；
      // 否则退回全局下限，避免无下限的静态文本/标记被高下限拖住无法收缩
      cellModel.minSize = textAllFloored ? textMinSize : 0;
      if (hasStyledSegment) cellModel.segments = segments.filter((s) => s.text !== '');
      cells.push(cellModel);
    }
  }

  // 5. 嵌入图片尺寸归一/压缩：商业版接缝（sharp 缩至显示尺寸 + 格式转换 + DPI 归一）优先；
  // 未注入时核心以纯 JS image-size 兜底归一（@96DPI、不压缩），保证未设宽高的图可见
  if (seams.optimizeImages) await seams.optimizeImages(cells, columnWidths, rowHeights);
  else await normalizeImageSizes(cells);

  let model = {
    columnCount,
    columnWidths,
    columnWidthUnits,
    rowHeights,
    merges,
    cells,
    totalWidth,
    totalHeight,
    pageSetup,
    defaultFont,
  };

  // 6. 模型后处理钩子（transformModel，按注册顺序调用；返回新 model 则替换）
  // 钩子运行失败影响整份模型，降级无意义：包装 E_PLUGIN_RUNTIME 快速失败（已带码原样重抛）
  for (let hi = 0; hi < effective.transformModels.length; hi++) {
    let out;
    try {
      out = await effective.transformModels[hi](model, { data, option });
    } catch (err) {
      if (isCodedError(err)) throw err;
      throw xlsxError('E_PLUGIN_RUNTIME',
        `[xlsx2pdf] 模型后处理钩子运行失败（transformModel[${hi}]）：${err.message}`,
        `Model post-processing hook failed (transformModel[${hi}]): ${err.message}`);
    }
    if (out) model = out;
  }

  return model;
}

/**
 * 从 worksheet 提取页面设置（纸张大小、方向、页边距、缩放比例）。
 * 纸张枚举无法映射（自定义纸代码 >= 256 / 非标准代码 / 未写 paperSize）时，
 * 尝试经 seams.readCustomPaper 读文件内的 paperWidth/paperHeight 兜底（商业版注入）；
 * 枚举可映射的常规模板不触发这次额外解包
 * @param {Object} worksheet - ExcelJS Worksheet
 * @param {Buffer} [buf] - 模板文件内容（自定义纸张兜底读取用）
 */
async function extractPageSetup(worksheet, buf) {
  const ps = worksheet.pageSetup || {};
  const seams = getSeams();

  let pageSize = PAPER_SIZE_MAP[ps.paperSize] || null;
  if (!pageSize && buf && seams.readCustomPaper) {
    pageSize = await seams.readCustomPaper(buf);
  }

  return {
    orientation: ps.orientation || 'portrait',
    pageSize,
    paperSizeCode: ps.paperSize || null,
    scale: ps.scale != null ? ps.scale / 100 : null,  // Excel 100 = 100% → 1.0
    margins: ps.margins ? {
      top: inchesToMm(ps.margins.top),
      right: inchesToMm(ps.margins.right),
      bottom: inchesToMm(ps.margins.bottom),
      left: inchesToMm(ps.margins.left),
    } : null,
  };
}

/** 英寸转毫米 */
function inchesToMm(inches) {
  return inches != null ? Math.round(inches * 25.4 * 10) / 10 : null;
}


/**
 * 静态单元格显示文本：带非 General numFmt 的数值/日期格按格式渲染
 * （与 Excel 填值所见一致）；ExcelJS 的 cell.text 不应用 numFmt，
 * 直接取会泄漏原始值（如 1.1231 而非 ¥1.12）。合并单元格 value 为 null
 * 时 .text 会抛异常，兜底空串。
 * @param {Object} cell - ExcelJS Cell
 * @returns {string}
 */
function displayCellText(cell) {
  const value = cell.value;
  if ((typeof value === 'number' || value instanceof Date) && cell.numFmt) {
    const out = formatValue(value, cell.numFmt);
    if (typeof out === 'string') return out;
  }
  try { return cell.text || ''; } catch (_) { return ''; }
}

/**
 * 读取单元格富文本 run（Excel 局部文本格式：单元格内局部加粗/斜体/下划线/删除线/字色，
 * ExcelJS 存为 cell.value.richText），换算为相对单元格级字体的逐 run 样式差异；
 * 全部 run 与单元格字体无差异（或 run 拼接与显示文本不一致）时返回 null，
 * 渲染保持纯文本输出（HTML 零变化，模板内重复字体声明不产生额外 span）。
 * 有意不参与差异的 run 属性：字体名/主题色（避免干扰字号自适应与主题解析）。
 * @param {Object} cell - ExcelJS Cell
 * @param {string} cellText - 单元格显示文本（用于长度校验）
 * @param {number|null} defaultSize - 工作簿默认字号（pt），单元格级无字号时作为差异比较基准
 * @returns {Array<{start:number,end:number,style:Object|null}>|null} run 字位边界 + 样式差异
 */
function richTextSegStyles(cell, cellText, defaultSize = null) {
  const value = cell.value;
  if (!value || typeof value !== 'object' || !Array.isArray(value.richText) || value.richText.length === 0) return null;
  const base = cell.font || {};
  const baseColor = base.color?.argb || null;
  const baseSize = base.size || defaultSize || null;
  const bounds = [];
  let pos = 0;
  let hasDiff = false;
  for (const run of value.richText) {
    const text = run.text || '';
    const f = run.font || {};
    const style = {};
    // bold/italic/underline/strike 双向差异（run 可取消单元格级样式）。
    // run 未声明时继承 base，避免把继承误判为取消。
    const runBold = f.bold !== undefined ? f.bold : base.bold;
    const runItalic = f.italic !== undefined ? f.italic : base.italic;
    const runUnderline = f.underline !== undefined ? f.underline : base.underline;
    const runStrike = f.strike !== undefined ? f.strike : base.strike;
    if (!!runBold !== !!base.bold) style.bold = !!runBold;
    if (!!runItalic !== !!base.italic) style.italic = !!runItalic;
    if (!!runUnderline !== !!base.underline) style.underline = !!runUnderline;
    if (!!runStrike !== !!base.strike) style.strike = !!runStrike;
    const runColor = f.color?.argb || null;
    // run 未声明颜色时继承 baseColor，避免把继承误判为黑色差异
    const effectiveRunColor = runColor || baseColor;
    if (effectiveRunColor !== baseColor) {
      style.color = effectiveRunColor ? `#${effectiveRunColor.replace(/^FF/, '')}` : '#000000';
    }
    // 字号差异：run 显式设置了与单元格级不同的字号时按段输出（绝对 pt → px 渲染）
    if (f.size != null && f.size !== baseSize) style.size = f.size;
    const has = Object.keys(style).length > 0;
    if (has) hasDiff = true;
    bounds.push({ start: pos, end: pos + text.length, style: has ? style : null });
    pos += text.length;
  }
  if (!hasDiff || pos !== cellText.length) return null;
  return bounds;
}

/**
 * 从 ExcelJS Cell 构建 CellModel（样式提取）
 */
function buildCellModel(cell, merges, worksheet, borderCtx = {}, defaultFont = null) {
  const text = displayCellText(cell);

  // 合并单元格信息
  const mergeInfo = merges.find(
    (m) => m.top <= cell.row && m.bottom >= cell.row && m.left <= cell.col && m.right >= cell.col
  );
  const isStart = mergeInfo && mergeInfo.top === cell.row && mergeInfo.left === cell.col;

  // 合并单元格外侧边框收集：
  // Excel 中合并区域的外侧边框可能定义在区域内的任意单元格上，
  // 而非仅起始格。需遍历合并区域边缘单元格，取外侧边框的并集。
  let border = cell.border ? { ...cell.border } : null;
  if (isStart && worksheet) {
    const m = mergeInfo;

    // 收集上边：合并区域第一行的所有单元格
    for (let c = m.left; c <= m.right; c++) {
      const b = worksheet.getCell(m.top, c).border;
      if (b?.top && !border?.top) {
        if (!border) border = {};
        border.top = b.top;
      }
    }
    // 收集下边：合并区域最后一行的所有单元格
    for (let c = m.left; c <= m.right; c++) {
      const b = worksheet.getCell(m.bottom, c).border;
      if (b?.bottom && !border?.bottom) {
        if (!border) border = {};
        border.bottom = b.bottom;
      }
    }
    // 收集左边：合并区域第一列的所有单元格
    for (let r = m.top; r <= m.bottom; r++) {
      const b = worksheet.getCell(r, m.left).border;
      if (b?.left && !border?.left) {
        if (!border) border = {};
        border.left = b.left;
      }
    }
    // 收集右边：合并区域最后一列的所有单元格
    for (let r = m.top; r <= m.bottom; r++) {
      const b = worksheet.getCell(r, m.right).border;
      if (b?.right && !border?.right) {
        if (!border) border = {};
        border.right = b.right;
      }
    }

    // 边缘边框推断：仅在已有边框的行范围内推断，避免给标题/底部区域误加边框
    if (!border?.right && m.right === borderCtx.columnCount) {
      const inferred = borderCtx.findNearestBorderInRange(
        borderCtx.rightBorderRef, m.top, borderCtx.rightBorderFirstRow, borderCtx.rightBorderLastRow
      );
      if (inferred) {
        if (!border) border = {};
        border.right = inferred;
      }
    }
    if (!border?.left && m.left === 1) {
      const inferred = borderCtx.findNearestBorderInRange(
        borderCtx.leftBorderRef, m.top, borderCtx.leftBorderFirstRow, borderCtx.leftBorderLastRow
      );
      if (inferred) {
        if (!border) border = {};
        border.left = inferred;
      }
    }
  }

  return {
    row: cell.row,
    col: cell.col,
    text,
    images: [],
    font: {
      bold: cell.font?.bold || false,
      // 未显式设置字号的单元格继承工作簿默认字体，避免渲染时 fallback 到硬编码 14px
      size: cell.font?.size || defaultFont?.size || null,       // pt
      color: cell.font?.color?.argb || null,
      italic: cell.font?.italic || false,
      underline: cell.font?.underline || false,
      strike: cell.font?.strike || false,
    },
    alignment: {
      horizontal: cell.alignment?.horizontal || 'left',
      vertical: cell.alignment?.vertical || 'top',
      wrapText: cell.alignment?.wrapText || false,
      shrinkToFit: cell.alignment?.shrinkToFit || false,
    },
    border,
    fill: cell.fill?.fgColor?.argb ? { fgColor: cell.fill.fgColor.argb } : null,
    rowspan: isStart ? mergeInfo.bottom - mergeInfo.top + 1 : 1,
    colspan: isStart ? mergeInfo.right - mergeInfo.left + 1 : 1,
    isMergeStart: !!isStart,
    isInMerge: !!mergeInfo && !isStart,
  };
}

// 图片解析/缓存（resolveImage / resolveImageCached）为商业版增强实现，
// 随 seams.autoInsertImage 与增强标记 handler 一同注入（见 pro/image.js）

// ============================================================
// 内置标记类型 handler（行为与原引擎硬分支逐字节一致，注册进注册表）
// ============================================================

/** text：数字格式自动继承——模板单元格设了非 General 的 numFmt（百分比/货币/千分位/日期等）
 * 且值为数值/日期型时按格式渲染（与 Excel 填值所见一致）；否则原样返回 */
function textHandler(value, option, ctx) {
  if (value === undefined || value === null) return '';
  if (ctx?.numFmt) {
    const out = formatValue(value, ctx.numFmt);
    if (typeof out === 'string') return out;
  }
  return value ?? '';
}

// 核心内置 text + image/img/barcode/qrcode（富媒体基础形态，社区版可用）；
// watermark 等其余增强类型由商业版经内部注册表（xlsx2pdf/internal/registry）注入
registerBuiltinMarkerTypes({
  text: textHandler,
  image: imageLikeHandler,
  img: imageLikeHandler,
  barcode: imageLikeHandler,
  qrcode: imageLikeHandler,
});
