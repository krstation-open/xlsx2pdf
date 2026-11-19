#!/usr/bin/env node
/**
 * xlsx2pdf CLI（社区版）
 *
 * 用法：
 *   xlsx2pdf convert <template.xlsx> [--data JSON|@file.json] [--out out.pdf]
 *                    [--html] [--page-size A4] [--orientation portrait|landscape]
 *                    [--margin top,right,bottom,left]
 *   xlsx2pdf --help | --version
 *
 * 与 npm run example 共用 scripts/convert-lib.mjs 出片管线；
 * 零新增依赖（手写参数解析），错误经统一出口打印码 + 双语 + 文档锚点。
 */
import { runConvert, parseDataArg, printError } from '../scripts/convert-lib.mjs';
import { getVersion } from '../src/index.js';

const HELP = `xlsx2pdf — Excel 模板 → 高保真 PDF / Excel template → high-fidelity PDF

用法 / Usage:
  xlsx2pdf convert <template.xlsx> [options]

选项 / Options:
  --data <JSON|@file.json>   注入数据（JSON 字符串或 @ 前缀的 JSON 文件路径）
                             Data to inject (JSON string, or @path to a JSON file)
  --out <path>               输出路径（缺省与模板同目录同名 .pdf / .html）
                             Output path (default: alongside the template)
  --html                     仅渲染 HTML，不启动浏览器 / Render HTML only (no browser)
  --page-size <name>         纸张 A3/A4/A5/B4/B5/letter/legal / Paper size
  --orientation <o>          portrait / landscape
  --margin <t,r,b,l>         页边距 mm，四值逗号分隔 / Margins in mm (4 comma-separated values)
  --help, -h                 显示帮助 / Show this help
  --version, -v              显示版本 / Show version

示例 / Examples:
  xlsx2pdf convert tpl.xlsx --data '{"name":"Alice"}' --out out.pdf
  xlsx2pdf convert tpl.xlsx --data @data.json
  xlsx2pdf convert tpl.xlsx --html --out preview.html

错误码对照 / Error codes: docs/errors.md`;

/** 极简参数解析：--key value / --key=value / 布尔旗标；位置参数收集为数组 */
function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--version' || arg === '-v') flags.version = true;
    else if (arg === '--html') flags.html = true;
    else if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (value === undefined) throw new Error(`选项 --${key} 缺少值 / option --${key} requires a value`);
      flags[key] = value;
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

/** --margin t,r,b,l → { top, right, bottom, left }（mm） */
function parseMargin(raw) {
  const parts = String(raw).split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error(`--margin 需为四个非负数字（top,right,bottom,left），收到: ${raw} / --margin expects four non-negative numbers (top,right,bottom,left), received: ${raw}`);
  }
  return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));

  if (flags.version) {
    console.log(getVersion());
    return 0;
  }
  if (flags.help || positional.length === 0) {
    console.log(HELP);
    return 0;
  }

  const [command, template] = positional;
  if (command !== 'convert') {
    console.error(`[xlsx2pdf] 未知命令: ${command}（当前仅支持 convert）/ Unknown command: ${command} (only "convert" is supported)`);
    console.error('[xlsx2pdf] 运行 xlsx2pdf --help 查看用法 / Run xlsx2pdf --help for usage');
    return 1;
  }
  if (!template) {
    console.error('[xlsx2pdf] 缺少模板路径 / Missing template path');
    console.error('[xlsx2pdf] 用法 / Usage: xlsx2pdf convert <template.xlsx> [--data JSON] [--out out.pdf]');
    return 1;
  }

  const option = {};
  if (flags['page-size'] !== undefined) option.pageSize = flags['page-size'];
  if (flags.orientation !== undefined) option.orientation = flags.orientation;
  if (flags.margin !== undefined) option.margin = parseMargin(flags.margin);

  const data = parseDataArg(flags.data);
  await runConvert({ template, data, out: flags.out, htmlOnly: !!flags.html, option });
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => process.exit(printError(err)));