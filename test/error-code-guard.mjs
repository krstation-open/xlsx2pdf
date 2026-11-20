/**
 * 社区版错误码守卫（1.3.0 信任基线：稳定 err.code + 双语 message 的回归基线）
 *
 * 契约：
 *  - 可预期失败抛 Xlsx2pdfError，err.code 为稳定 E_* 码（docs/errors.md 有锚点）
 *  - message 中文原文逐字保留（不破坏既有字符串匹配）+ 英文追加
 *  - Pro 引导错误同样给码，且保留 /Pro/ 与咨询邮箱（转化入口不弱化）
 * 覆盖：模板/数据/option/标记/护栏/纸张/下载/插件/条码/浏览器路径各类错误。
 * 运行：node test/error-code-guard.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { excel2html, excel2pdf, configure, use, helpers, Xlsx2pdfError } from '../src/index.js';
import { builtinExecutablePath } from '../src/browser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'output');
fs.mkdirSync(outDir, { recursive: true });

/** 断言抛错且码/双语/中文原文符合契约 */
async function expectCode(label, fn, code, zhFragment, enFragment) {
  let err;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err, `${label}: 应抛错`);
  assert.ok(err instanceof Xlsx2pdfError, `${label}: 应为 Xlsx2pdfError`);
  assert.strictEqual(err.code, code, `${label}: 错误码应为 ${code}，实际 ${err.code}`);
  assert.ok(err.message.includes(zhFragment), `${label}: 中文原文应保留「${zhFragment}」`);
  assert.ok(err.message.includes(enFragment), `${label}: 应含英文「${enFragment}」`);
  console.log(`  ✓ ${label} → ${code}`);
  return err;
}

// 基础模板（text 标记，供需要合法模板的用例复用）
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Err');
ws.getCell('A1').value = '${name}';
const tpl = path.join(outDir, 'tpl-err.xlsx');
await wb.xlsx.writeFile(tpl);

// watermark 标记模板（Pro 标记引导）
const wbWm = new ExcelJS.Workbook();
wbWm.addWorksheet('Wm').getCell('A1').value = '${t|watermark}';
const tplWm = path.join(outDir, 'tpl-err-watermark.xlsx');
await wbWm.xlsx.writeFile(tplWm);

// 自定义纸张模板（代码 256，尺寸在打印机驱动内）与不支持代码模板（200）
const wbCustom = new ExcelJS.Workbook();
wbCustom.addWorksheet('Custom').pageSetup = { paperSize: 256 };
wbCustom.worksheets[0].getCell('A1').value = 'x';
const tplCustom = path.join(outDir, 'tpl-err-paper256.xlsx');
await wbCustom.xlsx.writeFile(tplCustom);

const wbCode = new ExcelJS.Workbook();
wbCode.addWorksheet('Code').pageSetup = { paperSize: 200 };
wbCode.worksheets[0].getCell('A1').value = 'x';
const tplCode = path.join(outDir, 'tpl-err-paper200.xlsx');
await wbCode.xlsx.writeFile(tplCode);

// 超单元格上限模板（150×150 = 22500 > 20000，触发加载前预检）
const wbBig = new ExcelJS.Workbook();
const wsBig = wbBig.addWorksheet('Big');
for (let r = 1; r <= 150; r++) {
  for (let c = 1; c <= 150; c++) {
    wsBig.getCell(r, c).value = 'x';
  }
}
const tplBig = path.join(outDir, 'tpl-err-big.xlsx');
await wbBig.xlsx.writeFile(tplBig);

try {
  console.log('[error-code-guard] 稳定错误码 + 双语报错契约');

  // ============ 1. 模板类 ============
  await expectCode('缺少 template',
    () => excel2html({ data: {} }),
    'E_TEMPLATE_MISSING', '缺少 template', 'Missing template');

  await expectCode('本地模板不存在',
    () => excel2html({ template: path.join(outDir, 'no-such-file.xlsx') }),
    'E_TEMPLATE_LOAD', '模板读取失败', 'Failed to read the template');

  await expectCode('损坏的模板内容',
    () => excel2html({ template: Buffer.from('this is not a xlsx file') }),
    'E_TEMPLATE_LOAD', '模板解析失败', 'Failed to parse the template');

  // ============ 2. 数据 / option 类 ============
  await expectCode('data 非对象',
    () => excel2html({ template: tpl, data: 'str' }),
    'E_DATA_TYPE', 'data 只接受对象', 'data must be an object');

  const proErr1 = await expectCode('data 数组（Pro 引导）',
    () => excel2html({ template: tpl, data: [{ name: 'a' }] }),
    'E_OPTION_PRO', '商业版 Pro 能力', 'Pro capability');
  assert.match(proErr1.message, /Pro/, 'Pro 引导保留');
  assert.match(proErr1.message, /business@krstation\.com/, '咨询邮箱保留');

  const proErr2 = await expectCode('option.fitToPage（Pro 引导）',
    () => excel2html({ template: tpl, option: { fitToPage: true } }),
    'E_OPTION_PRO', '商业版 Pro 能力', 'Pro capability');
  assert.match(proErr2.message, /business@krstation\.com/, '咨询邮箱保留');

  await expectCode('对象型 pageSize（Pro 引导）',
    () => excel2html({ template: tpl, option: { pageSize: { width: 80, height: 100 } } }),
    'E_OPTION_PRO', '自定义纸张', 'custom paper');

  await expectCode('未知 option 键',
    () => excel2html({ template: tpl, option: { foo: 1 } }),
    'E_OPTION_UNKNOWN', '不支持的 option.foo', 'Unsupported option.foo');

  // ============ 3. 标记语法类 ============
  await expectCode('markerRegex 无 g 标志',
    () => excel2html({ template: tpl, option: { markerRegex: /\$\{([^}]+)\}/ } }),
    'E_MARKER_REGEX', '必须带 g 标志', 'g flag');

  await expectCode('markerRegex 无捕获组',
    () => helpers.validateMarkerRegex(/\$\{[^}]+\}/g),
    'E_MARKER_REGEX', '捕获组', 'capture group');

  await expectCode('markerSeparator 空串',
    () => excel2html({ template: tpl, option: { markerSeparator: '' } }),
    'E_MARKER_SEPARATOR', '非空字符串', 'non-empty string');

  const proErr3 = await expectCode('watermark 标记（Pro 引导）',
    () => excel2html({ template: tplWm }),
    'E_MARKER_PRO', '商业版 Pro 能力', 'Pro capability');
  assert.match(proErr3.message, /business@krstation\.com/, '咨询邮箱保留');

  // ============ 4. 规模护栏类 ============
  await expectCode('模板体积超限',
    () => excel2html({ template: Buffer.alloc(6 * 1024 * 1024) }),
    'E_SIZE_CAP', '模板文件过大', 'Template file too large');

  await expectCode('单元格数超限（预检）',
    () => excel2html({ template: tplBig }),
    'E_CELL_CAP', '单元格数超过上限', 'cell cap');

  // ============ 5. 纸张类 ============
  await expectCode('不支持的具名纸张',
    () => excel2html({ template: tpl, option: { pageSize: 'A2' } }),
    'E_PAPER_UNSUPPORTED', '不支持的纸张', 'Unsupported paper size');

  await expectCode('模板自定义纸张（代码 256）',
    () => excel2html({ template: tplCustom }),
    'E_PAPER_CUSTOM', '自定义纸张', 'custom paper');

  await expectCode('模板不支持纸张代码（200）',
    () => excel2html({ template: tplCode }),
    'E_PAPER_CODE', '不在支持列表内', 'not in the supported list');

  // ============ 6. 下载类（本机拒绝连接，无需外网） ============
  await expectCode('远程模板网络错误',
    () => excel2html({ template: 'http://127.0.0.1:1/tpl.xlsx' }),
    'E_DOWNLOAD_NETWORK', '下载失败', 'Failed to download');

  // ============ 7. 插件 / 条码类 ============
  await expectCode('插件非对象',
    () => use(null),
    'E_PLUGIN_INVALID', '插件必须是对象', 'plugin must be an object');

  await expectCode('markerTypes 项非函数',
    () => use({ markerTypes: { bad: 'not-a-function' } }),
    'E_PLUGIN_INVALID', '必须是函数', 'must be a function');

  await expectCode('generateCode 不支持的类型',
    () => helpers.generateCode('ean13', '123'),
    'E_CODE_TYPE', '不支持的条码类型', 'Unsupported code type');

  // ============ 7b. 插件运行期类（1.5.0：E_PLUGIN_RUNTIME） ============
  await expectCode('fieldResolver 运行抛错',
    () => excel2html({
      template: tpl,
      option: { plugins: [{ fieldResolvers: [() => { throw new Error('resolver boom'); }] }] },
    }),
    'E_PLUGIN_RUNTIME', '字段解析器运行失败', 'Field resolver failed');

  await expectCode('transformModel 运行抛错',
    () => excel2html({
      template: tpl,
      option: { plugins: [{ transformModel: () => { throw new Error('hook boom'); } }] },
    }),
    'E_PLUGIN_RUNTIME', '模型后处理钩子运行失败', 'Model post-processing hook failed');

  // 插件自行抛带码错误：原样重抛不二次包装
  await expectCode('插件抛带码错误原样重抛',
    () => excel2html({
      template: tpl,
      option: { plugins: [{ fieldResolvers: [() => { throw new Xlsx2pdfError('E_DATA_TYPE', '自定义带码错误 custom coded'); }] }] },
    }),
    'E_DATA_TYPE', '自定义带码错误', 'custom coded');

  // ============ 7c. 取消类（1.5.0：E_CANCELLED / signal 校验） ============
  await expectCode('signal 非 AbortSignal',
    () => excel2html({ template: tpl, option: { signal: 'not-a-signal' } }),
    'E_OPTION_INVALID', 'option.signal 只接受 AbortSignal', 'option.signal accepts an AbortSignal only');

  const preAborted = new AbortController();
  preAborted.abort();
  await expectCode('预 abort 快速失败（excel2html）',
    () => excel2html({ template: tpl, option: { signal: preAborted.signal } }),
    'E_CANCELLED', '生成已取消', 'Generation cancelled');

  const preAborted2 = new AbortController();
  preAborted2.abort();
  await expectCode('预 abort 快速失败（excel2pdf）',
    () => excel2pdf({ template: tpl, option: { signal: preAborted2.signal } }),
    'E_CANCELLED', '生成已取消', 'Generation cancelled');

  // ============ 8. 浏览器路径类 ============
  await expectCode('外部浏览器路径不存在',
    async () => {
      configure({ browserPath: path.join(outDir, 'no-such-chrome.exe') });
      try {
        await excel2pdf({ template: tpl, data: { name: 'a' } });
      } finally {
        configure({ browserPath: '' }); // 复位，避免影响后续用例
      }
    },
    'E_BROWSER_PATH', '浏览器可执行文件不存在', 'browser executable does not exist');

  // 内置浏览器缺失引导（仅在确实无浏览器可用时断言，有浏览器环境跳过）
  const builtin = await builtinExecutablePath();
  if (!fs.existsSync(builtin) && !process.env.XLSX2PDF_BROWSER_PATH) {
    await expectCode('内置 Chrome 缺失引导',
      () => excel2pdf({ template: tpl, data: { name: 'a' } }),
      'E_BROWSER_NOT_FOUND', '未找到内置 Chrome', 'Bundled Chrome not found');
  } else {
    console.log('  ⚠ 跳过 E_BROWSER_NOT_FOUND：当前环境已有可用浏览器');
  }

  console.log('[error-code-guard] 全部通过 ✅');
} catch (err) {
  console.error('[error-code-guard] 失败 ❌', err);
  process.exitCode = 1;
}