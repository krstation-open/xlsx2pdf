/**
 * ESM 冒烟测试（社区版）
 *
 * 覆盖：excel2html 免费能力保真 / 产物无脚本注入 / Pro 能力显式引导 /
 * 自定义扩展（use/plugins/标记语法/helpers）/
 * excel2pdf 全链路（需浏览器：XLSX2PDF_BROWSER_PATH 或内置 Chrome）/ getVersion
 *
 * 运行：node test/smoke.mjs
 */
import assert from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { excel2pdf, excel2html, getVersion, closeBrowser, use, helpers, configure } from '../src/index.js';
import { makeTemplates } from './make-template.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'output');
mkdirSync(outDir, { recursive: true });

const DATA = {
  name: '张三',
  dept: '质检部',
  info: { level: 'A' },
  amount: 1234.5,
  // 日期按 Excel 序列值传入（与 Excel 填值同语义；epoch 1899-12-30，2026-11-12 = 46338）
  date: 46338,
  temp: 25,
  humi: 60,
};

/** 断言抛错且为 Pro 引导文案（含能力说明与咨询方式） */
async function expectPro(fn, label) {
  let err;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err, `${label}: 应抛错`);
  assert.match(err.message, /Pro/, `${label}: 错误应指明 Pro 能力`);
  assert.match(err.message, /business@krstation\.com/, `${label}: 错误应含咨询方式`);
  console.log(`  ✓ ${label} → Pro 引导`);
}

/** 浏览器缺失时 PDF 步骤降级为跳过（CI 无浏览器环境不阻断） */
function isBrowserMissing(err) {
  return /未找到内置 Chrome|浏览器可执行文件不存在/.test(err.message);
}

const tpl = await makeTemplates(outDir);
console.log('[smoke] 演示模板已生成');

try {
  // ============ 1. excel2html：免费能力保真 ============
  const { html } = await excel2html({ template: tpl.basic, data: DATA });
  assert.ok(html.includes('张三'), 'text 标记替换');
  assert.ok(html.includes('质检部'), '多字段替换');
  assert.ok(html.includes('A'), '嵌套点路径取值');
  assert.ok(html.includes('¥1,234.50'), 'numFmt 货币格式自动继承');
  assert.ok(html.includes('2026-11-12'), 'numFmt 日期格式自动继承');
  assert.ok(html.includes('--'), '标记默认值');
  assert.ok(html.includes('合格'), '富文本静态内容');
  assert.ok(html.replace(/<[^>]+>/g, '').includes('25℃ / 60%'), '同格多段标记 + 静态文本混排（去标签后文本连续）');
  assert.ok(html.includes('rowspan') || html.includes('colspan'), '合并单元格');
  assert.ok(!html.includes('<script'), '社区版产物不得含任何脚本注入');
  assert.ok(!html.includes('${'), '标记应全部清除');
  console.log('  ✓ excel2html 免费能力保真 + 无脚本注入');

  // 缺省 data：渲染一页空模板（标记按默认值/空值清除）
  const empty = await excel2html({ template: tpl.basic });
  assert.ok(!empty.html.includes('${'), '缺省 data 标记清除');
  assert.ok(empty.html.includes('--'), '缺省 data 默认值生效');
  console.log('  ✓ 缺省 data 渲染空模板');

  // ============ 2. Pro 能力显式引导（不静默降级） ============
  await expectPro(() => excel2html({ template: tpl.basic, data: [DATA] }), 'data 数组批量');
  await expectPro(() => excel2html({ template: tpl.basic, data: DATA, option: { fitToPage: true } }), 'option.fitToPage');
  await expectPro(() => excel2html({ template: tpl.basic, data: DATA, option: { scale: 80 } }), 'option.scale');
  await expectPro(() => excel2html({ template: tpl.basic, data: DATA, option: { pageSize: { width: 80, height: 200 } } }), '对象型 pageSize');
  await expectPro(() => excel2html({ template: tpl.proMarker, data: {} }), 'image 标记');
  await expectPro(() => excel2html({ template: tpl.detailRow, data: {} }), '#数组.字段 明细行');

  // 未知 option 键：快速失败（非 Pro 引导，仅报错）
  await assert.rejects(
    () => excel2html({ template: tpl.basic, data: DATA, option: { foo: 1 } }),
    /不支持的 option\.foo/,
    '未知 option 键应拒绝'
  );
  console.log('  ✓ 未知 option 键拒绝');

  // ============ 2.5 自定义扩展（社区版能力） ============
  // 调用级 plugins：自定义标记类型 + 字段解析器 + 模型钩子
  let hookCalled = false;
  const callPlugin = {
    markerTypes: { upper: async (value) => String(value ?? '').toUpperCase() },
    fieldResolvers: [async (field) => (field === 'virt' ? 'RESOLVED' : undefined)],
    transformModel: (model) => { hookCalled = true; return model; },
  };
  const ext = await excel2html({
    template: tpl.extMarker,
    data: { code: 'abc' },
    option: { plugins: [callPlugin] },
  });
  assert.ok(ext.html.includes('ABC'), '调用级插件自定义标记类型生效');
  assert.ok(ext.html.includes('RESOLVED'), '字段解析器生效');
  assert.ok(hookCalled, 'transformModel 钩子被调用');
  assert.ok(!ext.html.includes('<script'), '扩展产物仍无脚本注入');

  // 全局 use()：不传 plugins 也生效
  use({ name: 'smoke-upper', markerTypes: { upper: async (value) => String(value ?? '').toUpperCase() } });
  const extGlobal = await excel2html({ template: tpl.extMarker, data: { code: 'abc', virt: 'DATA' } });
  assert.ok(extGlobal.html.includes('ABC'), '全局 use() 标记类型生效');
  assert.ok(extGlobal.html.includes('DATA'), '解析器未命中时回退数据链路');
  console.log('  ✓ 自定义扩展：调用级 plugins + 全局 use()');

  // 自定义标记语法：调用级 markerRegex + markerSeparator
  const custom = await excel2html({
    template: tpl.customSyntax,
    data: DATA,
    option: { markerRegex: /\{\{([^}]+)\}\}/g, markerSeparator: '::' },
  });
  assert.ok(custom.html.includes('张三'), '自定义 markerRegex 生效');
  assert.ok(custom.html.includes('--'), '自定义 markerSeparator + 默认值生效');
  assert.ok(!custom.html.includes('{{'), '自定义语法标记全部清除');

  // 全局 configure 标记语法（null 恢复内置）
  configure({ markerRegex: /\{\{([^}]+)\}\}/g, markerSeparator: '::' });
  const customGlobal = await excel2html({ template: tpl.customSyntax, data: DATA });
  assert.ok(customGlobal.html.includes('张三'), '全局 configure markerRegex 生效');
  configure({ markerRegex: null, markerSeparator: null });
  const restored = await excel2html({ template: tpl.basic, data: DATA });
  assert.ok(restored.html.includes('张三'), 'null 恢复内置 ${...} 语法');
  console.log('  ✓ 自定义标记语法：调用级 + 全局 configure + null 恢复');

  // helpers：引擎同源工具 + 正则契约校验
  assert.strictEqual(typeof helpers.getFileBuffer, 'function', 'helpers.getFileBuffer');
  assert.deepStrictEqual(helpers.flattenObject({ a: { b: 1 } }), { 'a.b': 1 }, 'helpers.flattenObject');
  assert.strictEqual(helpers.formatValue(0.25, '0%'), '25%', 'helpers.formatValue');
  assert.throws(() => helpers.validateMarkerRegex(/\{\{([^}]+)\}\}/), /g/, '无 g 标志应拒绝');
  console.log('  ✓ helpers 工具与正则契约校验');

  // ============ 3. getVersion ============
  assert.strictEqual(getVersion(), '0.1.0', 'getVersion 与 package.json 一致');
  console.log('  ✓ getVersion');

  // ============ 4. excel2pdf 全链路（需浏览器） ============
  try {
    const { pdf } = await excel2pdf({ template: tpl.basic, data: DATA });
    assert.ok(Buffer.isBuffer(pdf), 'pdf 为 Buffer');
    assert.ok(pdf.subarray(0, 5).toString() === '%PDF-', 'PDF 魔数');
    assert.ok(pdf.length > 1000, 'PDF 非空');
    writeFileSync(path.join(outDir, 'out.pdf'), pdf);
    console.log(`  ✓ excel2pdf 全链路（${(pdf.length / 1024).toFixed(1)}KB → test/output/out.pdf）`);
  } catch (err) {
    if (isBrowserMissing(err)) {
      console.warn('  ⚠ 跳过 excel2pdf：未找到浏览器（configure({ browserPath }) / XLSX2PDF_BROWSER_PATH / npx xlsx2pdf-browser install）');
    } else {
      throw err;
    }
  }

  console.log('[smoke] ESM 冒烟全部通过');
} finally {
  await closeBrowser();
}