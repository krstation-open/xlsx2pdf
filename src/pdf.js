import puppeteer from 'puppeteer-core';

import { getPageDimensions } from './constants.js';
import { EXCEL_DEFAULTS, isMeaningfulPageSize } from './pagesetup.js';
import { resolveBrowserPath, getConfig } from './browser.js';
import { getSeams } from './seams.js';

// ============================================================
// 浏览器实例复用（单例）
// ============================================================

/** @type {import('puppeteer-core').Browser|null} */
let browser = null;
let launchPromise = null;

/**
 * 获取（或创建）复用的浏览器实例
 * @returns {Promise<import('puppeteer-core').Browser>}
 */
async function getBrowser() {
  if (browser && browser.isConnected()) {
    return browser;
  }

  // 防止并发启动多个浏览器
  if (launchPromise) {
    return launchPromise;
  }

  // 浏览器解析顺序：configure({ browserPath }) > XLSX2PDF_BROWSER_PATH > 包内 browsers/ 内置 Chrome
  // （路径解析基于模块自身位置，与 cwd 无关；缺失时报错引导补装）
  const executablePath = await resolveBrowserPath();
  const cfg = getConfig();

  launchPromise = puppeteer.launch({
    headless: cfg.headless,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      ...cfg.launchArgs,
    ],
  });

  browser = await launchPromise;
  launchPromise = null;

  // 监听断开事件，自动清理
  browser.on('disconnected', () => {
    browser = null;
  });

  return browser;
}

/**
 * 手动关闭浏览器（通常在进程退出时调用）
 */
export async function closeBrowser() {
  if (browser) {
    try {
      await browser.close();
    } catch (_) { /* ignore */ }
    browser = null;
  }
  launchPromise = null;
}

// ============================================================
// 渲染并发限流（信号量）
// ============================================================

// 每次 excel2pdf 都会新开一个标签页，标签页数无上限时 Chrome 内存随并发
// 线性增长，小内存服务器（如 2C4G 容器）易被打 OOM。
// 这里按 getConfig().maxConcurrency 限制同时打开的标签页数，超限排队等待；
// 实测吞吐在并发 8 左右已见顶，排队几乎不损失吞吐
let runningPages = 0;
const waitQueue = [];

/** 获取一个渲染槽位（超限时排队等待） */
function acquireSlot() {
  const max = getConfig().maxConcurrency;
  if (!max || max <= 0 || runningPages < max) {
    runningPages++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waitQueue.push(() => { runningPages++; resolve(); });
  });
}

/** 释放渲染槽位并唤醒排队中的下一个请求 */
function releaseSlot() {
  runningPages--;
  const next = waitQueue.shift();
  if (next) next();
}

// ============================================================
// HTML → PDF
// ============================================================

/**
 * @typedef {Object} PdfOptions
 * @property {string} [pageSize='A4']
 * @property {string} [orientation='portrait']
 * @property {Object} [margin] - mm
 * @property {'warn'|'throw'|'silent'} [fontGuard] - 模板默认字体缺失时的处理（默认 'warn'；检测由商业版接缝提供）
 */

/**
 * 将 HTML 字符串渲染为 PDF Buffer
 *
 * @param {string} html - 完整 HTML 字符串
 * @param {PdfOptions} [option]
 * @returns {Promise<Buffer>}
 */
export async function htmlToPdf(html, option = {}) {
  // 正常调用链（index.js）总会传入已解析的页面设置；
  // 兑底值与 pagesetup.js 的 Excel 内建默认保持一致，避免直接调用时出现另一套默认值
  // 无效的 pageSize（'' / 缺有效宽高的对象等）按未传处理回退默认，
  // 与 resolvePageSetup 同一套语义，不把无效对象漏进 getPageDimensions 报 [object Object]
  const pageSize = isMeaningfulPageSize(option.pageSize) ? option.pageSize : EXCEL_DEFAULTS.pageSize;
  const orientation = option.orientation || EXCEL_DEFAULTS.orientation;
  const margin = option.margin || EXCEL_DEFAULTS.margin;
  const fontGuard = option.fontGuard || 'warn';

  const page = getPageDimensions(pageSize, orientation);

  // 内存准入先于标签页信号量：不满足「估算+安全余量」时在队列中等待，
  // 不占用并发槽位；与 maxConcurrency 信号量取“与”合流（守卫实现由商业版接缝注入，缺省直接放行）
  const seams = getSeams();
  const releaseMemory = seams.memoryAdmit ? await seams.memoryAdmit(getConfig().memoryGuard) : () => {};
  await acquireSlot();
  try {
    const br = await getBrowser();
    const pg = await br.newPage();

    try {
      // 转发页面内的告警/错误（如渲染脚本的超页告警），否则调用方看不到
      // 注：不同 puppeteer 版本的类型字符串为 'warn' 或 'warning'
      pg.on('console', (msg) => {
        const type = msg.type();
        if (type === 'warn' || type === 'warning' || type === 'error') {
          console.warn(`[page] ${msg.text()}`);
        }
      });

      // 图片全部是内联 base64，不存在后续网络请求；load 事件已覆盖子资源加载，
      // 用 networkidle0 只会白等一个 500ms 的空闲判定窗口（实测约 1s）
      await pg.setContent(html, {
        waitUntil: 'load',
        timeout: 30000,
      });

      // 兜底：极少数图片的解码会滞后于 load，显式等一次避免打印出空白图
      // 必须传字符串表达式：真实函数会被 minify/混淆器重命名标识符，
      // puppeteer 序列化后注入页面执行会引用丢失（渲染脚本同理）
      await pg.evaluate(`Promise.all(
      Array.prototype.filter.call(document.images, function (im) { return !im.complete; })
        .map(function (im) { return im.decode().catch(function () { /* 解码失败按原样打印 */ }); })
    )`);

      // 字体缺失守卫：检测与告警/抛错策略由商业版接缝提供（社区版无实测脚本，不检测）
      if (seams.fontGuardCheck) await seams.fontGuardCheck(pg, fontGuard);

      // 生成 PDF
      // puppeteer 返回 Uint8Array，统一转 Buffer（toString/subarray 等语义与类型声明一致）
      const pdfBuffer = await pg.pdf({
        width: `${page.widthMm}mm`,
        height: `${page.heightMm}mm`,
        printBackground: true,
        margin: {
          top: `${margin.top}mm`,
          right: `${margin.right}mm`,
          bottom: `${margin.bottom}mm`,
          left: `${margin.left}mm`,
        },
        preferCSSPageSize: false,
      });

      return Buffer.from(pdfBuffer);
    } finally {
      await pg.close();
    }
  } finally {
    releaseSlot();
    releaseMemory();
  }
}

export { getBrowser };
