/**
 * 社区版标记类型别名可配置回归守卫（1.7.0：markerAliases 新增功能项）
 *
 * 契约：
 *  ① 内置默认 img→image / print→watermark 与规范名产物字节一致
 *  ② 自定义别名 seal→watermark 生效（替换语义）
 *  ③ {} 清空后 img/print 未注册抛 E_MARKER_ALIAS（不静默降级 text，internal.2 缺陷保护）；
 *     其余未知 token 维持 text 兜底契约不变
 *  ④ 插件注册别名同名 key = 接管别名槽，静默无告警（二开专属标记正常路径）
 *  ⑤ 覆盖规范内置类型仍告警
 *  ⑥ 非法映射（alias→alias 链 / 规范名作 key / 同名 / 未知目标 / 非对象）抛 E_OPTION_INVALID
 *  ⑦ null 恢复内置默认
 *  ⑧ 调用级 option.markerAliases > 全局 configure
 * 运行：node test/alias-guard.mjs（excel2html 链路，无需浏览器）
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { excel2html, configure, use, helpers, Xlsx2pdfError } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'output');
fs.mkdirSync(outDir, { recursive: true });

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 单标记模板生成器 */
async function makeTpl(name, marker) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('A').getCell('A1').value = marker;
  const p = path.join(outDir, `tpl-alias-${name}.xlsx`);
  await wb.xlsx.writeFile(p);
  return p;
}

const tplImg = await makeTpl('img', '${p|img_w100}');
const tplImage = await makeTpl('image', '${p|image_w100}');
const tplPrint = await makeTpl('print', '${t|print_zindex1}');
const tplWm = await makeTpl('wm', '${t|watermark_zindex1}');
const tplSeal = await makeTpl('seal', '${t|seal_zindex1}');
const tplFoo = await makeTpl('foo', '${t|foo}'); // 未知 token（非内置默认别名）

const htmlOf = (template, data, option) => excel2html({ template, data, option }).then((r) => r.html);

/** 断言抛指定码且双语 */
async function expectCode(label, fn, code, zhFragment, enFragment) {
  let err;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Xlsx2pdfError, `${label}: 应为 Xlsx2pdfError`);
  assert.strictEqual(err.code, code, `${label}: 码应为 ${code}，实际 ${err.code}`);
  assert.ok(err.message.includes(zhFragment), `${label}: 中文文案应含「${zhFragment}」`);
  assert.ok(err.message.includes(enFragment), `${label}: 英文文案应含「${enFragment}」`);
  console.log(`  ✓ ${label} → ${code}`);
}

/** 捕获 console.warn 执行 fn，返回告警数组 */
async function captureWarns(fn) {
  const warns = [];
  const orig = console.warn;
  console.warn = (...args) => { warns.push(args.join(' ')); };
  try {
    await fn();
  } finally {
    console.warn = orig;
  }
  return warns;
}

console.log('[alias-guard] 社区版 markerAliases 可配置契约');

// ============ ① 内置默认别名与规范名等价 ============
assert.strictEqual(await htmlOf(tplImg, { p: PNG }), await htmlOf(tplImage, { p: PNG }), '① img 与 image 产物应字节一致');
assert.strictEqual(await htmlOf(tplPrint, { t: '作废' }), await htmlOf(tplWm, { t: '作废' }), '① print 与 watermark 产物应字节一致');
// helpers 公开签名向后兼容（第 3 参 aliases 缺省内置默认）
assert.strictEqual(helpers.parseMarkerOption('img_w100').type, 'image', '① helpers.parseMarkerOption img 归一 image');
assert.strictEqual(helpers.parseMarkerOption('print').type, 'watermark', '① helpers.parseMarkerOption print 归一 watermark');
console.log('  ✓ ① 内置默认 img/print 与规范名等价');

// ============ ② 自定义别名 seal→watermark（替换语义） ============
configure({ markerAliases: { seal: 'watermark' } });
assert.strictEqual(await htmlOf(tplSeal, { t: '作废' }), await htmlOf(tplWm, { t: '作废' }), '② seal 别名应与 watermark 产物字节一致');
configure({ markerAliases: null });
console.log('  ✓ ② 自定义别名 seal→watermark 生效');

// ============ ③ {} 清空：内置默认别名未注册显式报错，未知 token 仍 text 兜底 ============
configure({ markerAliases: {} });
await expectCode('print 别名清空且未注册',
  () => htmlOf(tplPrint, { t: '作废' }),
  'E_MARKER_ALIAS', '内置别名已禁用', 'is disabled (markerAliases)');
await expectCode('img 别名清空且未注册',
  () => htmlOf(tplImg, { p: PNG }),
  'E_MARKER_ALIAS', '内置别名已禁用', 'is disabled (markerAliases)');
const fooHtml = await htmlOf(tplFoo, { t: '兜底' });
assert.ok(fooHtml.includes('兜底'), '③ 非内置默认别名的未知 token 维持 text 兜底（不抛错）');
console.log('  ✓ ③ {} 清空后 E_MARKER_ALIAS 保护；未知 token 兜底不变');

// ============ ④ 插件接管别名槽：静默无告警（调用级与全局两条路径） ============
// 调用级：全局别名仍在，插件 print 接管 → 命中插件 handler，无覆盖告警
configure({ markerAliases: null });
const callWarns = await captureWarns(async () => {
  const h = await htmlOf(tplPrint, { t: '作废' }, {
    plugins: [{ markerTypes: { print: async () => 'DEDICATED-CALL' } }],
  });
  assert.ok(h.includes('DEDICATED-CALL'), '④ 调用级插件 print 应接管别名槽');
});
assert.strictEqual(callWarns.filter((m) => m.includes('覆盖了内置类型')).length, 0, '④ 接管别名槽不得有覆盖告警');
// 全局：{} 清空别名后 use() 注册 print 专属类型 → 正常消费（E_MARKER_ALIAS 保护解除）
configure({ markerAliases: {} });
const useWarns = await captureWarns(async () => {
  use({ name: 'alias-guard-print', markerTypes: { print: async () => 'DEDICATED-GLOBAL' } });
  const h = await htmlOf(tplPrint, { t: '作废' });
  assert.ok(h.includes('DEDICATED-GLOBAL'), '④ 全局注册 print 后别名禁用不再报错');
});
assert.strictEqual(useWarns.filter((m) => m.includes('覆盖了内置类型')).length, 0, '④ 全局注册别名同名 key 同样静默');
console.log('  ✓ ④ 插件接管别名槽静默无告警（调用级 + 全局）');

// ============ ⑦ null 恢复内置默认 ============
configure({ markerAliases: null });
// 全局 print 插件仍在（④ 注册）：先验证别名恢复后 img 归一 image 正常
assert.strictEqual(await htmlOf(tplImg, { p: PNG }), await htmlOf(tplImage, { p: PNG }), '⑦ null 恢复后 img 别名正常');
console.log('  ✓ ⑦ null 恢复内置默认');

// ============ ⑧ 调用级 > 全局（用 img：print 已被 ④ 全局插件接管，不适合作别名用例） ============
configure({ markerAliases: {} });
const callRestore = await htmlOf(tplImg, { p: PNG }, { markerAliases: { img: 'image' } });
assert.ok(callRestore.includes('<img'), '⑧ 调用级映射应覆盖全局 {}（img 归一 image 嵌入）');
configure({ markerAliases: { img: 'image' } });
await expectCode('调用级 {} 覆盖全局映射',
  () => htmlOf(tplImg, { p: PNG }, { markerAliases: {} }),
  'E_MARKER_ALIAS', '内置别名已禁用', 'is disabled (markerAliases)');
configure({ markerAliases: null });
console.log('  ✓ ⑧ 调用级 option.markerAliases 优先于全局');

// ============ ⑥ 非法映射拒绝（configure 与 option 同一校验） ============
const badCases = [
  [{ a: 'b', b: 'watermark' }, 'alias→alias 链', 'alias-to-alias chains'],
  [{ text: 'watermark' }, '不得为内置规范类型名', 'must not be a built-in canonical type name'],
  [{ seal: 'seal' }, '不与别名同名', 'different from the alias itself'],
  [{ seal: 'nosuch' }, '不是已知规范类型', 'not a known canonical type'],
  [{ seal: 123 }, '须为非空字符串', 'non-empty string'],
  ['str', '只接受对象', 'accepts an object'],
  [[], '只接受对象', 'accepts an object'],
];
for (const [bad, zh, en] of badCases) {
  await expectCode(`configure({ markerAliases: ${JSON.stringify(bad)} })`,
    () => configure({ markerAliases: bad }),
    'E_OPTION_INVALID', zh, en);
  await expectCode(`option.markerAliases = ${JSON.stringify(bad)}`,
    () => excel2html({ template: tplWm, option: { markerAliases: bad } }),
    'E_OPTION_INVALID', zh, en);
}
// 调用级插件注册的类型计入已知规范类型（目标校验面）
const pluginTarget = await htmlOf(tplSeal, { t: '作废' }, {
  markerAliases: { seal: 'custom' },
  plugins: [{ markerTypes: { custom: async () => 'CUSTOM-OK' } }],
});
assert.ok(pluginTarget.includes('CUSTOM-OK'), '⑥ 调用级插件类型可作别名目标');
console.log('  ✓ ⑥ 非法映射拒绝；调用级插件类型计入目标校验面');

// ============ ⑤ 覆盖规范内置类型仍告警（置末：全局注册会污染后续用例） ============
const overrideWarns = await captureWarns(async () => {
  use({ name: 'alias-guard-override', markerTypes: { barcode: async () => 'X' } });
});
assert.ok(overrideWarns.some((m) => m.includes('标记类型 "barcode" 覆盖了内置类型')), '⑤ 覆盖规范内置类型应告警');
console.log('  ✓ ⑤ 规范类型覆盖告警保留');

console.log('[alias-guard] 全部通过 ✅');