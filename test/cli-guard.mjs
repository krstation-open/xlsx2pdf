/**
 * 社区版 CLI 守卫（xlsx2pdf convert 与 example 共用管线的回归基线）
 *
 * 以子进程真实执行 bin/xlsx2pdf.mjs：帮助/版本/HTML 出片/数据注入（JSON 串与 @文件）/
 * 错误出口（退出码 1 + 错误码打印）/ PDF 全链路（复用邻近 pro 内置 Chrome，缺失则跳过）。
 * 运行：node test/cli-guard.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { builtinExecutablePath } from '../src/browser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'output');
fs.mkdirSync(outDir, { recursive: true });
const cli = path.resolve(here, '../bin/xlsx2pdf.mjs');

/** 执行 CLI 子进程，返回 { status, stdout, stderr } */
function run(args, env = {}) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 120000,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

// 现场生成 CLI 演示模板
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Cli');
ws.getCell('A1').value = '${name}';
ws.getCell('A2').value = '${note|text_default:--}';
const tpl = path.join(outDir, 'tpl-cli.xlsx');
await wb.xlsx.writeFile(tpl);

const dataFile = path.join(outDir, 'cli-data.json');
fs.writeFileSync(dataFile, JSON.stringify({ name: '文件注入' }), 'utf8');

try {
  console.log('[cli-guard] CLI 契约与错误出口');

  // 1. 帮助 / 版本
  const help = run(['--help']);
  assert.strictEqual(help.status, 0, '--help 退出码 0');
  assert.ok(help.stdout.includes('convert'), '帮助含 convert 用法');
  const ver = run(['--version']);
  assert.strictEqual(ver.status, 0, '--version 退出码 0');
  assert.match(ver.stdout.trim(), /^\d+\.\d+\.\d+$/, '版本号为语义化版本');
  console.log('  ✓ --help / --version');

  // 2. HTML 出片（无需浏览器）：JSON 串注入 + 标记默认值
  const htmlOut = path.join(outDir, 'cli-out.html');
  const r1 = run(['convert', tpl, '--html', '--data', '{"name":"CLI注入"}', '--out', htmlOut]);
  assert.strictEqual(r1.status, 0, `HTML 出片应成功：${r1.stderr}`);
  const html = fs.readFileSync(htmlOut, 'utf8');
  assert.ok(html.includes('CLI注入'), '数据注入生效');
  assert.ok(html.includes('--'), '标记默认值生效');
  assert.ok(!html.includes('${'), '标记全部清除');
  console.log('  ✓ convert --html + --data JSON 串');

  // 3. @文件注入 + --page-size / --margin 透传
  const r2 = run(['convert', tpl, '--html', '--data', `@${dataFile}`, '--out', htmlOut, '--page-size', 'A5', '--margin', '10,10,10,10']);
  assert.strictEqual(r2.status, 0, `@文件注入应成功：${r2.stderr}`);
  assert.ok(fs.readFileSync(htmlOut, 'utf8').includes('文件注入'), '@文件数据注入生效');
  console.log('  ✓ convert --data @file + --page-size + --margin');

  // 4. 错误出口：退出码 1 + 错误码打印
  const noTpl = run(['convert']);
  assert.strictEqual(noTpl.status, 1, '缺模板路径退出码 1');

  const missing = run(['convert', path.join(outDir, 'no-such.xlsx'), '--html']);
  assert.strictEqual(missing.status, 1, '模板不存在退出码 1');
  assert.ok(missing.stderr.includes('E_TEMPLATE_LOAD'), '打印错误码 E_TEMPLATE_LOAD');
  assert.ok(missing.stderr.includes('errors.md#e_template_load'), '打印文档锚点');

  const badJson = run(['convert', tpl, '--html', '--data', '{bad']);
  assert.strictEqual(badJson.status, 1, '非法 JSON 退出码 1');

  const badPaper = run(['convert', tpl, '--html', '--page-size', 'A2']);
  assert.strictEqual(badPaper.status, 1, '非法纸张退出码 1');
  assert.ok(badPaper.stderr.includes('E_PAPER_UNSUPPORTED'), '打印错误码 E_PAPER_UNSUPPORTED');

  const badMargin = run(['convert', tpl, '--html', '--margin', '1,2,3']);
  assert.strictEqual(badMargin.status, 1, '非法 margin 退出码 1');

  const unknownCmd = run(['foo']);
  assert.strictEqual(unknownCmd.status, 1, '未知命令退出码 1');
  console.log('  ✓ 错误出口（退出码 1 + 错误码 + 文档锚点）');

  // 5. PDF 全链路：优先内置浏览器（CI 场景），其次邻近 pro 内置 Chrome（本地开发避免重复下载）；都没有则跳过
  const builtin = await builtinExecutablePath();
  const proChrome = path.resolve(here, '../../xlsx2pdf-pro/browsers/chrome/win64-135.0.7049.114/chrome-win64/chrome.exe');
  const env = fs.existsSync(builtin) ? {}
    : fs.existsSync(proChrome) ? { XLSX2PDF_BROWSER_PATH: proChrome }
    : null;
  if (env) {
    const pdfOut = path.join(outDir, 'cli-out.pdf');
    const r3 = run(['convert', tpl, '--data', '{"name":"PDF链路"}', '--out', pdfOut], env);
    assert.strictEqual(r3.status, 0, `PDF 出片应成功：${r3.stderr}`);
    const pdf = fs.readFileSync(pdfOut);
    assert.strictEqual(pdf.subarray(0, 5).toString(), '%PDF-', 'PDF 魔数');
    assert.ok(pdf.length > 1000, 'PDF 非空');
    console.log(`  ✓ convert PDF 全链路（${(pdf.length / 1024).toFixed(1)}KB）`);
  } else {
    console.log('  ⚠ 跳过 PDF 全链路：未找到可用浏览器');
  }

  console.log('[cli-guard] 全部通过 ✅');
} catch (err) {
  console.error('[cli-guard] 失败 ❌', err);
  process.exitCode = 1;
}