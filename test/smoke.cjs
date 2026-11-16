/**
 * CJS 冒烟测试（社区版）：验证 dist/index.cjs 产物可用
 *
 * 前置：npm run build
 * 运行：node test/smoke.cjs
 */
const assert = require('node:assert');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const { excel2pdf, excel2html, getVersion, closeBrowser, use, helpers } = require('../dist/index.cjs');

const outDir = path.join(__dirname, 'output');
mkdirSync(outDir, { recursive: true });

const DATA = {
  name: '张三',
  dept: '质检部',
  info: { level: 'A' },
  amount: 1234.5,
  // 日期按 Excel 序列值传入（2026-11-12 = 46338）
  date: 46338,
};

(async () => {
  // 模板生成器为 ESM（与 src 直跑链路共用），CJS 内动态导入
  const { makeTemplates } = await import('./make-template.mjs');
  const tpl = await makeTemplates(outDir);

  try {
    // 1. excel2html 基础保真
    const { html } = await excel2html({ template: tpl.basic, data: DATA });
    assert.ok(html.includes('张三'), 'text 标记替换');
    assert.ok(html.includes('¥1,234.50'), 'numFmt 自动继承');
    assert.ok(!html.includes('<script'), '产物无脚本注入');
    console.log('  ✓ CJS excel2html');

    // 2. Pro 引导（数组批量）
    await assert.rejects(
      () => excel2html({ template: tpl.basic, data: [DATA] }),
      /Pro/,
      'data 数组应抛 Pro 引导'
    );
    console.log('  ✓ CJS Pro 引导');

    // 2.5 自定义扩展（社区版能力，dist 产物面）
    const ext = await excel2html({
      template: tpl.extMarker,
      data: { code: 'abc' },
      option: { plugins: [{ markerTypes: { upper: async (v) => String(v ?? '').toUpperCase() } }] },
    });
    assert.ok(ext.html.includes('ABC'), 'CJS 调用级插件生效');
    use({ markerTypes: { upper: async (v) => String(v ?? '').toUpperCase() } });
    const extGlobal = await excel2html({ template: tpl.extMarker, data: { code: 'abc', virt: 'DATA' } });
    assert.ok(extGlobal.html.includes('ABC'), 'CJS 全局 use() 生效');
    assert.strictEqual(typeof helpers.flattenObject, 'function', 'CJS helpers 导出');
    console.log('  ✓ CJS 自定义扩展');

    // 2.6 富媒体基础（社区版内置 image）
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const media = await excel2html({ template: tpl.proMarker, data: { photo: PNG } });
    assert.ok(media.html.includes('<img'), 'CJS image 标记嵌入');
    assert.strictEqual(typeof helpers.generateCode, 'function', 'CJS helpers.generateCode 导出');
    console.log('  ✓ CJS 富媒体基础');

    // 3. getVersion
    assert.strictEqual(getVersion(), require('../package.json').version);
    console.log('  ✓ CJS getVersion');

    // 4. excel2pdf 全链路（需浏览器；缺失时跳过）
    try {
      const { pdf } = await excel2pdf({ template: tpl.basic, data: DATA });
      assert.ok(Buffer.isBuffer(pdf) && pdf.subarray(0, 5).toString() === '%PDF-', 'PDF 魔数');
      writeFileSync(path.join(outDir, 'out-cjs.pdf'), pdf);
      console.log(`  ✓ CJS excel2pdf 全链路（${(pdf.length / 1024).toFixed(1)}KB）`);
    } catch (err) {
      if (/未找到内置 Chrome|浏览器可执行文件不存在/.test(err.message)) {
        console.warn('  ⚠ 跳过 CJS excel2pdf：未找到浏览器');
      } else {
        throw err;
      }
    }

    console.log('[smoke] CJS 冒烟全部通过');
  } finally {
    await closeBrowser();
  }
})().catch((err) => {
  console.error('[smoke] CJS 冒烟失败:', err);
  process.exit(1);
});