/**
 * 分批接缝内存链路守卫（core 侧，不依赖商业版实现）
 *
 * 背景：短时间重复调用 40~60 页报告曾把宿主内存打穿，修复链路有三处核心改动：
 * 内存准入接缝接收 pageCount（供守卫按页数放大估算）、批 HTML 传工厂惰性拼装
 * （准入/槽位拿到后才拼）、browserRecycleRenders 回收键（1.7.0 起社区版可配）。
 *
 * 断言：
 *  ① 分批路径逐批传批内页数（25 页 batchSize 10 → 10/10/5），单文档传总页数
 *  ② HTML 工厂惰性：准入未放行前工厂不执行；放行后才拼装并出片
 *  ③ 已 abort 的请求不进准入、工厂不执行（E_CANCELLED）
 *  ④ 社区版 1.7.0 起接受 browserRecycleRenders（非负整数，默认 0 关闭）
 *  ⑤ 并发批乱序完成时合并输入仍按批索引排序（旧实现 push 完成序 → 页序错乱）
 *
 * 运行：node test/batch-seam-guard.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { excel2pdf, closeBrowser, configure } from '../src/index.js';
import { htmlToPdf } from '../src/pdf.js';
import { registerSeams, getSeams } from '../src/seams.js';
import { getConfig } from '../src/browser.js';

// 复用邻近 pro 内置 Chrome（本地开发避免重复下载，与 media-guard 同口径）
const here = path.dirname(fileURLToPath(import.meta.url));
const proChrome = path.resolve(here, '../../xlsx2pdf-pro/browsers/chrome/win64-135.0.7049.114/chrome-win64/chrome.exe');
if (fs.existsSync(proChrome)) configure({ browserPath: proChrome });

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** 单标记列模板：每页一行数据，页数由 data 数组长度决定 */
async function makeTpl() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('接缝守卫');
  ws.pageSetup = { paperSize: 9, orientation: 'portrait' };
  ws.getColumn(1).width = 30;
  ws.getCell('A1').value = '${tag}';
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const tpl = await makeTpl();
const pageData = (i) => ({ tag: `P${i}` });

const seams = getSeams();
const orig = { memoryAdmit: seams.memoryAdmit, mergePdf: seams.mergePdf, renderBackend: seams.renderBackend };

try {
  // ---------- ① pageCount 逐批 / 单文档传参 ----------
  const seen = [];
  registerSeams({
    capabilities: ['arrayData'],
    memoryAdmit: async (cfg, pageCount) => { seen.push(pageCount); return () => {}; },
    mergePdf: async (buffers) => buffers[0], // 假合并：本用例只断言接缝传参
  });
  await excel2pdf({
    template: tpl,
    data: Array.from({ length: 25 }, (_, i) => pageData(i)),
    option: { batchSize: 10 },
  });
  assert.deepStrictEqual([...seen].sort((a, b) => a - b), [5, 10, 10], '25 页 3 批应传批内页数 10/10/5');
  seen.length = 0;
  await excel2pdf({ template: tpl, data: Array.from({ length: 8 }, (_, i) => pageData(i)) });
  assert.deepStrictEqual(seen, [8], '单文档路径应传总页数 8');
  console.log('[①] PASS: 准入接缝 pageCount 分批传批内页数 / 单文档传总页数');

  // ---------- ② HTML 工厂惰性拼装 ----------
  let gate;
  seams.memoryAdmit = () => new Promise((resolve) => { gate = resolve; });
  let factoryCalls = 0;
  const pending = htmlToPdf(() => {
    factoryCalls++;
    return '<html><body>lazy</body></html>';
  }, {});
  await delay(80);
  assert.strictEqual(factoryCalls, 0, '准入未放行前 HTML 工厂不得执行');
  gate(() => {});
  const rendered = await pending;
  assert.strictEqual(factoryCalls, 1, '放行后工厂恰好执行一次');
  assert.ok(rendered.buffer.subarray(0, 5).toString() === '%PDF-', '惰性拼装路径产物正常');
  console.log('[②] PASS: 批 HTML 拿到准入后才拼装（排队期间不占 Node 堆）');

  // ---------- ③ 已 abort 不进准入、工厂不执行 ----------
  seams.memoryAdmit = async () => { throw new Error('已 abort 不应进入准入'); };
  const ac = new AbortController();
  ac.abort();
  let abortedFactoryCalls = 0;
  await assert.rejects(
    htmlToPdf(() => { abortedFactoryCalls++; return '<html></html>'; }, { signal: ac.signal }),
    (e) => e.code === 'E_CANCELLED',
    '已 abort 应抛 E_CANCELLED',
  );
  assert.strictEqual(abortedFactoryCalls, 0, '已 abort 的请求工厂不得执行');
  console.log('[③] PASS: 已 abort 请求不进准入、不拼 HTML');

  // ---------- ④ 回收键 1.7.0 起社区版可配 ----------
  seams.memoryAdmit = orig.memoryAdmit;
  seams.mergePdf = orig.mergePdf;
  configure({ browserRecycleRenders: 5 });
  assert.strictEqual(getConfig().browserRecycleRenders, 5, '1.7.0 起社区版接受回收键');
  configure({ browserRecycleRenders: 0 });
  assert.strictEqual(getConfig().browserRecycleRenders, 0, '默认 0 关闭不变');
  console.log('[④] PASS: 回收键社区版可配（1.7.0），默认 0 关闭');

  // ---------- ⑤ 并发批乱序完成：合并输入按批索引排序 ----------
  // 旧实现 buffers.push(完成序)：并发批乱序完成时合并出的 PDF 页序与 data 不一致
  // （内容正确、页序错乱，肉眼难以发现；sidecar/多批并发下必现）
  const order = [];
  const done = [];
  seams.mergePdf = async (buffers) => Buffer.from(buffers.map((b) => b.toString()).join('|'));
  seams.renderBackend = async (htmlStr) => {
    const m = /PX(\d+)/.exec(htmlStr);          // 批内首个页面标记 = 该批起始页
    const start = m ? Number(m[1]) : -1;
    order.push(start);
    await delay(80 - start * 3);                // 越靠后的批越早完成，制造乱序
    done.push(start);                           // 记录**完成**序（乱序证据）
    return { buffer: Buffer.from(`PX${start}`), warnings: [] };
  };
  const merged = await excel2pdf({
    template: tpl,
    data: Array.from({ length: 25 }, (_, i) => ({ tag: `PX${i}` })),
    option: { batchSize: 10 },
  });
  assert.notDeepStrictEqual(done, [0, 10, 20], '用例前提：完成序应与批序不同（否则断言无意义）');
  assert.deepStrictEqual([...order].sort((a, b) => a - b), [0, 10, 20], '三批应并发提交（提交序 = 批序）');
  assert.strictEqual(merged.pdf.toString(), 'PX0|PX10|PX20', '合并输入须按批索引排序，不得按完成序');
  console.log('[⑤] PASS: 并发批乱序完成 → 合并输入仍按批索引有序');

  console.log('[batch-seam-guard] ALL PASS ✅');
} finally {
  seams.memoryAdmit = orig.memoryAdmit;
  seams.mergePdf = orig.mergePdf;
  seams.renderBackend = orig.renderBackend;
  seams.capabilities.delete('arrayData');
  configure({ browserRecycleRenders: 0 });
  await closeBrowser();
}