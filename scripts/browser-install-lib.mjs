/**
 * 内置浏览器下载逻辑（postinstall / npx CLI / ensureBrowser 共用）
 *
 * - 镜像源下载 Chrome（npmmirror），失败自动重试，规避国内网络波动
 * - 只下载 chrome（headless:'new' 不需要 chrome-headless-shell）
 * - Linux 下额外检测 Chrome 依赖的系统库，缺失时自动 apt-get 安装
 *   （需 root 或免密 sudo；无权限则打印手动安装命令，不中断流程）
 * - 下载位置 = 包根目录 browsers/（基于模块自身位置解析，与 cwd 无关）
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { install, Browser, detectBrowserPlatform, computeExecutablePath } from '@puppeteer/browsers';
import { PUPPETEER_REVISIONS } from 'puppeteer-core/internal/revisions.js';

/** 国内镜像下载 Chrome（避免 Google 源超时/连接重置） */
export const DOWNLOAD_BASE_URL = 'https://registry.npmmirror.com/-/binary/chrome-for-testing';
export const MAX_RETRIES = 5;

/** 包根目录（scripts/ 的上级），与 cwd 无关 */
function pkgRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function cacheDir() {
  return path.join(pkgRoot(), 'browsers');
}

export function buildId() {
  return PUPPETEER_REVISIONS.chrome;
}

export function expectedExecutablePath() {
  return computeExecutablePath({
    cacheDir: cacheDir(),
    browser: Browser.CHROME,
    buildId: buildId(),
    platform: detectBrowserPlatform(),
  });
}

/** 删除已有构建（--force 重装前调用） */
export function removeExistingBuild() {
  const browserRoot = path.join(cacheDir(), 'chrome');
  if (existsSync(browserRoot)) {
    console.log(`[browser] 删除已有构建: ${browserRoot}`);
    rmSync(browserRoot, { recursive: true, force: true });
  }
}

// ============ Linux 系统依赖检测与自动安装 ============

// 共享库文件名 → apt 包名；函数/数组表示多候选（安装前用 apt-cache 探测选实际存在的）
const LIB_TO_PKG = {
  'libnss3.so': 'libnss3',
  'libnspr4.so': 'libnspr4',
  'libatk-1.0.so': 'libatk1.0-0',
  'libatk-bridge-2.0.so': 'libatk-bridge2.0-0',
  'libcups.so': 'libcups2',
  'libdrm.so': 'libdrm2',
  'libgbm.so': 'libgbm1',
  'libxkbcommon.so': 'libxkbcommon0',
  'libXcomposite.so': 'libxcomposite1',
  'libXdamage.so': 'libxdamage1',
  'libXfixes.so': 'libxfixes3',
  'libXrandr.so': 'libxrandr2',
  'libpango-1.0.so': 'libpango-1.0-0',
  'libpangocairo-1.0.so': 'libpangocairo-1.0-0',
  'libcairo.so': 'libcairo2',
  'libxshmfence.so': 'libxshmfence1',
  'libasound.so': ({ id, versionId }) => {
    // Ubuntu 24.04+ 起包名改为 libasound2t64
    if (id === 'ubuntu' && parseFloat(versionId) >= 24) return ['libasound2t64'];
    return ['libasound2', 'libasound2t64'];
  },
};

// 读取 /etc/os-release 获取发行版信息（id: ubuntu/debian/centos…）
function readOsRelease() {
  try {
    const text = readFileSync('/etc/os-release', 'utf8');
    const get = key => {
      const m = text.match(new RegExp(`^${key}="?([^"\\n]*)"?`, 'm'));
      return m ? m[1] : '';
    };
    return { id: get('ID').toLowerCase(), versionId: get('VERSION_ID') };
  } catch {
    return { id: '', versionId: '' };
  }
}

// 解析 ldd 输出中 "not found" 的库，映射为 apt 包名；无法映射的记录原名
// ldd 输出的 soname 带版本后缀（如 libasound.so.2），按 .so 截断取基础名再查表
function parseMissingLibs(lddOutput, osInfo) {
  const missing = new Set();
  let hasUnknown = false;
  for (const line of lddOutput.split('\n')) {
    if (!line.includes('not found')) continue;
    const lib = line.trim().split(/\s+/)[0];
    const base = lib.includes('.so') ? lib.slice(0, lib.indexOf('.so') + 3) : lib;
    const pkg = LIB_TO_PKG[base];
    if (!pkg) {
      console.warn(`[browser]   未知库（无对应包名映射）: ${lib}`);
      hasUnknown = true;
      continue;
    }
    const candidates = typeof pkg === 'function' ? pkg(osInfo) : [pkg];
    missing.add(candidates);
  }
  return { missing: [...missing], hasUnknown };
}

// root 直接安装；否则尝试免密 sudo（sudo -n true），避免卡在密码输入
function resolveSudo() {
  if (typeof process.getuid === 'function' && process.getuid() === 0) return '';
  if (spawnSync('sudo', ['-n', 'true'], { stdio: 'ignore' }).status === 0) return 'sudo ';
  return null;
}

// 多候选包名时，用 apt-cache 探测选出实际存在的包；都不可用则保留首个候选
function pickPackages(candidatesList, sudo) {
  return candidatesList.map(candidates => {
    for (const pkg of candidates) {
      if (spawnSync(`${sudo}apt-cache`, ['show', pkg], { shell: true, stdio: 'ignore' }).status === 0) {
        return pkg;
      }
    }
    return candidates[0];
  });
}

// ldd 检测并返回是否仍有缺失
function hasMissingLibs(chromePath) {
  const ldd = spawnSync('ldd', [chromePath], { encoding: 'utf8' });
  if (ldd.status !== 0) return false; // ldd 不可用时不阻断
  return ldd.stdout.includes('not found');
}

// 检测 Chrome 依赖的系统库并尝试自动安装；任何环节失败仅告警，不中断流程
export function ensureLinuxDeps(chromePath) {
  if (process.platform !== 'linux') return;
  const ldd = spawnSync('ldd', [chromePath], { encoding: 'utf8' });
  if (ldd.status !== 0) {
    console.warn(`[browser] ldd 检测失败（${ldd.stderr?.trim() || '未知原因'}），跳过依赖检查`);
    return;
  }
  if (!ldd.stdout.includes('not found')) {
    console.log('[browser] Chrome 系统依赖库齐全，无需安装');
    return;
  }

  const osInfo = readOsRelease();
  const { missing, hasUnknown } = parseMissingLibs(ldd.stdout, osInfo);
  console.warn('[browser] 检测到 Chrome 缺少系统依赖库，尝试自动安装…');
  if (missing.length === 0) {
    console.warn('[browser] 缺失库均无包名映射，请手动执行 ldd 检查并安装对应包：');
    console.warn(`[browser]   ldd ${chromePath} | grep "not found"`);
    return;
  }

  if (osInfo.id !== 'ubuntu' && osInfo.id !== 'debian') {
    console.warn(`[browser] 当前发行版（${osInfo.id || '未知'}）暂不支持自动安装，请参考缺少的库手动安装：`);
    console.warn(`[browser]   ${[...missing].flat().join(' ')}`);
    return;
  }

  const sudo = resolveSudo();
  if (sudo === null) {
    console.warn('[browser] 非 root 且无免密 sudo 权限，无法自动安装。请手动执行：');
    console.warn(`[browser]   sudo apt-get install -y ${[...missing].flat().join(' ')}`);
    return;
  }

  const pkgs = pickPackages(missing, sudo);
  const cmd = `${sudo}apt-get install -y --no-install-recommends ${pkgs.join(' ')}`;
  console.log(`[browser] 执行: ${cmd}`);
  const res = spawnSync(cmd, { shell: true, stdio: 'inherit' });
  if (res.status !== 0) {
    console.warn('[browser] 自动安装失败，请手动执行上面的命令；若提示包不存在，先执行 apt-get update');
    return;
  }

  // 安装后重新验证，确保没有遗漏（含无法映射的库）
  if (hasMissingLibs(chromePath)) {
    console.warn('[browser] 安装后仍有缺失库，请手动检查：');
    console.warn(`[browser]   ldd ${chromePath} | grep "not found"`);
    return;
  }
  console.log('[browser] 系统依赖库安装完成，验证通过');
  if (hasUnknown) {
    console.warn('[browser] 注：部分缺失库无包名映射，但复检已无缺失（可能为可选依赖），可忽略');
  }
}

// ============ 下载主流程 ============

/**
 * 下载内置 Chrome（带进度输出 + 重试 + Linux 依赖检测）。
 * 幂等性由调用方保证（先判已存在/--force），本函数总是执行下载。
 */
export async function installBrowser() {
  const id = buildId();
  const platform = detectBrowserPlatform();
  const execPath = expectedExecutablePath();

  console.log(`[browser] 开始下载 Chrome ${id} (${platform})`);
  console.log(`[browser] 镜像源: ${DOWNLOAD_BASE_URL}`);

  let lastPercent = -1;

  for (let attempt = 1; ; attempt++) {
    try {
      await install({
        cacheDir: cacheDir(),
        browser: Browser.CHROME,
        buildId: id,
        baseUrl: DOWNLOAD_BASE_URL,
        downloadProgressCallback: (done, total) => {
          const percent = Math.floor((done / total) * 100);
          if (percent >= lastPercent + 20) {
            lastPercent = percent;
            console.log(`[browser] 下载进度: ${percent}%`);
          }
        },
      });
      console.log(`[browser] 下载完成: ${execPath}`);
      ensureLinuxDeps(execPath);
      return execPath;
    } catch (err) {
      lastPercent = -1;
      if (attempt >= MAX_RETRIES) {
        throw new Error(`重试 ${MAX_RETRIES} 次仍失败: ${err.message}`);
      }
      const delay = attempt * 3000;
      console.warn(`[browser] 下载失败 (${err.message})，${delay / 1000}s 后第 ${attempt + 1}/${MAX_RETRIES} 次重试…`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
