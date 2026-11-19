/**
 * 出片共用管线（CLI `xlsx2pdf convert` 与 `npm run example` 共用）
 *
 * 职责：模板 + 数据 → PDF（或仅 HTML），统一进度提示与错误出口。
 * 错误处理：带码错误（Xlsx2pdfError）打印码 + 双语文案 + docs/errors.md 锚点，
 * 其余错误原样打印；均以退出码 1 结束（调用方决定 process.exit）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { excel2pdf, excel2html, ensureBrowser } from '../src/index.js';
import { getConfig } from '../src/browser.js';

/**
 * 解析 --data 入参：JSON 字符串 / @文件路径 / 缺省空数据
 * @param {string} [raw] - CLI 原始入参
 * @returns {Object} 数据对象
 */
export function parseDataArg(raw) {
  if (raw == null || raw === '') return {};
  if (raw.startsWith('@')) {
    const file = raw.slice(1);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return JSON.parse(raw);
}

/**
 * 执行一次转换（CLI/example 共用）
 *
 * @param {Object} params
 * @param {string} params.template - 模板路径 / URL
 * @param {Object} [params.data] - 数据对象
 * @param {string} [params.out] - PDF 输出路径（缺省 <模板名>.pdf，同目录）
 * @param {boolean} [params.htmlOnly] - 仅渲染 HTML（不启动浏览器）
 * @param {Object} [params.option] - 透传 option（pageSize/orientation/margin/defaults）
 * @returns {Promise<{ outPath: string, bytes: number }>}
 */
export async function runConvert({ template, data = {}, out, htmlOnly = false, option = {} }) {
  if (!htmlOnly) {
    // 首次安装可能尚未下载内置 Chrome：先确保就绪（带下载进度输出），
    // 避免调用方在出片阶段才撞「浏览器缺失」错误；
    // 已指定外部浏览器（configure / 环境变量）时不强制下载内置 Chrome
    const external = getConfig().browserPath || process.env.XLSX2PDF_BROWSER_PATH;
    if (!external) {
      console.log('[xlsx2pdf] 检查内置浏览器…');
      await ensureBrowser();
    }
  }

  console.log(`[xlsx2pdf] 渲染模板: ${template}`);
  const t0 = Date.now();

  if (htmlOnly) {
    const { html } = await excel2html({ template, data, option });
    const outPath = out || defaultOut(template, '.html');
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, html, 'utf8');
    console.log(`[xlsx2pdf] 完成（${Date.now() - t0}ms）→ ${outPath}（${(Buffer.byteLength(html) / 1024).toFixed(1)}KB HTML）`);
    return { outPath, bytes: Buffer.byteLength(html) };
  }

  const { pdf } = await excel2pdf({ template, data, option });
  const outPath = out || defaultOut(template, '.pdf');
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, pdf);
  console.log(`[xlsx2pdf] 完成（${Date.now() - t0}ms）→ ${outPath}（${(pdf.length / 1024).toFixed(1)}KB PDF）`);
  return { outPath, bytes: pdf.length };
}

/** 缺省输出路径：与模板同目录同名，换扩展名 */
function defaultOut(template, ext) {
  const base = /^https?:\/\//i.test(template) ? 'remote-template' : template.replace(/\.[^.]+$/, '');
  return `${base}${ext}`;
}

/**
 * 统一错误出口：打印码 + 双语文案 + 文档锚点，返回退出码
 * @param {Error} err
 * @returns {number} 进程退出码（恒 1）
 */
export function printError(err) {
  if (err && err.code) {
    console.error(`[xlsx2pdf] 错误码 ${err.code}: ${err.message}`);
    console.error(`[xlsx2pdf] 修复建议见 docs/errors.md#${String(err.code).toLowerCase()}`);
  } else {
    console.error(`[xlsx2pdf] ${err?.message || err}`);
  }
  return 1;
}