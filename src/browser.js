import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { PUPPETEER_REVISIONS } from 'puppeteer-core/internal/revisions.js';
import { getSeams } from './seams.js';
import { xlsxError } from './errors.js';

// ============================================================
// 包根目录与内置浏览器路径（与 cwd 无关）
// ============================================================

/**
 * 包根目录：CJS 产物有 __dirname；ESM 产物用 import.meta.url。
 * 三元短路保证两种产物各自只走可用分支
 * （esbuild cjs 构建对 import.meta 的告警用 logOverride 静默）
 * @returns {string}
 */
export function pkgRoot() {
  return typeof __dirname === 'string'
    ? path.resolve(__dirname, '..')
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

/** 内置浏览器缓存目录（包内固定位置，与 cwd 无关） */
export function browserCacheDir() {
  return path.join(pkgRoot(), 'browsers');
}

// @puppeteer/browsers 是 ESM-only 包：静态 import 会被 esbuild 在 CJS 产物中
// 改写为 require()，加载即 ERR_REQUIRE_ESM。故惰性真 import() 加载：
// new Function 绕过 esbuild 改写，require.resolve 定位入口后转 file URL 再 import。
// 模块系统判定用 __dirname（不能用 typeof require：esbuild ESM 产物会注入
// typeof 总为 'function' 的 require shim，导致 ESM 分支误走 CJS）
const localRequire = typeof __dirname === 'string' ? require : createRequire(import.meta.url);
let browsersLibPromise = null;
function loadBrowsersLib() {
  if (!browsersLibPromise) {
    const entry = localRequire.resolve('@puppeteer/browsers');
    browsersLibPromise = new Function('u', 'return import(u)')(pathToFileURL(entry).href);
  }
  return browsersLibPromise;
}

/** 内置 Chrome 可执行文件路径（按 puppeteer-core 版本对应的构建号计算，不代表已安装） */
export async function builtinExecutablePath() {
  const { Browser, computeExecutablePath } = await loadBrowsersLib();
  return computeExecutablePath({
    cacheDir: browserCacheDir(),
    browser: Browser.CHROME,
    buildId: PUPPETEER_REVISIONS.chrome,
  });
}

// ============================================================
// configure：浏览器三键 + 标记语法两键（社区版公开配置面）。
// 其余生产护栏参数化键由商业版经 seams.extraConfigKeys 声明后
// 才接受；未声明的键静默忽略（与社区版旧行为一致）
// ============================================================

const config = {
  /** 外部浏览器可执行文件路径（优先于内置浏览器） */
  browserPath: undefined,
  /** puppeteer headless 模式，默认 'new' */
  headless: 'new',
  /** 追加的浏览器启动参数 */
  launchArgs: [],
  /** 自定义标记语法匹配正则（全局默认；调用级 option.markerRegex 优先） */
  markerRegex: undefined,
  /** 标记内部「字段 / 类型_参数」分隔符（全局默认；调用级优先） */
  markerSeparator: undefined,
  /** 同时打开的渲染标签页上限（超限排队；默认 1，只接受正整数；商业版经接缝声明后另兼容 0/Infinity 不限的旧语义） */
  maxConcurrency: 1,
  /** 模板单元格数上限（实际行×列；超限报错拒绝生成，默认 20000，传 0/负数关闭） */
  maxCells: 20000,
  /** 模板文件体积上限（字节；超限报错拒绝生成，默认 5MB，传 0/负数关闭） */
  maxTemplateSize: 5 * 1024 * 1024,
  /** 内存准入守卫（社区版默认关闭；启用与探测实现由商业版接缝提供） */
  memoryGuard: { enabled: false, reserveMB: 1024, perRenderEstimateMB: 320, pollMs: 250, maxWaitMs: 60000 },
  /** 字体缺失守卫策略（检测实现由商业版接缝提供；社区版无实测脚本，策略不生效） */
  fontGuard: 'warn',
  /** 横向标记（/Rotate）改写开关（改写实现由商业版接缝提供；社区版缺省不改写） */
  pageRotate: true,
};

/**
 * 校验 maxConcurrency 取值（configure 与调用级 option 共用）。
 * 社区版只接受正整数：0/负数/小数/非数值抛 E_OPTION_INVALID——
 * 「传 0 关闭」的护栏语义不适用于并发，无上限即无准入裸奔。
 * 商业版经 seams.extraConfigKeys 声明该键后兼容其历史契约（0/负数/Infinity = 不限）。
 * @param {*} value
 * @param {string} where - 报错定位（configure / option）
 */
export function validateMaxConcurrency(value, where) {
  const seams = getSeams();
  if (seams.extraConfigKeys.includes('maxConcurrency')) return; // Pro 旧语义（含 0/Infinity 不限）由商业版自行约束
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw xlsxError('E_OPTION_INVALID',
      `[xlsx2pdf] ${where}.maxConcurrency 只接受正整数（同时渲染的标签页上限，默认 1），收到：${JSON.stringify(value)}`,
      `${where}.maxConcurrency accepts a positive integer only (max simultaneously rendering tabs, default 1), received: ${JSON.stringify(value)}.`);
  }
}

/** 并发 >1 且无内存准入守卫时的一次性运行期告警（进程内只提醒一次） */
let concurrencyWarned = false;
export function warnConcurrencyRisk(value) {
  if (concurrencyWarned || !(value > 1) || getSeams().memoryAdmit) return;
  concurrencyWarned = true;
  console.warn(
    `[xlsx2pdf] maxConcurrency 已设为 ${value}：社区版无内存准入守卫，Chrome 内存随标签页数线性增长，` +
    '请确认宿主服务内存余量充足（小内存容器建议维持默认 1；内存守卫为商业版 Pro 能力）。' +
    ` maxConcurrency is set to ${value}: the community edition has no memory admission guard and Chrome memory grows linearly with open tabs;` +
    ' make sure the host service has enough memory headroom (keep the default 1 on small containers; the memory guard is a Pro capability).');
}

/**
 * 配置浏览器行为（模块级单例；closeBrowser 后下次启动按新配置重建）
 *
 * 社区版接受 browserPath / headless / launchArgs / markerRegex / markerSeparator / maxConcurrency 六键；
 * 其余键（maxCells/maxTemplateSize/memoryGuard/fontGuard/pageRotate）
 * 须由商业版经接缝声明后才接受，未声明时静默忽略。
 *
 * @param {Object} [option]
 * @param {string} [option.browserPath] - 外部浏览器可执行文件路径
 * @param {boolean|'new'} [option.headless] - 无头模式
 * @param {string[]} [option.launchArgs] - 追加启动参数
 * @param {RegExp} [option.markerRegex] - 自定义标记语法匹配正则（全局默认，调用级优先；传 null 恢复内置 ${...}）
 * @param {string} [option.markerSeparator] - 标记内部分隔符（全局默认，默认 "|"，调用级优先；传 null 恢复默认）
 * @param {number} [option.maxConcurrency] - 同时渲染的标签页上限（正整数，默认 1，超限排队；调大前请确认内存余量）
 * @returns 当前生效配置（只读副本）
 */
export function configure(option = {}) {
  if (option.browserPath !== undefined) config.browserPath = option.browserPath;
  if (option.headless !== undefined) config.headless = option.headless;
  if (option.launchArgs !== undefined) config.launchArgs = [...option.launchArgs];
  // 标记语法为社区版扩展能力，恒接受（契约校验在引擎使用处 validateMarkerRegex）
  if (option.markerRegex !== undefined) config.markerRegex = option.markerRegex;
  if (option.markerSeparator !== undefined) config.markerSeparator = option.markerSeparator;
  // 渲染并发为社区版开放键（1.4.0 起）：默认 1 不变，只接受正整数，调大风险见 README 部署节
  if (option.maxConcurrency !== undefined) {
    validateMaxConcurrency(option.maxConcurrency, 'configure');
    config.maxConcurrency = option.maxConcurrency;
    warnConcurrencyRisk(option.maxConcurrency);
  }

  // 商业版声明的额外参数化键（未声明的键静默忽略，保持社区版行为）
  const seams = getSeams();
  const accepted = new Set(seams.extraConfigKeys);
  if (accepted.has('maxCells') && option.maxCells !== undefined) config.maxCells = option.maxCells;
  if (accepted.has('maxTemplateSize') && option.maxTemplateSize !== undefined) config.maxTemplateSize = option.maxTemplateSize;
  if (accepted.has('memoryGuard') && option.memoryGuard !== undefined) {
    config.memoryGuard = { ...config.memoryGuard, ...option.memoryGuard };
  }
  if (accepted.has('fontGuard') && option.fontGuard !== undefined) {
    const modes = seams.fontGuardModes;
    if (modes && !modes.includes(option.fontGuard)) {
      throw xlsxError('E_OPTION_INVALID',
        `[xlsx2pdf] configure({ fontGuard }) 只接受 ${modes.join(' / ')}，收到：${JSON.stringify(option.fontGuard)}`,
        `configure({ fontGuard }) accepts ${modes.join(' / ')} only, received: ${JSON.stringify(option.fontGuard)}.`);
    }
    config.fontGuard = option.fontGuard;
  }
  if (accepted.has('pageRotate') && option.pageRotate !== undefined) {
    if (typeof option.pageRotate !== 'boolean') {
      throw xlsxError('E_OPTION_INVALID',
        `[xlsx2pdf] configure({ pageRotate }) 只接受 boolean，收到：${JSON.stringify(option.pageRotate)}`,
        `configure({ pageRotate }) accepts boolean only, received: ${JSON.stringify(option.pageRotate)}.`);
    }
    config.pageRotate = option.pageRotate;
  }
  return { ...config, launchArgs: [...config.launchArgs], memoryGuard: { ...config.memoryGuard } };
}

/** 当前配置（内部使用） */
export function getConfig() {
  return config;
}

// ============================================================
// 浏览器可执行文件解析（pdf.js 启动时调用）
// ============================================================

/**
 * 解析浏览器可执行文件路径，优先级：
 *   1. configure({ browserPath }) > 环境变量 XLSX2PDF_BROWSER_PATH（外部浏览器）
 *   2. 包内 browsers/ 内置 Chrome
 *   3. 都没有 → 抛错引导补装或指定外部浏览器
 * @returns {string}
 */
export async function resolveBrowserPath() {
  // 1. 外部浏览器：configure 优先于环境变量
  const external = config.browserPath || process.env.XLSX2PDF_BROWSER_PATH;
  if (external) {
    if (!fs.existsSync(external)) {
      throw xlsxError('E_BROWSER_PATH',
        `指定的浏览器可执行文件不存在: ${external}`,
        `The specified browser executable does not exist: ${external}`);
    }
    return external;
  }

  // 2. 内置浏览器
  const builtin = await builtinExecutablePath();
  if (fs.existsSync(builtin)) {
    return builtin;
  }

  // 3. 引导
  throw xlsxError('E_BROWSER_NOT_FOUND',
    '未找到内置 Chrome 浏览器：可运行 npx xlsx2pdf-browser install 或调用 ensureBrowser() 补装；' +
    '自带浏览器请 configure({ browserPath }) 或设置环境变量 XLSX2PDF_BROWSER_PATH',
    'Bundled Chrome not found: run `npx xlsx2pdf-browser install` or call ensureBrowser() to install it; ' +
    'to reuse your own browser, set configure({ browserPath }) or the XLSX2PDF_BROWSER_PATH environment variable.');
}

// ============================================================
// ensureBrowser：确保内置浏览器就绪（幂等，支持强制重装）
// ============================================================

/**
 * 确保内置浏览器已就绪（幂等：已存在则秒级跳过，仅复检 Linux 系统依赖）
 *
 * @param {Object} [option]
 * @param {boolean} [option.force] - 强制重新下载（删除已有构建后重装）
 * @returns {Promise<string>} 内置浏览器可执行文件路径
 */
export async function ensureBrowser(option = {}) {
  // 动态导入：把下载链路（@puppeteer/browsers install + 系统依赖检测）
  // 与常规渲染路径隔离，按需加载。
  // 用 pkgRoot() 解析为绝对路径再导入：产物被 esbuild bundle 后
  // 相对路径 import.meta.url 基准会错位，绝对路径则始终指向发布包内的 scripts/
  const libUrl = pathToFileURL(path.join(pkgRoot(), 'scripts', 'browser-install-lib.mjs')).href;
  const { installBrowser, removeExistingBuild, ensureLinuxDeps } = await import(libUrl);

  const execPath = await builtinExecutablePath();
  if (!option.force && fs.existsSync(execPath)) {
    console.log(`[browser] 内置浏览器已存在，跳过下载: ${execPath}`);
    ensureLinuxDeps(execPath);
    return execPath;
  }

  if (option.force) {
    removeExistingBuild();
  }
  await installBrowser();
  return execPath;
}
