#!/usr/bin/env node
/**
 * 商业秘密红线扫描（CI 闸门）：零命中才放行
 *
 * 扫描范围：src/ scripts/ test/ dist/（存在时） index.d.ts package.json
 * （README 等文档按方案 §5 草稿单独红线自查，不在本扫描范围）
 *
 * 关键词口径说明：
 * - 只扫「闭源实现特征标识符」，不扫公开功能名：功能名（如字体缺失守卫、
 *   内存准入守卫）在 README 对比表与 Pro 引导错误中有意公开；
 *   引导错误携带的 option 键（fontGuard/memoryGuard 等）属公开 API 面。
 * - renderTableFragment/computeRowFlags/registry 属通用渲染/扩展机制，
 *   核心合法持有，不在关键词与禁存文件清单内（接缝架构）。
 * - 富媒体基础下放后（1.1.0）：bwip-js/image-size 为社区合法依赖，barcode/image/markers
 *   为核心合法模块；sharp（native 压缩/DPI）仍禁引入核心，改用引入级检测（import/require/
 *   dependencies），评论提及不拦。
 * - 私有源关键词用「@krstation/」（带斜杠的包作用域前缀）：
 *   公开联系邮箱 business@krstation.com 含 "@krstation" 子串，属有意公开信息。
 * - 本脚本自身持有全部关键词，扫描时排除自身。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 闭源实现特征标识符（商业秘密点①②及其配套管线） */
const CODE_KEYWORDS = [
  'DEFAULT_MDW_TABLE',
  'LATIN_MDW_TABLE',
  'resolveDefaultMdw',
  'fitToPageScript',
  'shrinkWidthOnlyScript',
  'watermarkFitScript',
  'buildMeasureScript',
  'buildFitScript',
  'buildWatermarkScript',
  'remeasureColumns',
  '__xlsx2pdfFont',
  '__xlsx2pdf_no_font_sentinel__',
  'FONT_GUARD_MODES',
  'admitMemory',
  'markLandscapeRotation',
  'javascript-obfuscator',
];

/** sharp 引入级检测（native 压缩/DPI 归一为商业版独占，核心禁引入；评论提及不拦） */
const SHARP_IMPORT_RE = /(?:from\s*|require\(\s*)['"]sharp['"]/;

/** 私有分发信息（私有包作用域 / 私有源 / 服务器 / 凭据 / 私有许可证） */
const PRIVATE_KEYWORDS = [
  '@krstation/',
  'npm.krstation.com',
  '43.136.62.32',
  '_authToken',
  'UNLICENSED',
];

/** 中文实现特征（算法细节描述） */
const CN_KEYWORDS = ['哨兵', 'GDI', '实测 MDW'];

const ALL_KEYWORDS = [...CODE_KEYWORDS, ...PRIVATE_KEYWORDS, ...CN_KEYWORDS];

/** 禁止存在的文件（整体不复制的 Pro 模块；registry 为通用扩展机制留核心内部） */
const FORBIDDEN_FILES = [
  'src/fit.js',
  'src/orientation.js',
  'src/memory.js',
];

/** 扫描目标（目录递归 / 单文件） */
const SCAN_DIRS = ['src', 'scripts', 'test', 'dist'];
const SCAN_FILES = ['index.d.ts', 'package.json'];

/** 排除自身（关键词清单天然命中） */
const SELF = path.join('scripts', 'redline-scan.mjs');

const hits = [];

function scanFile(absPath) {
  const rel = path.relative(root, absPath);
  if (rel === SELF) return;
  const text = readFileSync(absPath, 'utf8');
  const lines = text.split('\n');
  for (const kw of ALL_KEYWORDS) {
    lines.forEach((line, i) => {
      if (line.includes(kw)) {
        hits.push(`${rel}:${i + 1}  命中关键词 "${kw}"`);
      }
    });
  }
  lines.forEach((line, i) => {
    if (SHARP_IMPORT_RE.test(line)) {
      hits.push(`${rel}:${i + 1}  禁止引入 sharp（native 压缩为商业版独占）`);
    }
  });
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    // 跳过本地产物/依赖目录（二进制产物非公开源码，且已 gitignore）
    if (name === 'output' || name === 'node_modules') continue;
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs);
    else scanFile(abs);
  }
}

// 1. 禁存文件断言
for (const rel of FORBIDDEN_FILES) {
  if (existsSync(path.join(root, rel))) {
    hits.push(`${rel}  禁止存在的文件出现在公开目录`);
  }
}

// 2. 关键词扫描
for (const dir of SCAN_DIRS) {
  const abs = path.join(root, dir);
  if (existsSync(abs)) walk(abs);
}
for (const rel of SCAN_FILES) {
  const abs = path.join(root, rel);
  if (existsSync(abs)) scanFile(abs);
}

// 3. dependencies 禁含 sharp（native 编译破坏社区零依赖安装卖点）
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.dependencies && pkg.dependencies.sharp) {
  hits.push('package.json  dependencies.sharp 禁止引入核心');
}

if (hits.length > 0) {
  console.error(`[redline] 红线扫描未通过：${hits.length} 处命中`);
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}

console.log('[redline] 红线扫描通过：关键词零命中，禁存文件均不存在');