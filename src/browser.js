import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { PUPPETEER_REVISIONS } from 'puppeteer-core/internal/revisions.js';
import { getSeams } from './seams.js';
import { xlsxError } from './errors.js';
import { setTemplateCacheBudget } from './utils.js';
import { validateMarkerAliases } from './registry.js';

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
// configure：社区版公开配置面（浏览器三键 / 标记语法两键 / 并发 /
// 规模守卫两键 / 生命周期四键 / onEvent / markerAliases）。
// 其余生产护栏参数化键（memoryGuard/maxPages/fontGuard/pageRotate 等）
// 由商业版经 seams.extraConfigKeys 声明后才接受；未声明的键静默忽略
// ============================================================

/** 规模守卫善意默认（超默认值放宽且无内存准入接缝时运行期告警，见 warnResourceRisk） */
const DEFAULT_MAX_CELLS = 20000;
const DEFAULT_MAX_TEMPLATE_SIZE = 5 * 1024 * 1024;

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
  /** 模板单元格数上限（实际行×列；超限报错拒绝生成，默认 20000，传 0/负数关闭；1.7.0 起社区版可配） */
  maxCells: DEFAULT_MAX_CELLS,
  /** 模板文件体积上限（字节；超限报错拒绝生成，默认 5MB，传 0/负数关闭；1.7.0 起社区版可配） */
  maxTemplateSize: DEFAULT_MAX_TEMPLATE_SIZE,
  /** 内存准入守卫（社区版默认关闭；启用与探测实现由商业版接缝提供） */
  memoryGuard: { enabled: false, reserveMB: 1024, perRenderEstimateMB: 320, pollMs: 250, maxWaitMs: 60000 },
  /** 可观测性日志（社区版无 sink 不生效；商业版默认 JSONL 落盘，
   *  logger 接管 / path 调路径 / enabled 开关 / maxMB 轮转阈值） */
  log: { enabled: true, path: undefined, logger: undefined, maxMB: 10 },
  /** 字体缺失守卫策略（检测实现由商业版接缝提供；社区版无实测脚本，策略不生效） */
  fontGuard: 'warn',
  /** 横向标记（/Rotate）改写开关（改写实现由商业版接缝提供；社区版缺省不改写） */
  pageRotate: true,
  /** 浏览器回收阈值：单例实例累计完成多少次渲染后在无在途渲染时关闭重建
   *  （打断 Chrome 内存棘轮；默认 0 关闭，生产调优知情开启） */
  browserRecycleRenders: 0,
  /** 产出页数上限（data 数组长度/解析页数；超限抛 E_PAGE_CAP；默认 0 不限，Pro 声明后设默认） */
  maxPages: 0,
  /** 浏览器空闲回收 ms：无在途渲染且空闲超阈即关闭单例，下次调用重建
   *  （1.7.0 起善意默认 60s；传 0 关闭） */
  browserIdleMs: 60000,
  /** 浏览器墙钟年龄上限 ms：超龄且在安全点即轮换（崩溃概率∝连续运行时长；默认 0 关闭） */
  browserMaxAgeMs: 0,
  /** puppeteer protocolTimeout ms：CDP 调用（含 pg.pdf）挂起上限，默认 60s（修 180s 卡死体感） */
  protocolTimeoutMs: 60000,
  /** 分批出片默认批大小（option.batchSize 优先；默认 10，Pro 可按规格自动覆盖） */
  batchSize: 10,
  /** 守护后端模式：auto（spawn 允许→sidecar，否则 local）/ local / sidecar；商业版消费 */
  guardMode: 'auto',
  /** 模板跨调用缓存预算 MB（0 关闭；opt-in 有界 LRU，key=路径+mtime+size / URL+TTL） */
  templateCacheMB: 0,
  /** 批产物磁盘 spill 阈值 MB：累计批 PDF 超阈即落盘（0 关闭；商业版消费） */
  spillThresholdMB: 0,
  /** 渲染事件钩子（社区版可观测性入口；null 关闭；钩子异常不击穿渲染） */
  onEvent: null,
  /** 标记类型别名映射（null = 内置默认 img/print；对象整体替换，{} 清空；调用级 option.markerAliases 优先） */
  markerAliases: null,
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

/** 并发 >1 且无内存准入守卫时的一次性运行期告警（进程内只提醒一次）；
 * 守卫判定看请求级准入接缝（批级 memoryAdmit 在 Pro 守护自治后退役置 null） */
let concurrencyWarned = false;
export function warnConcurrencyRisk(value) {
  const seams = getSeams();
  if (concurrencyWarned || !(value > 1) || seams.requestAdmit || seams.memoryAdmit) return;
  concurrencyWarned = true;
  console.warn(
    `[xlsx2pdf] maxConcurrency 已设为 ${value}：社区版无内存准入守卫，Chrome 内存随标签页数线性增长，` +
    '请确认宿主服务内存余量充足（小内存容器建议维持默认 1；内存守卫为商业版 Pro 能力）。' +
    ` maxConcurrency is set to ${value}: the community edition has no memory admission guard and Chrome memory grows linearly with open tabs;` +
    ' make sure the host service has enough memory headroom (keep the default 1 on small containers; the memory guard is a Pro capability).');
}

/** 规模上限超善意默认且无内存准入守卫时的一次性运行期告警（进程内只提醒一次）；
 * 与 warnConcurrencyRisk 同口径：知情选择，守卫判定看请求级准入接缝 */
let resourceWarned = false;
export function warnResourceRisk(maxCells, maxTemplateSize) {
  const seams = getSeams();
  if (resourceWarned || seams.requestAdmit || seams.memoryAdmit) return;
  if (!(maxCells > DEFAULT_MAX_CELLS) && !(maxTemplateSize > DEFAULT_MAX_TEMPLATE_SIZE)) return;
  resourceWarned = true;
  console.warn(
    '[xlsx2pdf] 模板规模上限已放宽（maxCells/maxTemplateSize 超默认 20000 格 / 5MB）：社区版无内存准入守卫，' +
    '超大模板可能击穿进程内存，请确认宿主服务内存余量充足（生产环境建议商业版守卫兜底）。' +
    ' Template size caps relaxed (maxCells/maxTemplateSize above the 20000-cell / 5MB defaults): the community edition has no memory admission guard and' +
    ' oversized templates may exhaust process memory; make sure the host has enough headroom (the Pro guards are recommended for production).');
}

/**
 * 配置浏览器行为（模块级单例；closeBrowser 后下次启动按新配置重建）
 *
 * 社区版恒接受：browserPath / headless / launchArgs / markerRegex / markerSeparator /
 * maxConcurrency / maxCells / maxTemplateSize / browserIdleMs / browserMaxAgeMs /
 * browserRecycleRenders / protocolTimeoutMs / onEvent / markerAliases；
 * 其余键（memoryGuard/maxPages/fontGuard/pageRotate 等）须由商业版经接缝声明后才接受，
 * 未声明时静默忽略。
 *
 * @param {Object} [option]
 * @param {string} [option.browserPath] - 外部浏览器可执行文件路径
 * @param {boolean|'new'} [option.headless] - 无头模式
 * @param {string[]} [option.launchArgs] - 追加启动参数
 * @param {RegExp} [option.markerRegex] - 自定义标记语法匹配正则（全局默认，调用级优先；传 null 恢复内置 ${...}）
 * @param {string} [option.markerSeparator] - 标记内部分隔符（全局默认，默认 "|"，调用级优先；传 null 恢复默认）
 * @param {number} [option.maxConcurrency] - 同时渲染的标签页上限（正整数，默认 1，超限排队；调大前请确认内存余量）
 * @param {number} [option.maxCells] - 模板单元格数上限（默认 20000，0/负数关闭；放宽风险见 README 部署节）
 * @param {number} [option.maxTemplateSize] - 模板体积上限字节（默认 5MB，0/负数关闭）
 * @param {number} [option.browserIdleMs] - 空闲回收 ms（非负整数，默认 60000，0 关闭）
 * @param {number} [option.browserMaxAgeMs] - 墙钟年龄轮换 ms（非负整数，默认 0 关闭）
 * @param {number} [option.browserRecycleRenders] - 渲染计数回收阈值（非负整数，默认 0 关闭）
 * @param {number} [option.protocolTimeoutMs] - CDP 挂起上限 ms（≥1000 整数，默认 60000）
 * @param {Function|null} [option.onEvent] - 渲染事件钩子 (evt) => void（null 关闭；钩子异常不击穿渲染）
 * @param {Object<string,string>|null} [option.markerAliases] - 标记类型别名映射（替换式；null 恢复内置 img/print，{} 清空）
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

  // 规模守卫参数化（1.7.0 起社区版开放）：数值必需，0/负数=关闭语义保留；
  // 超善意默认且无内存准入接缝时一次性运行期告警（知情选择，同 maxConcurrency 口径）
  for (const key of ['maxCells', 'maxTemplateSize']) {
    if (option[key] !== undefined) {
      if (typeof option[key] !== 'number') {
        throw xlsxError('E_OPTION_INVALID',
          `[xlsx2pdf] configure({ ${key} }) 只接受数值（0/负数关闭守卫），收到：${JSON.stringify(option[key])}`,
          `configure({ ${key} }) accepts a number only (0/negative disables the guard), received: ${JSON.stringify(option[key])}.`);
      }
      config[key] = option[key];
    }
  }
  warnResourceRisk(config.maxCells, config.maxTemplateSize);

  // 浏览器生命周期参数化（1.7.0 起社区版开放）：非负整数，0 关闭；
  // idle 善意默认 60s（默认行为变更，见 CHANGELOG），recycle/maxAge 默认关
  for (const key of ['browserIdleMs', 'browserMaxAgeMs', 'browserRecycleRenders']) {
    if (option[key] !== undefined) {
      const v = option[key];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
        throw xlsxError('E_OPTION_INVALID',
          `[xlsx2pdf] configure({ ${key} }) 只接受非负整数（0 关闭），收到：${JSON.stringify(v)}`,
          `configure({ ${key} }) accepts a non-negative integer only (0 disables), received: ${JSON.stringify(v)}.`);
      }
      config[key] = v;
    }
  }
  if (option.protocolTimeoutMs !== undefined) {
    const v = option.protocolTimeoutMs;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1000) {
      throw xlsxError('E_OPTION_INVALID',
        `[xlsx2pdf] configure({ protocolTimeoutMs }) 只接受 ≥1000 的整数毫秒，收到：${JSON.stringify(v)}`,
        `configure({ protocolTimeoutMs }) accepts an integer >= 1000 ms only, received: ${JSON.stringify(v)}.`);
    }
    config.protocolTimeoutMs = v;
  }

  // 渲染事件钩子（1.7.0 起社区版可观测性入口）：函数或 null（关闭）
  if (option.onEvent !== undefined) {
    if (option.onEvent !== null && typeof option.onEvent !== 'function') {
      throw xlsxError('E_OPTION_INVALID',
        `[xlsx2pdf] configure({ onEvent }) 只接受回调函数 (evt) => void 或 null（关闭），收到：${typeof option.onEvent}`,
        `configure({ onEvent }) accepts a callback function (evt) => void or null (disable) only, received: ${typeof option.onEvent}.`);
    }
    config.onEvent = option.onEvent;
  }

  // 标记类型别名（1.7.0 起）：替换式映射，null 恢复内置默认，{} 清空
  if (option.markerAliases !== undefined) {
    validateMarkerAliases(option.markerAliases, 'configure');
    config.markerAliases = option.markerAliases;
  }

  // 商业版声明的额外参数化键（未声明的键静默忽略，保持社区版行为）
  const seams = getSeams();
  const accepted = new Set(seams.extraConfigKeys);
  if (accepted.has('memoryGuard') && option.memoryGuard !== undefined) {
    config.memoryGuard = { ...config.memoryGuard, ...option.memoryGuard };
  }
  if (accepted.has('log') && option.log !== undefined) {
    const lg = option.log;
    if (lg === null || typeof lg !== 'object') {
      throw xlsxError('E_OPTION_INVALID',
        `[xlsx2pdf] configure({ log }) 只接受对象 { enabled, path, logger, maxMB }，收到：${JSON.stringify(lg)}`,
        `configure({ log }) accepts an object { enabled, path, logger, maxMB } only, received: ${JSON.stringify(lg)}.`);
    }
    if (lg.enabled !== undefined && typeof lg.enabled !== 'boolean') {
      throw xlsxError('E_OPTION_INVALID', `[xlsx2pdf] configure({ log.enabled }) 只接受 boolean，收到：${JSON.stringify(lg.enabled)}`, 'configure({ log.enabled }) accepts boolean only.');
    }
    if (lg.path !== undefined && lg.path !== null && typeof lg.path !== 'string') {
      throw xlsxError('E_OPTION_INVALID', `[xlsx2pdf] configure({ log.path }) 只接受字符串路径，收到：${JSON.stringify(lg.path)}`, 'configure({ log.path }) accepts a string path only.');
    }
    if (lg.logger !== undefined && lg.logger !== null && typeof lg.logger !== 'function') {
      throw xlsxError('E_OPTION_INVALID', `[xlsx2pdf] configure({ log.logger }) 只接受回调函数 (event) => void，收到：${typeof lg.logger}`, 'configure({ log.logger }) accepts a callback function only.');
    }
    if (lg.maxMB !== undefined && (typeof lg.maxMB !== 'number' || !(lg.maxMB > 0))) {
      throw xlsxError('E_OPTION_INVALID', `[xlsx2pdf] configure({ log.maxMB }) 只接受正数（轮转阈值 MB），收到：${JSON.stringify(lg.maxMB)}`, 'configure({ log.maxMB }) accepts a positive number only.');
    }
    config.log = { ...config.log, ...lg };
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
  // 守护自治参数化键（商业版声明后接受；非负整数类统一校验；
  // browserIdleMs/browserMaxAgeMs/browserRecycleRenders 已下放社区版恒接受，不在此列）
  for (const key of ['maxPages', 'templateCacheMB', 'spillThresholdMB']) {
    if (accepted.has(key) && option[key] !== undefined) {
      const v = option[key];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
        throw xlsxError('E_OPTION_INVALID',
          `[xlsx2pdf] configure({ ${key} }) 只接受非负整数（0 关闭），收到：${JSON.stringify(v)}`,
          `configure({ ${key} }) accepts a non-negative integer only (0 disables), received: ${JSON.stringify(v)}.`);
      }
      config[key] = v;
    }
  }
  if (accepted.has('templateCacheMB')) setTemplateCacheBudget(config.templateCacheMB);
  if (accepted.has('batchSize') && option.batchSize !== undefined) {
    const v = option.batchSize;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
      throw xlsxError('E_OPTION_INVALID',
        `[xlsx2pdf] configure({ batchSize }) 只接受正整数，收到：${JSON.stringify(v)}`,
        `configure({ batchSize }) accepts a positive integer only, received: ${JSON.stringify(v)}.`);
    }
    config.batchSize = v;
  }
  if (accepted.has('guardMode') && option.guardMode !== undefined) {
    if (!['auto', 'local', 'sidecar'].includes(option.guardMode)) {
      throw xlsxError('E_OPTION_INVALID',
        `[xlsx2pdf] configure({ guardMode }) 只接受 auto / local / sidecar，收到：${JSON.stringify(option.guardMode)}`,
        `configure({ guardMode }) accepts auto / local / sidecar only, received: ${JSON.stringify(option.guardMode)}.`);
    }
    config.guardMode = option.guardMode;
  }
  return {
    ...config,
    launchArgs: [...config.launchArgs],
    memoryGuard: { ...config.memoryGuard },
    log: { ...config.log },
    markerAliases: config.markerAliases ? { ...config.markerAliases } : null,
  };
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
    // 可执行性预检：spawn EACCES 裸报错难定位（权限位/snap 包装脚本/noexec 挂载），
    // 配置解析层早拦截附排查指引（noexec 类 access 过但 execve 拒的由 launchError 承接）
    try {
      fs.accessSync(external, fs.constants.X_OK);
    } catch (_) {
      throw xlsxError('E_BROWSER_PATH',
        `指定的浏览器可执行文件无执行权限（EACCES）: ${external}。请 ls -l 检查执行位（chmod +x 修复）；Ubuntu/Debian 的 /usr/bin/chromium-browser 可能是 snap 包装脚本，容器内不可用，请改指真实二进制路径或使用内置 Chrome（ensureBrowser()）`,
        `The specified browser executable is not executable (EACCES): ${external}. Check the exec bit (chmod +x); on Ubuntu/Debian /usr/bin/chromium-browser may be a snap wrapper unusable in containers — point to the real binary or use the bundled Chrome (ensureBrowser()).`);
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
