/**
 * 数据面注入回归：图片属性 / 颜色 / 对齐 / CSP
 *
 * 背景：模板里的图片与样式最终会被拼进 HTML。历史实现把 img.dataUrl 原样
 * 写进 src 属性、把颜色字符串直接拼进 style，一旦值来自外部数据就能跳出
 * 属性注入事件处理器。本用例锁定三条防线：
 *   1. normalizeImageDataUrl：严格 base64 字符集 + 内容校验 + 重编码，
 *      “合法图片前缀 + 属性尾巴”不再能通过；
 *   2. 渲染层 escapeAttr / 颜色与对齐白名单：sink 处再挡一次；
 *   3. 产物含 CSP：即使被注入，网络外连与表单提交仍被禁止。
 *
 * 直跑 src（不经 dist），改动后无需重建即可验证渲染层。
 */
import assert from 'node:assert/strict';
import { normalizeImageDataUrl } from '../src/image.js';
import { renderHtml } from '../src/render.js';

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}: ${err.message}`);
  }
}

// 2×2 PNG（与安全探针同源的最小合法图）
const PNG_2x2 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP8z8DAwMDAxMAAAB0eAQc5o8H7AAAAAElFTkSuQmCC';
// 1×1 透明 PNG，base64 以 == 结尾：专门用于验证 padding 补齐（2×2 那张无 padding，断言会空转）
const PNG_1x1_PAD = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const Q = String.fromCharCode(34); // 双引号

console.log('[1] normalizeImageDataUrl 严格格式');
check('合法 PNG 通过并保持 data URL 形式', () => {
  const out = normalizeImageDataUrl(`data:image/png;base64,${PNG_2x2}`);
  assert.match(out, /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
});
check('尾部夹带属性被拒绝（宽松 base64 会静默丢弃尾巴）', () => {
  const evil = `data:image/png;base64,${PNG_2x2}${Q} onerror=${Q}alert(1)${Q} x=${Q}`;
  assert.equal(normalizeImageDataUrl(evil), null);
});
check('SVG 前缀 + 属性尾巴被拒绝', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>').toString('base64');
  const evil = `data:image/svg+xml;base64,${svg}${Q} onerror=${Q}alert(1)`;
  assert.equal(normalizeImageDataUrl(evil), null);
});
check('非 base64 字符（空格/尖括号）被拒绝', () => {
  assert.equal(normalizeImageDataUrl(`data:image/png;base64,${PNG_2x2} <`), null);
});
check('非 image/ 前缀被拒绝', () => {
  assert.equal(normalizeImageDataUrl(`data:text/html;base64,${Buffer.from('<b>x</b>').toString('base64')}`), null);
});
check('内容不是图片被拒绝（魔数校验）', () => {
  assert.equal(normalizeImageDataUrl(`data:image/png;base64,${Buffer.from('not an image').toString('base64')}`), null);
});
check('无 padding 的合法 base64 被接受并重编码补齐', () => {
  assert.match(PNG_1x1_PAD, /=+$/, '夹具必须带 padding，否则本断言无法验证补齐');
  const noPad = PNG_1x1_PAD.replace(/=+$/, '');
  assert.notEqual(noPad, PNG_1x1_PAD, '去掉 padding 后必须真的变化');
  const out = normalizeImageDataUrl(`data:image/png;base64,${noPad}`);
  assert.equal(out, `data:image/png;base64,${PNG_1x1_PAD}`, '应重编码为带 padding 的标准形式');
});

console.log('[2] 渲染层 sink');
const baseModel = {
  columnWidths: [120],
  columnCount: 1,
  rowHeights: [24],
  totalWidth: 120,
  defaultFont: { name: 'SimSun', size: 11 },
  pageSetup: {},
  merges: [],
  cells: [],
};
const cell = (patch) => ({
  row: 1, col: 1, rowspan: 1, colspan: 1, text: 't', isInMerge: false, ...patch,
});

check('图片 dataUrl 中的引号被转义（不能跳出 src 属性）', () => {
  const html = renderHtml({
    ...baseModel,
    cells: [cell({
      images: [{
        dataUrl: `data:image/png;base64,AAAA${Q} onerror=${Q}alert(1)${Q} x=${Q}`,
        width: 10, height: 10, offsetX: 0, offsetY: 0, zIndex: 0,
      }],
    })],
  });
  assert.ok(!html.includes('" onerror="'), '输出不应出现未转义的 onerror 属性');
  assert.ok(html.includes('&quot;'), '引号应被转义为 &quot;');
});

check('颜色值不合法时回退默认色（不拼进 style）', () => {
  const html = renderHtml({
    ...baseModel,
    cells: [cell({ font: { size: 11, color: `FF0000${Q};background:url(//evil)` } })],
  });
  assert.ok(!html.includes('evil'), '非法颜色不应进入输出');
});

check('合法 ARGB 颜色正常输出', () => {
  const html = renderHtml({ ...baseModel, cells: [cell({ font: { size: 11, color: 'FFFF0000' } })] });
  assert.ok(html.includes('color:#FF0000'), '8 位 ARGB 应剥掉 alpha');
});

check('6 位颜色以 FF 开头不被截断（历史 bug）', () => {
  const html = renderHtml({ ...baseModel, cells: [cell({ font: { size: 11, color: 'FF0000' } })] });
  assert.ok(html.includes('color:#FF0000'), '6 位 RRGGBB 不应被当作 ARGB 截断');
});

check('对齐值白名单（分号注入被丢弃）', () => {
  const html = renderHtml({
    ...baseModel,
    cells: [cell({ alignment: { horizontal: 'left;background:url(//evil)', vertical: 'middle;x:y' } })],
  });
  assert.ok(!html.includes('evil'));
  assert.ok(html.includes('text-align:left'));
  assert.ok(html.includes('vertical-align:top'));
});

check('Excel 垂直分散对齐映射为 middle（不因白名单改变旧观感）', () => {
  const html = renderHtml({ ...baseModel, cells: [cell({ alignment: { vertical: 'distributed' } })] });
  assert.ok(html.includes('vertical-align:middle'), 'distributed 应映射 middle');
});

check('产物包含 CSP（禁止网络外连与表单提交）', () => {
  const html = renderHtml({ ...baseModel, cells: [cell()] });
  assert.ok(html.includes('Content-Security-Policy'), '应有 CSP meta');
  assert.ok(/connect-src 'none'/.test(html), '应禁止 connect-src');
  assert.ok(/form-action 'none'/.test(html), '应禁止表单提交');
});

// ===== 构建产物端到端：以上断言跑在 src，这里再让 dist 产物走一遍真实模板 =====
// src 与 dist 之间隔着 esbuild（minify 会重命名局部标识符），注入防范必须在产物上同样成立
async function checkDist(name, fn) {
  try {
    await fn();
    console.log(`  ok   [dist] ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL [dist] ${name}: ${err.message}`);
  }
}

const { makeTemplates } = await import('./make-template.mjs');
const url = await import('node:url');
const path = await import('node:path');
const dist = await import('../dist/index.mjs');
const tplDir = path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'output');
const tpl = await makeTemplates(tplDir);
const PNG_URL = `data:image/png;base64,${PNG_2x2}`;
const DATA = {
  name: '张三',
  dept: '质检部',
  info: { level: 'A' },
  amount: 1234.5,
  date: 46338,
};

await checkDist('产物含 CSP 且合法图片正常嵌入', async () => {
  const { html } = await dist.excel2html({ template: tpl.proMarker, data: { photo: PNG_URL } });
  assert.ok(html.includes('Content-Security-Policy'), 'dist 产物应有 CSP meta');
  assert.ok(html.includes('<img'), '合法图片应嵌入');
});

await checkDist('图片夹带属性尾巴在产物中被丢弃', async () => {
  const bad = `${PNG_URL}" onerror="alert(1)`;
  const { html } = await dist.excel2html({ template: tpl.proMarker, data: { photo: bad } });
  assert.ok(!html.includes('onerror'), '属性尾巴不应进入产物');
});

await checkDist('8 位 ARGB 背景色在产物中剥 alpha', async () => {
  const { html } = await dist.excel2html({ template: tpl.basic, data: DATA });
  assert.ok(html.includes('background-color:#E8F5E9'), 'FFE8F5E9 应输出 #E8F5E9');
});

if (failed > 0) {
  console.error(`\nsecurity-injection: ${failed} 项失败`);
  process.exit(1);
}
console.log('\nsecurity-injection: all passed');
