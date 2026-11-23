/**
 * 社区版健壮性守卫（1.5.0：图片内容校验 + warnings 降级通道）
 *
 * 契约：
 *  - 损坏/非图片内容（base64/远程/本地三入口）降级为空值 + warnings 记录，不抛错
 *  - 图片文件读取失败 / 不支持的图片值同样降级 + warnings
 *  - markerTypes handler 抛错降级继续渲染，warnings 标注 E_PLUGIN_RUNTIME
 *  - 正常渲染 warnings 为空数组；excel2pdf 全链路合并渲染期告警
 * 运行：node test/robustness-guard.mjs（行为断言需浏览器，缺失时跳过）
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { excel2html, excel2pdf, closeBrowser } from '../src/index.js';
import { builtinExecutablePath } from '../src/browser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'output');
fs.mkdirSync(outDir, { recursive: true });

// 图片标记模板
const wb = new ExcelJS.Workbook();
wb.addWorksheet('Img').getCell('A1').value = '${pic|image_w50_h50}';
const tpl = path.join(outDir, 'tpl-robust.xlsx');
await wb.xlsx.writeFile(tpl);

// 本地「假图片」：文本内容 + .png 扩展名（魔数校验应识破）
const fakePng = path.join(outDir, 'fake.png');
fs.writeFileSync(fakePng, 'this is plain text, not a png');

// 本地 http 服务：返回 HTML 但 content-type 谎报 image/png（不盲信 content-type）
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end('<html><body>not an image</body></html>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const fakeUrl = `http://127.0.0.1:${server.address().port}/fake.png`;

const hasBrowser = fs.existsSync(await builtinExecutablePath()) || !!process.env.XLSX2PDF_BROWSER_PATH;

try {
    console.log('[robustness-guard] 图片内容校验 + warnings 降级通道');

    // ① base64 坏魔数：data:image/png 头 + 非图片内容
    const badBase64 = `data:image/png;base64,${Buffer.from('broken image bytes').toString('base64')}`;
    const r1 = await excel2html({ template: tpl, data: { pic: badBase64 } });
    assert.ok(Array.isArray(r1.warnings), 'warnings 应为数组');
    assert.ok(r1.warnings.some((w) => w.includes('图片内容损坏')), 'base64 坏魔数应记损坏告警');
    assert.ok(!r1.html.includes('data:image/png;base64,'), '损坏图不应嵌入 HTML');
    console.log('  ✓ base64 坏魔数降级 + warnings');

    // ② 本地文本文件冒充 .png
    const r2 = await excel2html({ template: tpl, data: { pic: fakePng } });
    assert.ok(r2.warnings.some((w) => w.includes('图片内容损坏')), '本地假图片应记损坏告警');
    console.log('  ✓ 本地假图片降级 + warnings');

    // ③ 远程 content-type 谎报
    const r3 = await excel2html({ template: tpl, data: { pic: fakeUrl } });
    assert.ok(r3.warnings.some((w) => w.includes('图片内容损坏')), '远程假图片应记损坏告警');
    console.log('  ✓ 远程 content-type 谎报识破 + warnings');

    // ④ 本地文件读取失败（路径指向目录，readFileSync 抛 EISDIR）
    const r4 = await excel2html({ template: tpl, data: { pic: outDir } });
    assert.ok(r4.warnings.some((w) => w.includes('图片文件读取失败')), '读取失败应记告警不再静默');
    console.log('  ✓ 图片读取失败降级 + warnings');

    // ⑤ 不支持的图片值
    const r5 = await excel2html({ template: tpl, data: { pic: '???' } });
    assert.ok(r5.warnings.some((w) => w.includes('不支持的图片值')), '不支持值应记告警');
    console.log('  ✓ 不支持的图片值降级 + warnings');

    // ⑥ handler 抛错：降级继续渲染 + warnings 标注运行期码
    const r6 = await excel2html({
        template: tpl,
        data: { pic: 'x' },
        option: { plugins: [{ markerTypes: { image: () => { throw new Error('handler boom'); } } }] },
    });
    assert.ok(r6.warnings.some((w) => w.includes('E_PLUGIN_RUNTIME') && w.includes('handler boom')),
        'handler 抛错应降级并记 E_PLUGIN_RUNTIME 告警');
    console.log('  ✓ handler 抛错降级 + warnings 标注 E_PLUGIN_RUNTIME');

    // ⑦ 正常渲染 warnings 为空数组（合法 1×1 PNG）
    const png1x1 = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64');
    const okPng = path.join(outDir, 'ok.png');
    fs.writeFileSync(okPng, png1x1);
    const r7 = await excel2html({ template: tpl, data: { pic: okPng } });
    assert.deepStrictEqual(r7.warnings, [], '正常渲染 warnings 应为空数组');
    assert.ok(r7.html.includes('data:image/png;base64,'), '合法图片应正常嵌入');
    console.log('  ✓ 正常渲染 warnings 为空 + 合法图不受影响');

    // ⑧ excel2pdf 全链路：warnings 合并 + 产物有效（需浏览器）
    if (hasBrowser) {
        const r8 = await excel2pdf({ template: tpl, data: { pic: badBase64 } });
        assert.ok(Buffer.isBuffer(r8.pdf) && r8.pdf.subarray(0, 5).toString() === '%PDF-', '损坏图降级后仍应出片');
        assert.ok(r8.warnings.some((w) => w.includes('图片内容损坏')), 'excel2pdf 应透出引擎侧告警');
        const r9 = await excel2pdf({ template: tpl, data: { pic: okPng } });
        assert.deepStrictEqual(r9.warnings, [], '正常全链路 warnings 应为空数组');
        console.log('  ✓ excel2pdf 全链路 warnings 合并 + 降级不阻断出片');
    } else {
        console.log('  ⚠ 跳过 excel2pdf 行为断言：当前环境无可用浏览器');
    }

    console.log('[robustness-guard] 全部通过 ✅');
} catch (err) {
    console.error('[robustness-guard] 失败 ❌', err);
    process.exitCode = 1;
} finally {
    server.close();
    await closeBrowser();
}