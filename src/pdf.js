import puppeteer from 'puppeteer-core';
import { spawnSync } from 'node:child_process';

import { getPageDimensions } from './constants.js';
import { EXCEL_DEFAULTS, isMeaningfulPageSize } from './pagesetup.js';
import { resolveBrowserPath, getConfig } from './browser.js';
import { getSeams } from './seams.js';
import { xlsxError, isCodedError, cancelledError, throwIfAborted } from './errors.js';

// ============================================================
// 浏览器实例复用（单例）
// ============================================================

/** @type {import('puppeteer-core').Browser|null} */
let browser = null;
let launchPromise = null;
/** 本次浏览器实例生命周期内已完成的渲染槽位数（browserRecycleRenders 回收计数） */
let rendersSinceLaunch = 0;
/** 当前实例冷启动完成时刻（browserMaxAgeMs 墙钟年龄轮换） */
let launchedAt = 0;
/** 空闲回收定时器（browserIdleMs；无在途渲染且空闲超阈即关单例） */
let idleTimer = null;

// 进程退出兜底：pipe 传输已保证父死子亡，此处再补一刀防极端残留
process.once('exit', () => {
  try { browser?.process()?.kill('SIGKILL'); } catch (_) { /* ignore */ }
});

/** 装配空闲回收定时器（每次渲染结束/启动时重置；unref 不阻进程退出） */
function armIdleTimer() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  const idleMs = getConfig().browserIdleMs;
  if (idleMs > 0 && browser && runningPages === 0) {
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (runningPages === 0 && browser) closeBrowser().catch(() => { /* 回收失败不阻断 */ });
    }, idleMs);
    idleTimer.unref?.();
  }
}

/**
 * Linux 启动失败时用 ldd 诊断是否缺系统库（仅错误路径执行，正常渲染零开销）：
 * 缺库 → E_BROWSER_DEPS 附 apt 修复指引；否则维持 E_BROWSER_LAUNCH
 */
function launchError(err, executablePath) {
  const rawMsg = String(err && err.message || '');
  // EACCES：access 预检过但 execve 仍拒（noexec 挂载/LSM 限制等），附排查指引
  if (/EACCES/.test(rawMsg)) {
    return xlsxError('E_BROWSER_LAUNCH',
      `[xlsx2pdf] 浏览器启动失败：执行被拒（EACCES）: ${executablePath}。请检查：① ls -l 执行位（chmod +x）；② 所在挂载点是否 noexec；③ Ubuntu/Debian 下该路径是否为 snap 包装脚本（容器内不可用，改指真实二进制或内置 Chrome）。原始错误：${rawMsg}`,
      `Browser failed to launch: permission denied (EACCES): ${executablePath}. Check the exec bit (chmod +x), noexec mounts, or snap wrapper scripts (unusable in containers); point to the real binary or the bundled Chrome. Original error: ${rawMsg}`);
  }
  if (process.platform === 'linux') {
    try {
      const ldd = spawnSync('ldd', [executablePath], { encoding: 'utf8' });
      if (ldd.status === 0 && ldd.stdout.includes('not found')) {
        return xlsxError('E_BROWSER_DEPS',
          `[xlsx2pdf] Chrome 启动失败：缺少系统依赖库（ldd 检出 not found）。请安装缺失库后重试（Debian/Ubuntu 可参考 README 部署节的 apt 包清单）。原始错误：${err.message}`,
          `Chrome failed to launch: missing system libraries (ldd reports "not found"). Install the missing libraries and retry (see the apt package list in the README Deployment section on Debian/Ubuntu). Original error: ${err.message}`);
      }
    } catch (_) { /* 诊断失败不阻断，回落通用启动错误 */ }
  }
  return xlsxError('E_BROWSER_LAUNCH',
    `[xlsx2pdf] Chrome 启动失败：${err.message}`,
    `Chrome failed to launch: ${err.message}`);
}

/**
 * 获取（或创建）复用的浏览器实例
 * @returns {Promise<import('puppeteer-core').Browser>}
 */
async function getBrowser() {
  if (browser && browser.isConnected()) {
    return browser;
  }

  // 防止并发启动多个浏览器：共享 Promise 必须在第一个 await 之前就建立——
  // 路径解析也是异步，若赋值晚于解析，冷启动的并发请求会各自 launch 出多实例
  if (launchPromise) {
    return launchPromise;
  }

  launchPromise = (async () => {
    // 浏览器解析顺序：configure({ browserPath }) > XLSX2PDF_BROWSER_PATH > 包内 browsers/ 内置 Chrome
    // （路径解析基于模块自身位置，与 cwd 无关；缺失时报错引导补装）
    const executablePath = await resolveBrowserPath();
    const cfg = getConfig();
    try {
      return await puppeteer.launch({
        headless: cfg.headless,
        executablePath,
        // pipe 传输：CDP over pipe，父进程被 SIGKILL 时 Chrome 随死（WebSocket 会留孤儿）
        pipe: true,
        protocolTimeout: cfg.protocolTimeoutMs,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          ...cfg.launchArgs,
        ],
      });
    } catch (err) {
      throw launchError(err, executablePath);
    }
  })();

  try {
    browser = await launchPromise;
  } catch (err) {
    launchPromise = null;
    throw err;
  }
  launchPromise = null;
  rendersSinceLaunch = 0;
  launchedAt = Date.now();

  // 监听断开事件，自动清理；身份判定：仅当断开的是当前单例引用才置 null，
  // 避免旧实例的断开事件晚到、误清已重建的新实例（低频竞态）
  const instance = browser;
  instance.on('disconnected', () => {
    if (browser === instance) browser = null;
  });

  return browser;
}

/**
 * 手动关闭浏览器（通常在进程退出时调用）
 */
export async function closeBrowser() {
  // 先等在途冷启动落地再关：否则置空 launchPromise 会让并发 getBrowser 再 launch
  // 一个 Chrome，先完成的实例被覆盖引用成孤儿（B1 竞态）
  if (launchPromise) {
    try { await launchPromise; } catch (_) { /* 启动失败本就无实例可关 */ }
  }
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
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

/** 获取一个渲染槽位（超限时排队等待）；maxOverride 为调用级上限，优先于 configure 全局。
 * 传 signal 时排队期间可取消：abort 后从队列摘除自身并抛 E_CANCELLED，不占槽位 */
function acquireSlot(maxOverride, signal) {
  const max = maxOverride ?? getConfig().maxConcurrency;
  if (!max || max <= 0 || runningPages < max) {
    runningPages++;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let onAbort;
    // 队列条目携带自身上限：唤醒时复查（调用级上限可各不相同，
    // 只查入队时点会让低上限请求在共享计数器下越限）
    const entry = {
      max,
      grant: () => {
        if (onAbort) signal.removeEventListener('abort', onAbort);
        runningPages++;
        resolve();
      },
    };
    waitQueue.push(entry);
    if (signal) {
      onAbort = () => {
        const i = waitQueue.indexOf(entry);
        if (i !== -1) waitQueue.splice(i, 1);
        reject(cancelledError());
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/** 释放渲染槽位并唤醒排队中第一个满足自身上限的请求（不满足的留队，后续释放再查；
 * runningPages 归零时任何上限都放行，无死锁） */
function releaseSlot() {
  runningPages--;
  for (let i = 0; i < waitQueue.length; i++) {
    const entry = waitQueue[i];
    if (!entry.max || entry.max <= 0 || runningPages < entry.max) {
      waitQueue.splice(i, 1);
      entry.grant();
      break;
    }
  }
}

/**
 * 取消竞态：abort 时立即以 E_CANCELLED 拒绝，不等在途 CDP 调用自行结束。
 * pg.close() 只释放页面资源，并不会中断已发出的 CDP 请求（其 Promise 可能
 * 一直挂到超时），故渲染期取消必须靠竞态及时抛出；底层调用被遗弃后由
 * finally 的 pg.close() 兜底清理。无 signal 时原样返回，零开销
 */
function raceAbort(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(cancelledError());
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
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
 * @property {number} [maxConcurrency] - 调用级并发上限（正整数，优先于 configure 全局；缺省用全局值）
 * @property {number} [pageCount=1] - 本次出片的页数（内部入参）：内存准入按页数放大估算，
 *   分批出片传批内页数，单文档传总页数；缺省 1 保持单页估算口径
 * @property {AbortSignal} [signal] - 取消信号：排队中摘除、渲染中关闭标签页中断，统一抛 E_CANCELLED
 */

/**
 * 将 HTML 字符串渲染为 PDF Buffer
 *
 * @param {string|(() => string)} html - 完整 HTML 字符串，或返回 HTML 的工厂函数。
 *   传工厂时拼装推迟到内存准入与并发槽位都拿到之后才执行：分批出片场景下
 *   避免全部批的 HTML 在限流生效前急切拼好驻留内存（Node 堆峰值放大）
 * @param {PdfOptions} [option]
 * @returns {Promise<{ buffer: Buffer, warnings: string[] }>} warnings 为渲染期降级告警（如图片解码失败）
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
  const signal = option.signal;
  const warnings = [];

  // 取消预检：已 abort 的请求不进入内存准入/排队
  throwIfAborted(signal);

  // 内存准入先于标签页信号量：不满足「估算+安全余量」时在队列中等待，
  // 不占用并发槽位；与 maxConcurrency 信号量取“与”合流（守卫实现由商业版接缝注入，缺省直接放行）
  // 注：memoryAdmit 第三入参 signal 供守卫排队期摘队（商业版实现）；缺省守卫不感知时
  // 由其 maxWaitMs 自带超时兜底，放行后的预检会拦截已取消请求
  const seams = getSeams();
  const pageCount = Number.isInteger(option.pageCount) && option.pageCount > 0 ? option.pageCount : 1;
  // 可观测性事件发射：社区 onEvent 钩子与商业版 sink 双通道共存；
  // 两者皆无时零开销（不构造 evt）；钩子异常不击穿渲染
  const emit = (step, fields) => {
    const hook = getConfig().onEvent;
    const sink = seams.emitEvent;
    if (!hook && !sink) return;
    const evt = { step, ts: Date.now(), ...fields };
    if (hook) { try { hook(evt); } catch (_) { /* 钩子异常不击穿渲染 */ } }
    if (sink) sink(evt);
  };

  // 渲染后端委托（商业版 sidecar 客户端）：准入/槽位/Chrome 全在服务端，
  // 本地路径整体让位；HTML 惰性拼装语义保留（委托前才调工厂）。
  // option.__localRender 为内部旁路：guardMode 运行期切 local 时客户端包装层
  // 回落本地路径用，跳过委托防递归（不构成公开 API）
  if (seams.renderBackend && !option.__localRender) {
    const htmlStr = typeof html === 'function' ? html() : html;
    try {
      return await seams.renderBackend(htmlStr, { ...option, pageCount });
    } catch (err) {
      if (signal && signal.aborted) throw cancelledError();
      if (isCodedError(err)) throw err;
      throw xlsxError('E_RENDER',
        `[xlsx2pdf] 页面渲染失败：${err.message}`,
        `Page rendering failed: ${err.message}`);
    }
  }

  const releaseMemory = seams.memoryAdmit ? await seams.memoryAdmit(getConfig().memoryGuard, pageCount, signal) : () => { };

  let slotAcquired = false;
  let pg = null;
  let onAbort = null;
  try {
    throwIfAborted(signal);
    const tWait = Date.now();
    await acquireSlot(option.maxConcurrency, signal);
    slotAcquired = true;
    emit('render.wait', { ms: Date.now() - tWait, pages: pageCount });

    // HTML 惰性拼装：拿到准入与槽位后才调工厂，排队期间不占 Node 堆
    const htmlStr = typeof html === 'function' ? html() : html;

    // getBrowser/newPage 失败（浏览器崩溃/协议超时等）同样纳入 E_RENDER 包装；
    // 已带码错误（E_BROWSER_* 等）原样重抛
    const tChrome = Date.now();
    const br = await getBrowser();
    pg = await br.newPage();
    emit('render.chrome', { ms: Date.now() - tChrome });
    // 回收计数在标签页落到当前实例后才累加：冷启动会在 getBrowser 内清零，
    // 若提前累加会把首次渲染的计数抹掉（阈值偏移一次冷启动）
    rendersSinceLaunch++;
    throwIfAborted(signal);

    // 渲染中取消：abort 时关闭标签页释放资源，并与在途 CDP 调用竞态及时抛 E_CANCELLED
    // （pg.close 不中断已发出的 CDP 请求，单靠它无法及时终止，见 raceAbort）
    if (signal) {
      onAbort = () => { pg.close().catch(() => { /* 中断手段，失败不阻断 */ }); };
      signal.addEventListener('abort', onAbort, { once: true });
    }

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
    await raceAbort(pg.setContent(htmlStr, {
      waitUntil: 'load',
      timeout: 30000,
    }), signal);

    // 兜底：极少数图片的解码会滞后于 load，显式等一次避免打印出空白图；
    // 解码失败仍按原样打印（行为不变），但计数回传记入 warnings，不再静默盲区
    // 必须传字符串表达式：真实函数会被 minify/混淆器重命名标识符，
    // puppeteer 序列化后注入页面执行会引用丢失（渲染脚本同理）
    const decodeFailed = await raceAbort(pg.evaluate(`(function () {
      var failed = 0;
      var pending = Array.prototype.filter.call(document.images, function (im) { return !im.complete; });
      return Promise.all(pending.map(function (im) {
        return im.decode().catch(function () { failed++; });
      })).then(function () { return failed; });
    })()`), signal);
    if (decodeFailed > 0) {
      const msg = `[pdf] ${decodeFailed} 张图片解码失败，已按原样打印（产物中可能为空白/破图） / ${decodeFailed} image(s) failed to decode and were printed as-is (may appear blank/broken in the output)`;
      console.warn(msg);
      warnings.push(msg);
    }

    // 字体缺失守卫：检测与告警/抛错策略由商业版接缝提供（社区版无实测脚本，不检测）
    throwIfAborted(signal);
    if (seams.fontGuardCheck) await raceAbort(seams.fontGuardCheck(pg, fontGuard), signal);

    // 生成 PDF
    // puppeteer 返回 Uint8Array，统一转 Buffer（toString/subarray 等语义与类型声明一致）
    throwIfAborted(signal);
    const tPrint = Date.now();
    const pdfBuffer = await raceAbort(pg.pdf({
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
    }), signal);
    emit('render.print', { ms: Date.now() - tPrint, bytes: pdfBuffer.byteLength, pages: pageCount });

    throwIfAborted(signal);
    // 零拷贝视图：puppeteer 返回的 Uint8Array 底层 ArrayBuffer 即本次产物，
    // Buffer.from(view) 会再拷一份（PDF 体积×2 瞬时驻留）
    return { buffer: Buffer.from(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength), warnings };
  } catch (err) {
    // 取消优先：abort 引发的中断（含 pg.close 触发的 CDP 报错）统一 E_CANCELLED；
    // 其余已带码错误（浏览器启动/路径类等）原样重抛；页面渲染/出片失败统一 E_RENDER
    if (signal && signal.aborted) throw cancelledError();
    if (isCodedError(err)) throw err;
    throw xlsxError('E_RENDER',
      `[xlsx2pdf] 页面渲染失败：${err.message}`,
      `Page rendering failed: ${err.message}`);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    // close 失败（如浏览器已崩溃）不得覆盖原始错误码
    if (pg) {
      try { await pg.close(); } catch (_) { /* ignore */ }
    }
    if (slotAcquired) releaseSlot();
    releaseMemory();
    // 浏览器回收：Chrome 关标签页后不会立刻把内存还给 OS，重复大批量调用会
    // 棘轮式抬高基线。达到回收阈值且当前无在途渲染时关闭单例，下次调用冷启动
    // 重建（默认 0 关闭，1.7.0 起社区版可配；Pro 生产默认 20）。launchPromise 在途时
    // 不回收，避免误清正在启动的实例
    const recycle = getConfig().browserRecycleRenders;
    const maxAge = getConfig().browserMaxAgeMs;
    const aged = maxAge > 0 && launchedAt > 0 && (Date.now() - launchedAt) >= maxAge;
    if ((recycle > 0 && rendersSinceLaunch >= recycle || aged) && runningPages === 0 && browser && !launchPromise) {
      rendersSinceLaunch = 0;
      try { await closeBrowser(); } catch (_) { /* 回收失败不阻断本次结果 */ }
    }
    armIdleTimer();
  }
}

export { getBrowser, acquireSlot, releaseSlot };

/** 观察口：当前单例引用（不触发启动；sidecar watchdog/漂移反馈读 Chrome 进程树用） */
export function peekBrowser() {
  return browser;
}
