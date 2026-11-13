/**
 * Excel 数字格式（numFmt）渲染器
 *
 * 职责：把注入的字段值按模板单元格的数字格式渲染（自动继承），
 * 与 Excel 中直接填值所见一致（0.1234 + `0.00%` → "12.34%"）。
 *
 * 实现范围（常用子集）：
 *  - 数字：0/# 占位、千分位、尾部逗号缩放、百分比、货币符号、正负零分节、引号字面量
 *  - 日期：y/m/d/h/s token、12 小时制 AM/PM 与 上午/下午、[h] 历时
 * 不支持的冷门格式（分数、科学计数、条件节等）一律兜底原样输出，绝不抛错
 */

// ECMA-376 内置格式 id 映射（ExcelJS 对内置格式可能返回数字 id；164+ 为自定义格式串）
export const BUILTIN_NUMFMTS = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  11: '0.00E+08',
  12: '# ?/?',
  13: '# ??/??',
  14: 'mm-dd-yy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'm/d/yy h:mm',
  37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mmss.0',
  48: '##0.0E+0',
  49: '@',
};

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * 格式归一化：数字 id → 格式串；General/空 → null（不格式化）
 * @param {string|number} fmt
 * @returns {string|null}
 */
function normalizeFmt(fmt) {
  if (fmt === undefined || fmt === null || fmt === '') return null;
  const s = typeof fmt === 'number' ? (BUILTIN_NUMFMTS[fmt] ?? '') : String(fmt);
  if (!s || /^general$/i.test(s.trim()) || s.trim() === '@') return null;
  return s;
}

/**
 * 按分节拆分格式串（正;负;零;文本），引号内的分号不拆
 * @param {string} fmt
 * @returns {string[]}
 */
function splitSections(fmt) {
  const sections = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch === '"') {
      inQuote = !inQuote;
      cur += ch;
      continue;
    }
    if (ch === ';' && !inQuote) {
      sections.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  sections.push(cur);
  return sections;
}

/**
 * 判断格式串是否为日期/时间格式：剥离引号字面量、转义符、方括号节后
 * 仍含 y/d/h/s 日期时间 token 即认定（纯数字格式不含这些字母）
 * @param {string} fmt
 * @returns {boolean}
 */
function isDateFormat(fmt) {
  const stripped = fmt
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/上午\/下午/g, '');
  return /[ydhs]/i.test(stripped);
}

// ============================================================
// 数字格式
// ============================================================

/**
 * 数字分节 tokenize：产出 [{ t:'lit', v }] 与 [{ t:'fmt', v }] 序列
 *  - "..." 引号字面 / \转义 → lit
 *  - [$¥-804] 货币注释节 → 提取符号作 lit；[Red] 颜色节、[$-409] locale 节 → 忽略
 *  - *x 填充 / _x 占宽 → 忽略
 *  - 0 # , . ? % → 汇入 fmt 核心
 *  - 其余字符 → lit
 */
function tokenizeSection(section) {
  const tokens = [];
  let core = '';
  const pushCore = () => {
    if (core) {
      tokens.push({ t: 'fmt', v: core });
      core = '';
    }
  };
  for (let i = 0; i < section.length; i++) {
    const ch = section[i];
    if (ch === '"') {
      const end = section.indexOf('"', i + 1);
      pushCore();
      tokens.push({ t: 'lit', v: end === -1 ? section.slice(i + 1) : section.slice(i + 1, end) });
      i = end === -1 ? section.length : end;
      continue;
    }
    if (ch === '\\' && i + 1 < section.length) {
      pushCore();
      tokens.push({ t: 'lit', v: section[i + 1] });
      i++;
      continue;
    }
    if (ch === '[') {
      const end = section.indexOf(']', i);
      if (end !== -1) {
        const inner = section.slice(i + 1, end);
        const money = /^\$([^-\]]+)/.exec(inner);
        if (money) {
          pushCore();
          tokens.push({ t: 'lit', v: money[1] });
        }
        // [Red]/[DBNum1]/[$-409]/条件节：本实现忽略（不改变文本输出）
        i = end;
        continue;
      }
    }
    if (ch === '*' || ch === '_') {
      i++; // 跳过填充/占宽符及其作用字符
      continue;
    }
    if (/[0#,?]/.test(ch)) {
      core += ch;
      continue;
    }
    if (ch === '%') {
      // 百分号作字面保留布局（×100 换算在渲染时按出现次数计），避免被核心吞掉丢失输出
      pushCore();
      tokens.push({ t: 'lit', v: '%' });
      continue;
    }
    if (ch === '.') {
      core += ch;
      continue;
    }
    pushCore();
    tokens.push({ t: 'lit', v: ch });
  }
  pushCore();
  return tokens;
}

/**
 * 按单个分节渲染数字
 * @param {number} absNum - 绝对值（分节已按符号选定）
 * @param {string} section - 分节格式串
 * @returns {string|null} 不支持的格式（科学计数/分数）返回 null 触发兜底
 */
function renderNumberSection(absNum, section) {
  // 冷门格式兜底：科学计数（E 未被 tokenize 收入核心，须在此基于原始分节判定）
  if (/\\?E[+-]/i.test(section)) return null;
  const tokens = tokenizeSection(section);
  const core = tokens.filter((t) => t.t === 'fmt').map((t) => t.v).join('');
  if (!core) {
    // 纯字面量分节（如 "(" 与 ")" 成对出现的负数括号格式）：直接拼接字面
    return tokens.map((t) => (t.t === 'lit' ? t.v : '')).join('');
  }
  // 冷门格式兜底：分数占位
  if (core.includes('?')) return null;

  const percentCount = tokens.filter((t) => t.t === 'lit' && t.v === '%').length;
  // 逗号双义：最后一个占位符之后的逗号为缩放（每逗号 ÷1000），之前的为千分位；两者可共存（如 #,##0,）
  const lastPlaceholder = Math.max(core.lastIndexOf('0'), core.lastIndexOf('#'));
  let scaleCommas = 0;
  for (let i = lastPlaceholder + 1; i < core.length; i++) {
    if (core[i] === ',') scaleCommas++;
  }
  const grouping = core.slice(0, lastPlaceholder + 1).includes(',');

  const dotIdx = core.indexOf('.');
  const intPart = dotIdx === -1 ? core : core.slice(0, dotIdx);
  const fracPart = dotIdx === -1 ? '' : core.slice(dotIdx + 1);
  const intMin = (intPart.match(/0/g) || []).length;
  // 小数位只计占位符（0/#/?），不含其余字符
  const decimals = (fracPart.match(/[0#?]/g) || []).length;

  let num = absNum;
  for (let i = 0; i < percentCount; i++) num *= 100;
  for (let i = 0; i < scaleCommas; i++) num /= 1000;

  const fixed = num.toFixed(decimals);
  const [rawInt, rawFrac = ''] = fixed.split('.');
  let intStr = rawInt.padStart(intMin, '0');
  if (grouping) {
    intStr = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  let fracStr = rawFrac;
  // 分节小数位含 # 时去除尾零（0.5 + 0.## → "0.5" 而非 "0.50"）
  if (fracPart.includes('#')) fracStr = fracStr.replace(/0+$/, '');

  const number = intStr + (fracStr ? '.' + fracStr : '');

  // 按 token 布局组装：fmt 核心前的字面为前缀，其后为后缀
  const firstFmt = tokens.findIndex((t) => t.t === 'fmt');
  const prefix = tokens.slice(0, firstFmt).map((t) => t.v).join('');
  const suffix = tokens.slice(firstFmt + 1).map((t) => (t.t === 'lit' ? t.v : '')).join('');
  return prefix + number + suffix;
}

/**
 * 数字格式化（含分节选择）
 * @param {number} num
 * @param {string} fmt
 * @returns {string|null} 不支持时返回 null
 */
function formatNumber(num, fmt) {
  const sections = splitSections(fmt);
  let section;
  let forceMinus = false;
  if (sections.length === 1) {
    section = sections[0];
    forceMinus = num < 0; // 单分节：负数前置负号
  } else if (sections.length === 2) {
    section = num < 0 ? sections[1] : sections[0];
  } else {
    section = num > 0 ? sections[0] : num < 0 ? sections[1] : sections[2];
  }
  const out = renderNumberSection(Math.abs(num), section);
  if (out === null) return null;
  return forceMinus ? '-' + out : out;
}

// ============================================================
// 日期/时间格式
// ============================================================

/**
 * 日期格式分节选择：中文 Excel/WPS 的日期格式常带文本分节（如 yyyy-mm-dd;@），
 * 分号后的 ;@ 仅对文本值生效，数值/日期若拿整个格式串渲染会泄漏出「;@」字面。
 * 数值按符号选节（与数字分节同规则），JS Date 恒取首节
 * @param {string} fmt - 完整格式串
 * @param {number} [num] - 数值（可省略，Date 场景）
 * @returns {string} 选中的分节格式串
 */
function pickDateSection(fmt, num) {
  const sections = splitSections(fmt);
  if (sections.length === 1) return sections[0];
  if (typeof num !== 'number') return sections[0];
  return num > 0 ? sections[0] : num < 0 ? (sections[1] ?? sections[0]) : (sections[2] ?? sections[0]);
}

/**
 * Excel 序列值 → 日期分量（epoch 1899-12-30；serial>60 与现代历法一致，
 * 1900 年初的 1 天偏差来自 Excel 闰年 bug，报告场景可忽略）
 */
function serialToParts(serial) {
  const days = Math.floor(serial);
  const msOfDay = Math.round((serial - days) * 86400000);
  const dt = new Date(Date.UTC(1899, 11, 30) + days * 86400000 + msOfDay);
  return {
    y: dt.getUTCFullYear(),
    M: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
    h: dt.getUTCHours(),
    m: dt.getUTCMinutes(),
    s: dt.getUTCSeconds(),
    totalMs: Math.round(serial * 86400000),
  };
}

/** JS Date → 日期分量（本地时区） */
function dateToParts(date) {
  return {
    y: date.getFullYear(),
    M: date.getMonth() + 1,
    d: date.getDate(),
    h: date.getHours(),
    m: date.getMinutes(),
    s: date.getSeconds(),
    totalMs: date.getTime(),
  };
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * 按日期格式 token 渲染
 * @param {string} fmt
 * @param {Object} parts - serialToParts/dateToParts 输出
 * @returns {string}
 */
function renderDate(fmt, parts) {
  const use12h = /AM\/PM|A\/P|上午\/下午/i.test(fmt);
  const tokenRe = /"[^"]*"|\\.|_[\s\S]|\*[\s\S]|\[[hms]+\]|yyyy|yy|mmmm|mmm|mm|m|dddd|dd|d|hh|h|ss|s|AM\/PM|A\/P|上午\/下午|./gi;

  // 两趟处理：先 tokenize，再按上下文判定 mm/m 是月还是分
  const tokens = [];
  let match;
  while ((match = tokenRe.exec(fmt)) !== null) tokens.push(match[0]);

  const isMinute = (idx) => {
    for (let i = idx - 1; i >= 0; i--) {
      if (/^h+$/i.test(tokens[i])) return true;
      if (/^[ymd]+$/i.test(tokens[i])) return false;
    }
    for (let i = idx + 1; i < tokens.length; i++) {
      if (/^s+$/i.test(tokens[i])) return true;
      if (/^[ymd]+$/i.test(tokens[i])) return false;
    }
    return false;
  };

  let out = '';
  let h = parts.h;
  if (use12h) {
    h = h % 12 || 12;
  }

  tokens.forEach((tok, idx) => {
    const lower = tok.toLowerCase();
    switch (true) {
      case /^"/.test(tok):
        out += tok.slice(1, tok.length - (tok.endsWith('"') ? 1 : 0));
        break;
      case tok[0] === '\\' && tok.length > 1:
        out += tok[1];
        break;
      case tok[0] === '_' || tok[0] === '*':
        break; // 占宽/填充符忽略
      case /^\[h+\]$/i.test(tok):
        out += String(Math.floor(parts.totalMs / 3600000));
        break;
      case /^\[m+\]$/i.test(tok):
        out += String(Math.floor(parts.totalMs / 60000));
        break;
      case /^\[s+\]$/i.test(tok):
        out += String(Math.floor(parts.totalMs / 1000));
        break;
      case lower === 'yyyy': out += String(parts.y).padStart(4, '0'); break;
      case lower === 'yy': out += String(parts.y).slice(-2).padStart(2, '0'); break;
      case lower === 'mmmm': out += MONTH_ABBR[parts.M - 1]; break;
      case lower === 'mmm': out += MONTH_ABBR[parts.M - 1]; break;
      case lower === 'mm': out += isMinute(idx) ? pad2(parts.m) : pad2(parts.M); break;
      case lower === 'm': out += isMinute(idx) ? String(parts.m) : String(parts.M); break;
      case lower === 'dddd':
      case lower === 'dd': out += pad2(parts.d); break;
      case lower === 'd': out += String(parts.d); break;
      case lower === 'hh': out += pad2(h); break;
      case lower === 'h': out += String(h); break;
      case lower === 'ss': out += pad2(parts.s); break;
      case lower === 's': out += String(parts.s); break;
      case /^am\/pm$/i.test(tok): out += parts.h < 12 ? 'AM' : 'PM'; break;
      case /^a\/p$/i.test(tok): out += parts.h < 12 ? 'A' : 'P'; break;
      case /^上午\/下午$/.test(tok): out += parts.h < 12 ? '上午' : '下午'; break;
      default: out += tok;
    }
  });
  return out;
}

// ============================================================
// 主入口
// ============================================================

/**
 * 按 Excel 数字格式渲染字段值
 *
 * @param {*} value - 字段值（number / JS Date / 可解析数字字符串；其他类型原样返回）
 * @param {string|number} fmt - numFmt（格式串或内置格式 id；General/空 → 原样返回）
 * @returns {string} 渲染结果；任何不支持/异常一律兜底原样输出
 */
export function formatValue(value, fmt) {
  try {
    if (value === undefined || value === null || value === '') return String(value ?? '');
    const fmtStr = normalizeFmt(fmt);
    if (!fmtStr) return String(value);

    // JS Date：任何格式都走日期渲染（无日期 token 的格式少见，兜底仍安全）；
    // 先按分节选取，避免多分节格式的文本节（;@）被当字面渲染
    if (value instanceof Date) {
      return isDateFormat(fmtStr) ? renderDate(pickDateSection(fmtStr), dateToParts(value)) : String(value);
    }

    const num = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)) ? Number(value) : NaN;
    if (Number.isNaN(num)) return String(value); // 非数值文本不格式化

    if (isDateFormat(fmtStr)) return renderDate(pickDateSection(fmtStr, num), serialToParts(num));
    const out = formatNumber(num, fmtStr);
    return out === null ? String(value) : out;
  } catch (_) {
    return String(value);
  }
}
