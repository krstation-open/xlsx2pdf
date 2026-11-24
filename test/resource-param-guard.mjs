/**
 * 社区版规模守卫参数化开放回归守卫（1.7.0：maxCells/maxTemplateSize 下放 + 风险告警）
 *
 * 契约：
 *  ① 调小上限生效（E_CELL_CAP/E_SIZE_CAP 触发阈随配置变化，option 与 configure 两级）
 *  ② 0/负数 = 关闭守卫（既有语义保留）
 *  ③ 超善意默认（20000 格 / 5MB）且无内存准入接缝：一次性双语告警（进程内只提醒一次，
 *     configure 级与 buildHtml 级共享标志）
 *  ④ 有接缝（requestAdmit/memoryAdmit）不告警
 *  ⑤ 非数值抛 E_OPTION_INVALID（双语）
 * 运行：node test/resource-param-guard.mjs（excel2html 链路，无需浏览器）
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { excel2html, configure, Xlsx2pdfError } from '../src/index.js';
import { getConfig } from '../src/browser.js';
import { registerSeams } from '../src/seams.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'output');
fs.mkdirSync(outDir, { recursive: true });

// 10×10 = 100 格模板（调小上限触发 / 关闭守卫放行两用）
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('R');
for (let r = 1; r <= 10; r++) {
  for (let c = 1; c <= 10; c++) {
    ws.getCell(r, c).value = 'x';
  }
}
const tpl = path.join(outDir, 'tpl-resource.xlsx');
await wb.xlsx.writeFile(tpl);

const DEFAULT_CELLS = 20000;
const DEFAULT_SIZE = 5 * 1024 * 1024;

/** 断言抛指定码且双语 */
async function expectCode(label, fn, code, zhFragment, enFragment) {
  let err;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Xlsx2pdfError, `${label}: 应为 Xlsx2pdfError`);
  assert.strictEqual(err.code, code, `${label}: 码应为 ${code}，实际 ${err.code}`);
  assert.ok(err.message.includes(zhFragment), `${label}: 中文文案应含「${zhFragment}」`);
  assert.ok(err.message.includes(enFragment), `${label}: 英文文案应含「${enFragment}」`);
  console.log(`  ✓ ${label} → ${code}`);
}

/** 捕获 console.warn 执行 fn，返回告警数组 */
async function captureWarns(fn) {
  const warns = [];
  const orig = console.warn;
  console.warn = (...args) => { warns.push(args.join(' ')); };
  try {
    await fn();
  } finally {
    console.warn = orig;
  }
  return warns;
}

console.log('[resource-param-guard] 社区版规模守卫参数化契约');

// ============ ① 调小上限生效（option 与 configure 两级） ============
await expectCode('option.maxCells=50（100 格模板）',
  () => excel2html({ template: tpl, option: { maxCells: 50 } }),
  'E_CELL_CAP', '单元格数超过上限', 'cell cap');
configure({ maxCells: 50 });
await expectCode('configure({ maxCells: 50 })',
  () => excel2html({ template: tpl }),
  'E_CELL_CAP', '单元格数超过上限', 'cell cap');
configure({ maxCells: DEFAULT_CELLS });

await expectCode('option.maxTemplateSize=1',
  () => excel2html({ template: tpl, option: { maxTemplateSize: 1 } }),
  'E_SIZE_CAP', '模板文件过大', 'Template file too large');
configure({ maxTemplateSize: 1 });
await expectCode('configure({ maxTemplateSize: 1 })',
  () => excel2html({ template: tpl }),
  'E_SIZE_CAP', '模板文件过大', 'Template file too large');
configure({ maxTemplateSize: DEFAULT_SIZE });
// 调用级 > 全局：全局调小，调用级放宽放行
configure({ maxCells: 50 });
const override = await excel2html({ template: tpl, option: { maxCells: DEFAULT_CELLS } });
assert.ok(override.html.includes('x'), '调用级 maxCells 应覆盖全局调小值');
configure({ maxCells: DEFAULT_CELLS });
console.log('  ✓ ① 调小上限生效；调用级覆盖全局');

// ============ ② 0/负数 = 关闭守卫 ============
for (const off of [0, -1]) {
  const r = await excel2html({ template: tpl, option: { maxCells: off, maxTemplateSize: off } });
  assert.ok(r.html.includes('x'), `maxCells/maxTemplateSize=${off} 应关闭守卫放行`);
}
configure({ maxCells: 0, maxTemplateSize: 0 });
const cfgOff = await excel2html({ template: tpl });
assert.ok(cfgOff.html.includes('x'), 'configure 级 0 同样关闭守卫');
configure({ maxCells: DEFAULT_CELLS, maxTemplateSize: DEFAULT_SIZE });
console.log('  ✓ ② 0/负数关闭守卫（option 与 configure 两级）');

// ============ ⑤ 非数值拒绝（先于告警用例，避免污染一次性标志） ============
for (const bad of ['x', null, {}]) {
  await expectCode(`configure({ maxCells: ${JSON.stringify(bad)} })`,
    () => configure({ maxCells: bad }),
    'E_OPTION_INVALID', '只接受数值', 'accepts a number only');
  await expectCode(`option.maxTemplateSize = ${JSON.stringify(bad)}`,
    () => excel2html({ template: tpl, option: { maxTemplateSize: bad } }),
    'E_OPTION_INVALID', '只接受数值', 'accepts a number only');
}
assert.strictEqual(getConfig().maxCells, DEFAULT_CELLS, '非法值拒绝后默认不变');
assert.strictEqual(getConfig().maxTemplateSize, DEFAULT_SIZE, '非法值拒绝后默认不变');

// ============ ④ 有接缝不告警（须先于 ③：一次性标志进程内共享） ============
registerSeams({ requestAdmit: async () => () => { } });
try {
  const warns = await captureWarns(async () => {
    configure({ maxCells: 30000 });
    await excel2html({ template: tpl, option: { maxCells: 30000 } });
  });
  assert.strictEqual(warns.filter((m) => m.includes('规模上限')).length, 0, '有 requestAdmit 接缝时不应告警');
} finally {
  configure({ maxCells: DEFAULT_CELLS });
  registerSeams({ requestAdmit: null });
}
console.log('  ✓ ④ 有内存准入接缝不告警');

// ============ ③ 超默认无接缝：一次性双语告警 ============
const warns = await captureWarns(async () => {
  configure({ maxCells: 40000 }); // 首次超默认 → 告警一次
  configure({ maxTemplateSize: 8 * 1024 * 1024 }); // 再次放宽 → 不重复
  await excel2html({ template: tpl, option: { maxCells: 50000 } }); // buildHtml 级入口共享标志
});
const riskWarns = warns.filter((m) => m.includes('规模上限已放宽'));
assert.strictEqual(riskWarns.length, 1, `超默认告警应只打一次，实际 ${riskWarns.length}`);
assert.ok(riskWarns[0].includes('Template size caps relaxed'), '告警应双语（英文文案存在）');
assert.ok(riskWarns[0].includes('内存'), '告警应提示内存风险');
configure({ maxCells: DEFAULT_CELLS, maxTemplateSize: DEFAULT_SIZE });
console.log('  ✓ ③ 超默认无接缝一次性双语告警（configure/buildHtml 共享标志）');

console.log('[resource-param-guard] 全部通过 ✅');