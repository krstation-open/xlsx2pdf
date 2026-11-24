/**
 * 社区版空行占位识别开放回归守卫（1.7.0：emptyRowPlaceholders 下放社区版）
 *
 * 契约：
 *  ① ['--'] 占位行被识别为空行（data-empty=2，行高保真参与空行语义）
 *  ② 非字符串数组抛 E_OPTION_INVALID（双语）
 *  ③ 不传时行为不变（与显式 [] 产物字节一致）
 * 叙事边界：本项只下放「识别」；fit 自适应收缩联动仍 Pro（社区无脚本注入）。
 * 运行：node test/emptyrow-guard.mjs（excel2html 链路，无需浏览器）
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { excel2html, Xlsx2pdfError } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'output');
fs.mkdirSync(outDir, { recursive: true });

// 三行模板：内容行 / '--' 占位行 / 内容行
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('E');
ws.getCell('A1').value = '抬头';
ws.getCell('A2').value = '--';
ws.getCell('A3').value = '结尾';
const tpl = path.join(outDir, 'tpl-emptyrow.xlsx');
await wb.xlsx.writeFile(tpl);

/** 断言抛 E_OPTION_INVALID 且双语 */
async function expectInvalid(label, fn) {
  let err;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Xlsx2pdfError, `${label}: 应为 Xlsx2pdfError`);
  assert.strictEqual(err.code, 'E_OPTION_INVALID', `${label}: 码应为 E_OPTION_INVALID，实际 ${err.code}`);
  assert.ok(err.message.includes('只接受字符串数组'), `${label}: 中文文案保留`);
  assert.ok(err.message.includes('array of strings'), `${label}: 英文文案存在`);
  console.log(`  ✓ ${label} → E_OPTION_INVALID`);
}

const htmlOf = (option) => excel2html({ template: tpl, option }).then((r) => r.html);
const countEmpty2 = (html) => (html.match(/data-empty="2"/g) || []).length;

console.log('[emptyrow-guard] 社区版 emptyRowPlaceholders 开放契约');

// ============ ① 占位行识别 ============
const plain = await htmlOf({});
const withPh = await htmlOf({ emptyRowPlaceholders: ['--'] });
assert.strictEqual(countEmpty2(plain), 0, '不传时 -- 行是普通内容行（data-empty=0）');
assert.ok(plain.includes('data-empty="0"'), '不传时内容行标记 0');
assert.strictEqual(countEmpty2(withPh), 1, "['--'] 应把占位行识别为空行（data-empty=2）");
assert.ok(withPh.includes('--'), '占位字符本身仍渲染（识别不删内容）');
// 多占位符同口径
const multi = await htmlOf({ emptyRowPlaceholders: ['--', 'N/A'] });
assert.strictEqual(countEmpty2(multi), 1, '多占位符列表同样生效');
console.log('  ✓ ① 占位行识别为空行（data-empty=2）');

// ============ ② 非法值拒绝 ============
for (const bad of ['--', [1], ['a', 2], {}, null]) {
  await expectInvalid(`option.emptyRowPlaceholders = ${JSON.stringify(bad)}`,
    () => excel2html({ template: tpl, option: { emptyRowPlaceholders: bad } }));
}

// ============ ③ 不传时行为不变 ============
const explicitEmpty = await htmlOf({ emptyRowPlaceholders: [] });
assert.strictEqual(explicitEmpty, plain, '显式 [] 与不传产物字节一致');
assert.ok(!plain.includes('<script'), '社区版产物无脚本注入（自适应收缩联动仍 Pro）');
console.log('  ✓ ③ 不传时行为不变（与 [] 字节一致，无脚本注入）');

console.log('[emptyrow-guard] 全部通过 ✅');