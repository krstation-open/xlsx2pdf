/**
 * 构建脚本（社区版）：esbuild 双模式产物（ESM/CJS）
 *
 * 开源包必须可读：仅 minify 压缩，不做任何混淆；src 与 dist 均随包发布。
 * 不产出 sourcemap（产物即压缩后的源码本身）。
 */
import esbuild from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const deps = Object.keys(pkg.dependencies);

const common = {
  entryPoints: ['src/index.js'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  external: deps,
  sourcemap: false,
  minify: true, // 压缩空白 + 重命名局部标识符（开源可读，不混淆）
  // 静默 CJS 产物中 import.meta 不可用的告警（pkgRoot 三元短路保证不会真正取值）
  logOverride: { 'empty-import-meta': 'silent' },
};

await esbuild.build({ ...common, format: 'esm', outfile: 'dist/index.mjs' });
await esbuild.build({ ...common, format: 'cjs', outfile: 'dist/index.cjs' });
console.log('[build] 产物完成: dist/index.mjs, dist/index.cjs');