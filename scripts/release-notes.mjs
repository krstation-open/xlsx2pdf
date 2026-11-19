/**
 * 从 CHANGELOG.md 提取指定版本的段落（tag → GitHub Release 自动化用）
 *
 * 用法：node scripts/release-notes.mjs <version>
 * 输出：该版本 `## [x.y.z]` 标题之后、下一个 `## [` 之前的正文（stdout）；
 * 找不到版本段落时退出码 1。CHANGELOG 保持手写源 of truth，本脚本只做提取。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!version) {
  console.error('用法 / Usage: node scripts/release-notes.mjs <version>');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');

// 匹配 `## [x.y.z]`（可带 ` - 日期` 后缀），取到下一个二级标题为止
const headingRe = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\][^\\n]*\\n`, 'm');
const match = changelog.match(headingRe);
if (!match) {
  console.error(`[release-notes] CHANGELOG 中未找到版本 ${version} 的段落 / No section for version ${version}`);
  process.exit(1);
}

const rest = changelog.slice(match.index + match[0].length);
const nextIdx = rest.search(/^## \[/m);
const body = (nextIdx === -1 ? rest : rest.slice(0, nextIdx)).trim();

// 去掉尾部链接定义行（[x.y.z]: https://...），Release 正文不需要
const cleaned = body.replace(/^\[[^\]]+\]:\s*\S+\s*$/gm, '').trim();
console.log(cleaned);