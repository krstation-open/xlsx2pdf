#!/usr/bin/env node
/**
 * xlsx2pdf 内置浏览器安装脚本
 *
 * 三种入口（共用同一下载逻辑，均幂等）：
 *  1. postinstall：npm i xlsx2pdf 时自动执行（无参数）
 *     - 支持跳过：npm i xlsx2pdf --no-browser（= npm_config_browser=false）
 *       或 .npmrc 写 browser=false / 环境变量 XLSX2PDF_SKIP_BROWSER=1
 *       或前缀别名 --xlsx2pdf-skip-browser（避免与其他包共用 browser 键冲突）
 *     - 跳过时不阻断安装，打印后续补装指引
 *  2. CLI：npx xlsx2pdf-browser install [--force]（显式调用，不受跳过开关影响）
 *  3. 手动：node node_modules/xlsx2pdf/scripts/install-browser.mjs [--force]
 *
 * --force：删除已有构建后强制重新下载（修复损坏/升级场景）
 */
import { existsSync } from 'node:fs';
import {
  installBrowser,
  ensureLinuxDeps,
  removeExistingBuild,
  expectedExecutablePath,
} from './browser-install-lib.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');
// 显式调用（带子命令/参数）不受 postinstall 跳过开关影响
const explicit = args.length > 0;

function printSkipGuidance() {
  console.log('[xlsx2pdf-browser] 已跳过内置浏览器下载。后续如需使用内置浏览器：');
  console.log('[xlsx2pdf-browser]   补装：npx xlsx2pdf-browser install（或代码内 await ensureBrowser()）');
  console.log('[xlsx2pdf-browser]   自带浏览器则无需补装：configure({ browserPath }) 或环境变量 XLSX2PDF_BROWSER_PATH');
}

// ============ postinstall 跳过判定（仅无参数自动执行时生效） ============
// npm 的 --no-xxx 语义会注入 npm_config_xxx；实测 npm 10 注入的是空字符串
// （不带该标志时变量为 undefined），故空串/0/false 均视为跳过；
// CLI 标志与 .npmrc 殊途同归
if (!explicit) {
  const env = process.env;
  const browserFlag = env.npm_config_browser;
  const skipped =
    (browserFlag !== undefined && (browserFlag === '' || browserFlag === 'false' || browserFlag === '0')) ||
    env.npm_config_xlsx2pdf_skip_browser === 'true' ||
    env.XLSX2PDF_SKIP_BROWSER === '1' ||
    env.XLSX2PDF_SKIP_BROWSER === 'true' ||
    env.npm_config_ignore_scripts === 'true';
  if (skipped) {
    printSkipGuidance();
    process.exit(0);
  }
}

// ============ 安装主流程 ============
const execPath = expectedExecutablePath();

try {
  if (!force && existsSync(execPath)) {
    // 已存在且未指定 --force：秒级跳过（仅复检 Linux 系统依赖）
    console.log(`[browser] 内置浏览器已存在，跳过下载: ${execPath}`);
    ensureLinuxDeps(execPath);
    process.exit(0);
  }

  if (force) {
    removeExistingBuild();
  }
  await installBrowser();
} catch (err) {
  console.error(`[browser] ${err.message}`);
  console.error('[browser] 请检查网络后手动执行: npx xlsx2pdf-browser install');
  // postinstall 阶段下载失败不阻断 npm install（运行时 ensureBrowser 可兜底）
  process.exit(explicit ? 1 : 0);
}
