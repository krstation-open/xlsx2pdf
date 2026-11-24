# xlsx2pdf

[English](./README.md) | [简体中文](./README.zh-CN.md)

在 Excel 里把单据排版好，填上 `${...}` 标记，后端注入数据就能出 PDF。

一个 Node.js 服务端库，走「Excel 模板 → 标记替换 → HTML → Headless Chrome 打印」这条链路。不依赖 Office / LibreOffice，也不用自己写 HTML。Apache-2.0，可商用。

[![npm](https://img.shields.io/npm/v/xlsx2pdf)](https://www.npmjs.com/package/xlsx2pdf)
[![downloads](https://img.shields.io/npm/dw/xlsx2pdf)](https://www.npmjs.com/package/xlsx2pdf)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![CI](https://github.com/krstation-open/xlsx2pdf/actions/workflows/ci.yml/badge.svg)](https://github.com/krstation-open/xlsx2pdf/actions/workflows/ci.yml)
![node](https://img.shields.io/badge/node-%3E%3D18.17-green)

**官网 / Official website**: [https://www.krstation.com/](https://www.krstation.com/)

<a id="toc"></a>

## 目录

- [快速开始](#quick-start)
- [它适合做什么](#what-for)
- [为什么用 xlsx2pdf](#why)
- [特性（社区版）](#features)
- [详细用法](#usage)
- [标记语法](#markers)
- [社区版 vs Pro 版](#compare)
- [功能清单与实现状态](#status)
- [部署](#deploy)
- [扩展与二次开发](#extend)
- [API](#api)
- [已知限制与 FAQ](#faq)
- [维护与版本](#maintenance)
- [反馈与商业版](#feedback)
- [贡献](#contributing)
- [License](#license)

---

<a id="quick-start"></a>

## 快速开始

> 首次 `npm i` 会触发 postinstall 下载内置 Chrome（约 150MB，国内走 npmmirror 镜像），网络慢时可能要等一会儿，不是卡死。服务器已有 Chrome/Chromium 的话，可配 `browserPath` 跳过下载（见[部署](#deploy)）。

```bash
npm i xlsx2pdf
```

在 `tpl.xlsx` 的某个单元格里写上 `${name}`，然后：

```javascript
import { excel2pdf } from 'xlsx2pdf';
import { writeFileSync } from 'node:fs';

const { pdf } = await excel2pdf({
  template: './tpl.xlsx',
  data: { name: 'Alice' },
});

// pdf 是 Buffer，可直接写入文件或作为 HTTP 响应返回
writeFileSync('out.pdf', pdf);
```

合并单元格、字体、背景、边框、数字格式、页面设置，全部保留。

不想写代码？包里自带 CLI：

```bash
npx xlsx2pdf convert tpl.xlsx --data '{"name":"Alice"}' --out out.pdf
# 仅渲染 HTML 预览（不启动浏览器）：加 --html
```

另有可直接运行的一键示例 `examples/basic.mjs`——源码仓库里执行 `npm run example`，现场生成演示模板并出片 `examples/output/demo.pdf`。

↑ [返回目录](#toc)

---

<a id="what-for"></a>

## 它适合做什么

简单说就是「固定模板 + 批量出单」：发票、票据、证书、标签、对账单、报告、固定格式报表这类。业务人员在 Excel 里把版式排好，后端拿 JSON 数据填进去，出来就是 PDF。中间会先渲染成一份和 Excel 所见基本一致的 HTML，需要预览或二次处理的话，可以用 `excel2html()` 单独拿这份 HTML。

几件事它不做：

- 不是通用转换器。模板里得有占位标记，不能拿任意一个 xlsx 直接转。
- 不是报表设计器。版式在 Excel 里画，不在浏览器里拖拽。
- 不是 PDF 编辑器。只管生成，不做合并、加水印这类后处理。

只想把任意 xlsx 原样转成 PDF 的话，用 LibreOffice 或专门的转换工具更合适。

↑ [返回目录](#toc)

---

<a id="why"></a>

## 为什么用 xlsx2pdf

几个我们看重的点：模板就是普通 Excel，业务人员不用学新工具；装的时候不编译 native 模块、不拖 Office；渲染走 Chrome，Win / Linux / macOS 出片一致；合并格、富文本、numFmt 这些容易翻车的细节都处理并测过了；标记类型、字段解析、模型钩子三层都能扩展。

也得说清楚社区版的限度：列宽按工作簿默认字体以 Excel 官方公式换算（内置宋体、微软雅黑等常见字体启发式表，中文模板不再整体偏窄；1.6.0 起中文模板列宽与旧版有变化，从 1.5.x 升级且做像素级视觉回归的用户建议重跑基线），对排版精度要求极高的场景，Pro 提供浏览器逐列实测校正；对动态长度的业务内容，Pro 提供单页自适应排版（字号/行高调整，带下限约束，见[社区版 vs Pro 版](#compare)）。它就是个 Node.js 库，别的语言想用，可以起个 Node 服务走 HTTP 调，或挂个 Node 侧车。

↑ [返回目录](#toc)

---

<a id="features"></a>

## 特性（社区版）

- **Excel 原生模板**：模板就是普通 `.xlsx`，业务人员用 Excel / WPS / LibreOffice 都能编辑
- **标记替换**：`${field}` 基础占位符、嵌套对象 `${a.b.c}`、默认值 `${field|text_default:无}`
- **单元格内混排**：一个单元格可混排多个标记与静态文本，各片段独立替换并继承局部富文本格式
- **样式保真**：合并单元格、字体 / 颜色 / 背景 / 边框、单元格内富文本
- **数字格式继承**：自动继承 Excel 的百分比、货币、千分位、日期格式（如 `¥#,##0.00` → `¥1,234.50`）
- **页面设置模板自治**：标准纸张 A3/A4/A5/B4/B5/letter/legal、方向、边距由模板决定，业务改纸张不用改代码
- **精确缩放（1.7.0 起）**：`option.scale` 1~400%（与 Excel 打印缩放上限对齐），100 与 `'auto'` 同义；模板自带的缩放设置本就生效
- **富媒体标记（1.1.0 起内置）**：`${photo|image}`、`${code|barcode}`（Code128）、`${qr|qrcode}`；支持本地路径 / http(s) URL / base64 DataUrl；浮层参数 `w/h/ox/oy/zindex/opacity`；未设宽高按原图尺寸自动归一
- **文本水印标记（1.7.0 起内置）**：`${stamp|watermark}`（`print` 为历史别名），叠章 / 作废场景；层级 / 透明度与图片同一套浮层参数，字号继承单元格（水印随版面自动收敛在 Pro 提供）
- **明细行索引映射**：`${#items.name}` 同一标记按行重复，引擎逐次取数组下标（`items.0`、`items.1`…）；行数由模板固定，支持嵌套字段与 numFmt 继承
- **空行占位识别（1.7.0 起）**：`emptyRowPlaceholders` 把 `--` 等占位符行识别为空行，行高保真（自适应收缩联动在 Pro 提供）
- **内置 Headless Chrome**：无需外部 Office 引擎，渲染一致性可控
- **浏览器生命周期（1.7.0 起）**：空闲 60s 自动回收（默认开启、可关），渲染计数回收 / 墙钟年龄轮换可参数化（默认关），见[部署](#deploy)
- **轻量预览**：`excel2html()` 仅输出 HTML、不启动浏览器，适合预览或二次处理
- **渲染事件钩子（1.7.0 起）**：`configure({ onEvent })` 桥接阶段耗时计量，自行接 pino 等日志库，库零新增依赖
- **可扩展**：标记类型、字段解析器、模型钩子三个扩展点，支持自定义 `markerRegex` / `markerSeparator`，类型别名可配置（`markerAliases`）
- **工程化**：ESM / CJS 双模式 + TypeScript 声明，模板体积 / 单元格数安全上限（1.7.0 起可参数化，放宽风险见[部署](#deploy)），稳定错误码 + 双语报错，CLI（`xlsx2pdf convert`）

↑ [返回目录](#toc)

---

<a id="usage"></a>

## 详细用法

### 1. 设计模板

在 Excel 中按业务版式排版，在需要动态数据的位置填写标记：

| 单元格 | 内容                         |
| :----- | :--------------------------- |
| A1     | 姓名                         |
| B1     | `${name}`                    |
| A2     | 金额                         |
| B2     | `${amount}`                  |
| A3     | 备注                         |
| B3     | `${remark\|text_default:无}` |

> 表格里的 `\|` 只是 Markdown 表格分隔符的转义。Excel 单元格里实际写 `${remark|text_default:无}`，不带反斜杠。下文标记语法表同理。

### 2. 调用

```javascript
import { excel2pdf } from 'xlsx2pdf';

const { pdf } = await excel2pdf({
  template: './tpl.xlsx',
  data: { name: '张三', amount: 1234.5, remark: '加急' },
});
```

金额单元格若设置了 `¥#,##0.00` 格式，产物自动显示 `¥1,234.50`——数字格式无需任何标记参数。

### 3. 输出

`pdf` 是 Buffer，可写入文件、作为 HTTP 响应返回、或上传对象存储：

```javascript
import { writeFileSync } from 'node:fs';

// 写入文件
writeFileSync('out.pdf', pdf);

// Express 响应
res.setHeader('Content-Type', 'application/pdf');
res.send(pdf);
```

### 4. 错误处理

所有失败统一抛 `Xlsx2pdfError`，带稳定错误码 `code`（如 `E_TEMPLATE_MISSING`、`E_DOWNLOAD_TIMEOUT`、`E_BROWSER_NOT_FOUND`）与双语文案（中文在前、英文追加）。全部错误码对照表（逐码原因与修复建议）见 [docs/errors.md](./docs/errors.md)。

```javascript
import { excel2pdf, Xlsx2pdfError } from 'xlsx2pdf';

try {
  await excel2pdf({ template: './tpl.xlsx', data });
} catch (err) {
  if (err instanceof Xlsx2pdfError) {
    console.error(err.code); // 跨版本稳定——按码分支，不要匹配文案
  }
  throw err;
}
```

CLI 失败时打印错误码 + 双语文案 + 文档锚点，并以非零码退出。

↑ [返回目录](#toc)

---

<a id="markers"></a>

## 标记语法

标记格式 `${字段|类型_参数1_参数2…}`。`|` 及其后可省略，省略时按文本（`text`）处理。字段支持 `a.b`、`a.0.b` 点路径取嵌套对象 / 数组值；多个参数以 `_` 连接。

### 内置类型

| 类型      | 说明                                                                                                                          | 示例                         |
| :-------- | :---------------------------------------------------------------------------------------------------------------------------- | :--------------------------- |
| `text`    | 文本替换（默认类型，可省略）                                                                                                  | `${name}` 或 `${name\|text}` |
| `image`   | 图片嵌入，`img` 为别名；值为本地路径 / http(s) URL / base64 DataUrl；宽高未设时按原图尺寸归一，只设一边时另一边按原图宽高比例 | `${photo\|image_w120_h40}`   |
| `barcode` | 条形码（Code128）；值为要编码的文本                                                                                           | `${code\|barcode_w200_h60}`  |
| `qrcode`  | 二维码（QR Code）；值为要编码的文本                                                                                           | `${qr\|qrcode_w80_h80}`      |
| `watermark` | 文本水印浮层，`print` 为历史别名；宽度沿用单元格、字号继承单元格，层级 / 透明度与图片同一套                                 | `${stamp\|watermark_zindex1_opacity0.3}` |

`watermark` 自 1.7.0 起内置，按单元格字号渲染、浮层参数生效；水印随版面自动收敛（缩字号 / 换行）在 Pro 提供。自定义 handler 也可返回水印浮层，见[扩展](#extend)。

图片内容按魔数与结构校验（base64 / 远程 / 本地三入口同一套，不盲信 content-type / 扩展名）：损坏或非图片内容降级为空值并记入返回结果 `warnings`，不因单图损坏整单失败，见[降级告警](#warnings)。

### 参数键

图片 / 条码 / 二维码共用下列参数键（`_` 连接，如 `image_w120_h40_ox5`）；`watermark` 共用其中的 `zindex` / `opacity`（宽度沿用单元格，`w/h/ox/oy` 不适用）：

| 键        | 示例         | 说明                                                                                                                        |
| :-------- | :----------- | :-------------------------------------------------------------------------------------------------------------------------- |
| `w`       | `w120`       | 宽度 px。image/img 缺省时按原图尺寸（96 DPI）归一，与 `h` 只配其一时另一边按原图宽高比例；barcode/qrcode 为生成图，缺省 100 |
| `h`       | `h40`        | 高度 px。缺省适配规则同 `w`；barcode/qrcode 缺省 20                                                                         |
| `ox`      | `ox5`        | 水平偏移 px（默认 0）                                                                                                       |
| `oy`      | `oy3`        | 垂直偏移 px（可负，默认 0）                                                                                                 |
| `zindex`  | `zindex2`    | 层级：0 跟模板同层、负数在模板下方、正数在上方，可堆叠；设为非 0 后按纯浮层处理——不撑高所在行，越界部分照常显示             |
| `opacity` | `opacity0.5` | 不透明度 0~1（与 CSS `opacity` 一致，0.5 = 半透明）；值 >1 时按百分数兼容旧写法（`opacity50` → 0.5），越界按边界收敛        |

> 社区版尺寸归一为纯 JS 探测（image-size，不压缩）；图片自动压缩与 DPI 感知物理尺寸换算在 Pro 版提供。`minsize`（字号收缩下限）依赖 Pro 的单页自适应排版与水印自适应，社区版不生效；`lineheight` 仅作用于水印浮层的行间距（社区版生效）；水印字号与换行随版面自动收敛在 Pro 提供。

<a id="markeraliases"></a>

### 类型别名（markerAliases）

内置默认别名：`img` → `image`、`print` → `watermark`（历史兼容）。别名在解析期归一为规范类型，行为与直接写规范名完全一致。别名映射可自定义（1.7.0 起）：

```javascript
// 调用级（仅本次生成生效，优先于全局）：模板写 ${stamp|seal}
await excel2pdf({ template, data, option: { markerAliases: { seal: 'watermark' } } });

configure({ markerAliases: { seal: 'watermark' } }); // 全局默认
configure({ markerAliases: null }); // 恢复内置 img/print
configure({ markerAliases: {} }); // 清空全部别名
```

语义是**整体替换**而非合并：传 `{ seal: 'watermark' }` 后 img/print 不再生效。别名被禁用后，模板仍写该 token 且未注册同名专属类型时，显式抛 `E_MARKER_ALIAS`（不静默降级为文本）；其余未知类型名仍按文本兜底。二开插件注册与别名同名的类型（如 `use({ markerTypes: { print: ... } })`）即接管该别名槽，静默无告警。别名目标须为已知规范类型（内置或已注册），不允许 alias→alias 链。

### 默认值

标记末尾追加 `_default:xxx`（同义别名 `_默认:xxx` / `_dft:xxx`），字段缺值时生效；默认值须放在参数串最后：

```
${remark|text_default:无}
${photo|image_w120_h40_默认:./placeholder.png}
```

另有全局默认值 `option.defaults`（见 [API](#api)），优先级低于标记内默认值。取值顺序：**data → 标记内默认值 → `option.defaults`**。

### 数字格式自动继承（numFmt）

标记所在单元格若设置了非 General 的数字格式，注入的数值 / 日期会按该格式渲染；**无标记的静态数值 / 日期格同样按格式渲染**——均与在 Excel 中直接填值所见一致，无需任何标记参数：

| 模板单元格格式   | 注入值             | 渲染结果                              |
| :--------------- | :----------------- | :------------------------------------ |
| `0.00%`          | `0.1234`           | `12.34%`                              |
| `¥#,##0.00`      | `1234567.8`        | `¥1,234,567.80`                       |
| `#,##0.00`       | `1234567.8`        | `1,234,567.80`                        |
| `yyyy-mm-dd`     | `45000` 或 JS Date | `2023-03-15`                          |
| `yyyy/mm/dd;@`   | `45000`            | `2023/03/15`（`;@` 文本分节自动忽略） |
| General / 无格式 | 任意               | 原样输出                              |

生效规则：

- 仅 number / JS Date / 可解析数字字符串会被格式化；姓名等非数值文本原样输出，不会被误格式化。
- 支持常用子集：百分比、货币符号、千分位、小数位控制、正负零分节、日期时间 token（含 12 小时制与 `[h]` 历时）；冷门格式（分数、科学计数、条件节）兜底原样输出，绝不抛错。
- 多分节格式（`正;负;零;文本`）按值符号选节；中文 Excel/WPS 日期格式常见的 `;@` 文本分节不会泄漏到输出。
- 图片类标记不受影响；自定义标记类型的 handler 可通过 `ctx.numFmt` 读取单元格格式、用 `helpers.formatValue(value, fmt)` 复用同一格式化实现。

### 嵌套与明细行数据

字段取值会把嵌套对象 / 数组拍平为点路径，任意层级均可直接引用：

```javascript
const data = {
  report: {
    title: '检测报告',
    lab: { name: '某某检测有限公司', contact: { phone: '0755-00000000' } }, // 4 层嵌套
  },
  items: [{ spec: '直径22' }, { spec: '直径25' }], // 数组套对象
};
```

| 模板标记                      | 取值结果        | 说明                 |
| :---------------------------- | :-------------- | :------------------- |
| `${report.title}`             | 检测报告        | 2 层嵌套             |
| `${report.lab.contact.phone}` | 0755-00000000   | 4 层嵌套             |
| `${items.0.spec}`             | 直径22          | 数组下标从 0 起      |
| `${#items.spec}`              | 直径22 → 直径25 | 明细行索引映射，见下 |

`#数组.字段` 用于明细行：模板中逐行重复同一标记（每条明细一行），每出现一次自动取数组下一项（下标从 0 递增）。点路径与参数 / 默认值可任意组合，如 `${#items.spec|text_default:--}`。

### 自定义标记语法（markerRegex / markerSeparator）

默认识别 `${...}`，可用自定义正则替换（标记内部 `字段|类型_参数` 结构不变）：

```javascript
// 调用级（仅本次生成生效，优先于全局）：模板写 {{name|text_default:--}}
await excel2pdf({ template, data, option: { markerRegex: /\{\{([^}]+)\}\}/g } });

// 全局默认
configure({ markerRegex: /\{\{([^}]+)\}\}/g });
configure({ markerRegex: null }); // 恢复内置 ${...} 语法
```

正则契约：必须带 `g` 标志；**捕获组 1 = 标记内部内容**（`字段|类型_参数`），`match[0]` = 完整标记原文（用于替换）。不合法时直接抛错，不会静默不替换。自定义语法下内置 `${...}` 不再识别、原文保留，两种语法不并存。

内部分隔符也可自定义（`markerSeparator`，默认竖杠 `|`）：

```javascript
// 调用级：模板写 {{name::text_default:--}}
await excel2pdf({
  template,
  data,
  option: { markerRegex: /\{\{([^}]+)\}\}/g, markerSeparator: '::' },
});

configure({ markerSeparator: '::' }); // 全局默认
configure({ markerSeparator: null }); // 恢复内置竖杠
```

分隔符仅取首次出现处切分，之后的类型 / 参数 / 默认值解析规则不变。优先级：调用级 option > configure 全局 > 内置默认。

### 数据结构边界

社区版支持**单记录**数据注入，并内置 **#数组.字段 明细行索引映射**：

```javascript
// ✅ 单记录 + 嵌套对象
data: { name: 'Alice', customer: { city: '上海' } }

// ✅ 明细行：模板按行重复 ${#items.name}，引擎逐行取 items.0 / items.1 / items.2…
data: { items: [{ name: '甲' }, { name: '乙' }] }

// ❌ 不支持「一行标记自动展开 N 行」的动态循环（行数由模板固定，需预留足够重复行）
// ❌ 不支持 data 传数组的多页批量（Pro 能力）
```

明细行行数由模板固定：数据少于模板行时多余行自动清除，空数组时标记清除。如需一份模板批量出多页（`data` 传数组），请使用 Pro 版数组批量。`data` 缺省时渲染一页空模板（标记按默认值 / 空值清除）。

↑ [返回目录](#toc)

---

<a id="compare"></a>

## 社区版 vs Pro 版

社区版能独立把单份文本 / 富媒体报表从头到尾做完，不是砍了功能的试用版。Pro 主要解决批量、高并发、以及对排版精度特别敏感的生产场景。两者用的是同一套渲染管线。

| 能力                                                  |               社区版               |            Pro 版             |
| :---------------------------------------------------- | :--------------------------------: | :---------------------------: |
| 单文档文本 / 富媒体报表                               |                 ✅                 |              ✅               |
| 图片 / 二维码 / 条形码基础嵌入                        |                 ✅                 |              ✅               |
| 图片自动压缩 + DPI 感知尺寸                           |                 ❌                 |              ✅               |
| autoInsertImage（自动插图）                            |                 ❌                 |              ✅               |
| 文本水印标记（watermark/print）                       |  ✅ 基础形态（字号继承单元格）  |   ✅ 含随版面自动收敛   |
| 明细行索引映射（#数组.字段）                          |                 ✅                 |              ✅               |
| 数组多页批量（data 数组 → N 页）                      |                 ❌                 |              ✅               |
| 多页分批出片（`batchSize`，批间并发限流）              |                 ❌                 |              ✅               |
| 单页自适应排版（字号/行高调整，带下限约束与溢出告警） |                 ❌                 |              ✅               |
| 精确缩放（scale 1~400%）                              |                 ✅                 |              ✅               |
| 空行占位识别（emptyRowPlaceholders）                  |     ✅（自适应收缩联动 Pro）     |              ✅               |
| 列宽精度                                              | 官方公式 + 常见字体启发式（1.6.0） | 浏览器实测像素级 + 缺字体守卫 |
| 自定义纸张（小票卷纸）直读                            |                 ❌                 |              ✅               |
| 横向页 WPS / Clodop（浏览器打印控件）打印适配         |                 ❌                 |              ✅               |
| 并发渲染 / 内存准入守卫                               | 并发与规模上限可配（无内存守卫） | 参数化护栏 + 内存准入 + 守护自治 |
| 浏览器生命周期（空闲回收/计数回收/年龄轮换）        |  ✅ 可配（idle 默认 60s）  |   ✅ 零配置生产默认   |
| 渲染事件钩子（onEvent）                               |                 ✅                 | ✅（observe sink + 请求时间线） |
| 自定义扩展（三扩展点 + 自定义语法）                   |                 ✅                 |              ✅               |
| 许可                                                  |        Apache-2.0，免费商用        |           商业 EULA           |

表里的 ✅ 只说明「有没有」，Pro 这几项能力在生产里解决什么，值得逐个说清楚。

**必须一页——单页自适应排版。** 动态业务数据经常超出模板预留的空间：文本溢出、行高不够、页面打不完整。社区版内容超页时走 Chrome 原生分页，可能截断或跨页；Pro 的自适应排版基于浏览器实际渲染结果，在保留模板视觉结构的前提下调整字号与行高，尽可能把内容完整收敛到一页。字号调整受全局下限与单元格级下限（`minsize`）约束；行高按内容实际占用调整；含图片、条码、二维码、水印的行受保护、不参与压缩。设计目标不是像素级复刻 Excel 的字号行高，而是生成完整、清晰、适合打印的单页 PDF。边界也说清楚：字号与行高都有下限，极端内容仍装不下时，剩余溢出会被裁剪并输出告警——自适应排版是在约束允许范围内尽可能适配单页，不是无条件保证单页完整。快递单、固定发票、检验报告这类「必须一页」的场景尤其关键。

**排版精度——像素级列宽 + 缺字体守卫。** 社区版列宽是官方公式 + 常见字体启发式的近似，多数报表够用；但近似误差会累积，密集表格、金额列、盖章签字位这类对列位敏感的场景尤其明显。Pro 按浏览器实际渲染逐列校正，列宽对齐 Excel 打印结果；字体缺失时显式告警，而不是静默替换导致整版走样。

**批量生产——数组批量 + 分批出片。** 社区版一次调用出一页，检测站一天几百份报告得自己写循环、管并发。Pro 的 `data` 传数组，一份模板 + N 条记录一次调用出 N 页 PDF；页数超过 `batchSize` 自动分批，内存峰值有界，批间并发受护栏约束。

**长期服务——内存准入 + 守护自治。** 社区版并发与生命周期参数可配，但「调到多少安全」要自己摸索。Pro 在渲染前按页数估算准入，超限请求在启动前就被拒绝；浏览器守护在安全点自动回收重建，重复大批量不会把宿主内存打穿。生产默认值已调好，零配置。

**特殊介质与打印链路。** 小票卷纸自定义纸张直读；横向页适配 WPS / Clodop 打印控件；图片自动压缩 + DPI 感知物理尺寸（高分辨率照片不再撑爆 PDF 体积）；autoInsertImage 自动插图；水印字号与换行随版面自动收敛。

**Pro 咨询 / 免费 POC**：提供你的 3 个真实模板，48 小时内返回 Pro 生成效果与基准对比报告。📧 business@krstation.com

↑ [返回目录](#toc)

---

<a id="status"></a>

## 功能清单与实现状态

把功能列全在这里，复选框体现实现状态：☑ 已实现（标引入版本），☐ 未实现（不标版本，以实际发布为准）。Pro 专属的只列效果名，见本节末尾；逐版细节见 [CHANGELOG.md](./CHANGELOG.md)。

| 功能                                                        | 实现状态 | 引入版本 | 备注                                                                |
| :---------------------------------------------------------- | :------: | :------- | :------------------------------------------------------------------ |
| `excel2pdf` / `excel2html` 双出口                           |    ☑     | 1.0.0    | PDF 一站式生成 / 仅渲染 HTML、不启动浏览器                          |
| 标记替换：基础字段 / 嵌套点路径 / 标记默认值 / 同格多段混排 |    ☑     | 1.0.0    | 混排各段独立替换并继承局部富文本格式                                |
| 样式保真：合并格 / 字体 / 字色 / 背景 / 边框 / 单元格富文本 |    ☑     | 1.0.0    | 合并区域外侧边框取边缘单元格并集                                    |
| numFmt 数字格式自动继承                                     |    ☑     | 1.0.0    | 标记格与静态数字/日期格都按格式渲染                                 |
| 标准纸张 / 方向 / 边距（模板自治）                          |    ☑     | 1.0.0    | A3/A4/A5/B4/B5/letter/legal                                         |
| 内置 Headless Chrome / 外部浏览器复用                       |    ☑     | 1.0.0    | browserPath、XLSX2PDF_BROWSER_PATH、可跳过下载                      |
| 三层扩展点 + 两级注册                                       |    ☑     | 1.0.0    | markerTypes / fieldResolvers / transformModel；use / option.plugins |
| 自定义标记语法                                              |    ☑     | 1.0.0    | markerRegex / markerSeparator                                       |
| helpers 扩展工具命名空间                                    |    ☑     | 1.0.0    | 1.1.0 增至 7 件（补 generateCode / bufferToDataUrl）                |
| ESM / CJS 双产物 + TypeScript 声明                          |    ☑     | 1.0.0    |                                                                     |
| 模板体积 / 单元格数安全上限                                 |    ☑     | 1.0.0    | 默认 5MB / 20000 格（参数化见下行）                              |
| 规模守卫参数化（maxCells/maxTemplateSize）                  |    ☑     | 1.7.0    | 0/负数=关闭；放宽风险见部署节                                    |
| image / img 图片标记                                        |    ☑     | 1.1.0    | 本地路径 / http(s) URL / base64 DataUrl                             |
| barcode（Code128）/ qrcode 标记                             |    ☑     | 1.1.0    | bwip-js 生成 PNG                                                    |
| 浮层参数 w/h/ox/oy/zindex/opacity                           |    ☑     | 1.1.0    | 图片 / 条码 / 二维码共用                                            |
| 纯 JS 图片尺寸归一                                          |    ☑     | 1.1.0    | 未设宽高按原图 96 DPI 归一；不压缩                                  |
| 明细行索引映射 `#数组.字段`                                 |    ☑     | 1.2.0    | 行数由模板固定，非动态循环                                          |
| 示例目录 + `npm run example` 一键出片                       |    ☑     | 1.3.0    |                                                                     |
| CLI（`xlsx2pdf convert`）                                   |    ☑     | 1.3.0    |                                                                     |
| 稳定错误码 + 双语报错 + 错误对照文档                        |    ☑     | 1.3.0    |                                                                     |
| GitHub Actions CI + 状态徽章                                |    ☑     | 1.3.0    |                                                                     |
| 渲染并发参数化（`maxConcurrency`）                          |    ☑     | 1.4.0    | 默认 1，只接受正整数；无内存守卫，调大风险见部署节                  |
| 生成取消（`option.signal` / `E_CANCELLED`）                 |    ☑     | 1.5.0    | 排队摘除 + 渲染中断，协作式尽力终止                                 |
| 降级告警通道（`warnings`）+ 图片内容校验                    |    ☑     | 1.5.0    | 单图/单标记失败降级不抛错，告警可程序化消费                         |
| 文本水印标记（watermark，print 别名）                       |    ☑     | 1.7.0    | 浮层参数与图片同一套；自适应收敛属 Pro                            |
| 精确缩放（`option.scale`）                                  |    ☑     | 1.7.0    | 1~400%，100 与 auto 同义；非正数回落 auto                         |
| 空行占位识别（`emptyRowPlaceholders`）                      |    ☑     | 1.7.0    | 占位符行按空行处理，行高保真                                      |
| 浏览器空闲自动回收                                          |    ☑     | 1.7.0    | 默认 60s，可配关闭（browserIdleMs:0）                             |
| 浏览器计数回收 / 年龄轮换参数化                             |    ☑     | 1.7.0    | 默认关闭，生产调优知情开启                                        |
| 渲染事件钩子（阶段 / 耗时可观测）                           |    ☑     | 1.7.0    | onEvent 桥接 8 个阶段事件                                          |
| 标记类型别名可配置（markerAliases）                         |    ☑     | 1.7.0    | 内置 img/print；二开接管静默                                      |
| 多工作表选择（`option.sheet`）                              |    ☐     |          |                                                                     |
| 隐藏行 / 列过滤                                             |    ☐     |          |                                                                     |
| 读取模板已嵌入的图片                                        |    ☐     |          |                                                                     |
| 超链接 → PDF 可点击链接                                     |    ☐     |          |                                                                     |
| 文字旋转 / 缩进                                             |    ☐     |          |                                                                     |
| 条码多码制（EAN13 / Code39 等）+ 二维码纠错级别             |    ☐     |          |                                                                     |
| 打印区域 / 重复标题行                                       |    ☐     |          |                                                                     |
| 页眉页脚 / 页码                                             |    ☐     |          |                                                                     |
| 插件上下文与模型的 TS 类型导出                              |    ☐     |          |                                                                     |
| 模板静态校验 `validateTemplate`                             |    ☐     |          |                                                                     |
| 官方插件示例（日期格式 / 枚举映射 / i18n / 大写金额）       |    ☐     |          |                                                                     |
| 模板解析缓存                                                |    ☐     |          |                                                                     |
| URL 取材安全选项（白名单 / 超时 / 体积上限）                |    ☐     |          |                                                                     |
| 官方 Docker 镜像                                            |    ☐     |          |                                                                     |

### Pro 专属（社区版不提供）

- **转得准**：像素级列宽 + 缺字体守卫、单页自适应排版（下限约束、溢出告警）、水印随版面自动收敛
- **转得稳**：内存准入守卫与页数上限、守护自治生产默认
- **批量生产**：数组多页批量、多页分批出片（batchSize）
- **特殊介质与打印**：图片自动压缩 + DPI 感知尺寸、autoInsertImage、自定义纸张直读、横向页国产打印控件适配

效果对照见[社区版 vs Pro 版](#compare)。

↑ [返回目录](#toc)

---

<a id="deploy"></a>

## 部署

### 平台支持

内置 Chrome 按当前操作系统自动下载对应构建——Windows、macOS（Intel 与 Apple Silicon）、Linux 都支持，postinstall 自动判断平台，不用手动选版本。这份 Chrome 是独立下载到包内的，与你本机已装的 Chrome 互不影响，默认也不复用本机 Chrome；想改用本机已装的 Chrome/Chromium，配 `browserPath`（或环境变量 `XLSX2PDF_BROWSER_PATH`）并跳过下载即可（见下文「复用系统 Chromium」）。本地开发在 Windows / macOS 上 `npm i` 装完即用，不需要额外系统依赖（下面的系统库只有 Linux 服务器才涉及）。

下载走 npmmirror 镜像（各平台构建齐全），失败自动重试 5 次；构建落在包内 `node_modules/xlsx2pdf/browsers/`（基于包自身位置解析，与运行目录无关），Chrome 版本随 puppeteer-core 锁定。postinstall 下载失败不会中断 `npm i`，之后可用 `npx xlsx2pdf-browser install` 或代码里 `await ensureBrowser()` 补装。

### 系统依赖

内置 Headless Chrome（约 150MB），postinstall 自动下载。Linux 服务器需 Chrome 运行系统库：安装脚本会用 `ldd` 自动探测缺失库并 `apt-get` 安装（需 root 或免密 sudo），其中 `libasound2` / `libasound2t64` 按发行版自动选择；无权限时打印手动安装命令，不中断流程。常见依赖（下为 Debian 12 示例，Ubuntu 24.04 把 `libasound2` 换成 `libasound2t64`）：

```bash
apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libgbm1 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libpango-1.0-0 libpangocairo-1.0-0 libcairo2 libxshmfence1 libasound2
```

### Docker 示例

`libasound2` 在不同发行版包名不同（Debian 12 为 `libasound2`，Ubuntu 24.04 / Debian trixie 为 `libasound2t64`），下面做了 fallback，避免照抄在新镜像上装失败：

```dockerfile
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libgbm1 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libpango-1.0-0 libpangocairo-1.0-0 libcairo2 libxshmfence1 \
  && (apt-get install -y --no-install-recommends libasound2t64 \
      || apt-get install -y --no-install-recommends libasound2) \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

CMD ["node", "server.js"]
```

### 复用系统 Chromium

如不希望内置 Chrome 下载，可配置 `browserPath` 复用系统 Chromium：

```javascript
import { configure } from 'xlsx2pdf';

configure({ browserPath: '/usr/bin/chromium' });
```

浏览器解析优先级：`configure({ browserPath })` > 环境变量 `XLSX2PDF_BROWSER_PATH` > 包内 `browsers/` 内置 Chrome；都没有时报错并引导补装。路径基于包自身位置解析，与进程 cwd 无关。跳过后补装：`npx xlsx2pdf-browser install [--force]` 或代码内 `await ensureBrowser({ force: true })`（幂等，已存在秒级跳过）。

### 安全上限（默认值）

| 项       | 默认      | 说明                                                         |
| :------- | :-------- | :----------------------------------------------------------- |
| 模板体积 | 5MB       | 超限报错拒绝生成；1.7.0 起可配（`maxTemplateSize`，0/负数=关闭），默认不变 |
| 单元格数 | 20000     | 实际行×列，超限报错（加载前另有流式预检提前拦截）；1.7.0 起可配（`maxCells`，0/负数=关闭） |
| 渲染并发 | 1（可配） | 同时打开的标签页上限，超限排队；只接受正整数，风险见下方提醒 |

模板体积与单元格数自 1.7.0 起开放参数化：`maxCells` / `maxTemplateSize` 在调用级 option 与 configure 均接受（非数值抛 `E_OPTION_INVALID`，0/负数关闭守卫），默认 20000 格 / 5MB 不变，放宽风险见下方提醒。`memoryGuard` / `maxPages` 等其余护栏仍属 Pro（option 传入显式报错引导，configure 静默忽略，见 [API](#api)）。渲染并发自 1.4.0 起开放参数化（`maxConcurrency`，configure 与调用级 option 均可，默认 1 不变）。远程资源（模板 URL / 图片 URL）下载带 30 秒超时与 20MB 体积上限，失败统一抛带稳定错误码（`E_DOWNLOAD_*`）的双语报错并附 URL，见 [docs/errors.md](./docs/errors.md)。

> **⚠️ 调大渲染并发前必读**：社区版**没有内存准入守卫**，Chrome 内存随同时打开的标签页数**线性增长**（实测：基线约 400~500MB，每个标签页约 +100MB 起步，带图大模板更高）。在小内存容器（如 2C4G）调大 `maxConcurrency` 可能把宿主服务整体拖入 OOM——这不是库自身崩溃，而是同进程其他业务一起被杀。调大前请务必按「基线 + 并发数 × 单页峰值 + 宿主自身余量」核算内存；设为 >1 时库会打一次性运行期告警。多 worker 进程（如 egg cluster）每个 worker 各自持有一个浏览器单例，整机内存 ≈ worker 数 × 单 worker 占用。需要「调大并发但不炸」的内存准入守卫（渲染前探测可用内存，扣减在飞估算后仍满足按页数放大的估算 + 安全余量才放行；单例 Chrome 按渲染计数回收重建，打断重复大批量调用的内存棘轮）属 Pro 能力。

> **⚠️ 放宽规模上限前必读**：与调大并发同理，社区版**没有内存准入守卫**，超大模板的解析与渲染可能击穿进程内存。把 `maxCells` / `maxTemplateSize` 调到默认值以上（或关闭守卫）时，库会打一次性运行期告警；请按宿主服务实际内存余量核算后再放宽，这是知情选择而非推荐配置。生产环境需要守卫兜底（超限拒绝 + 内存准入）请用 Pro。

### 浏览器生命周期

浏览器单例的生命周期自 1.7.0 起可配（均仅 configure 级）：

| 键                      | 默认    | 说明                                                                 |
| :---------------------- | :------ | :------------------------------------------------------------------- |
| `browserIdleMs`         | `60000` | 空闲超阈且无在途渲染即关闭单例，下次调用重建；传 0 关闭空闲回收     |
| `browserRecycleRenders` | `0`     | 单例累计完成 N 次渲染后在安全点关闭重建（打断内存棘轮）；默认关闭    |
| `browserMaxAgeMs`       | `0`     | 单例墙钟年龄超阈在安全点轮换；默认关闭                                 |
| `protocolTimeoutMs`     | `60000` | CDP 调用（含打印）挂起上限，只接受 ≥1000 的整数毫秒                  |

空闲回收是 1.7.0 新增的善意默认：长驻服务闲置 60s 后浏览器自动关闭释放内存，下次调用重建，成本是一次冷启动（语义与手动 `closeBrowser()` 一致）。对首次调用延迟敏感、希望浏览器常驻的场景，`configure({ browserIdleMs: 0 })` 即可关闭。计数回收与年龄轮换默认关闭，适合重复大批量调用的生产服务知情开启（调优口径见上表）；回收 / 轮换都只在无在途渲染的安全点发生，不会打断进行中的生成。

↑ [返回目录](#toc)

---

<a id="extend"></a>

## 扩展与二次开发

> 1.0 起扩展点 API 视为稳定，破坏性变更走 major 版本。

三个扩展点，两级注册：全局 `use(plugin)`（进程内生效）/ 调用级 `option.plugins`（仅本次生成，同名覆盖全局，避免多租户并发污染）。它们在管线中的位置：

```
模板 xlsx → 标记正则匹配（可自定义）
         → ② 字段解析器取值（fieldResolvers → 扁平取值 → 标记内默认值 → option.defaults）
         → ① 标记类型 handler 渲染（内置 text/image/img/barcode/qrcode/watermark/print + 自定义）
         → 图片尺寸归一（社区纯 JS，不压缩）→ WorksheetModel
         → ③ 模型后处理钩子 → HTML 渲染 → PDF
```

```javascript
import { use } from 'xlsx2pdf';

use({
  name: 'my-plugin',
  // ① 自定义标记类型：${code|upper} → 大写文本
  markerTypes: {
    upper: async (value) => String(value ?? '').toUpperCase(),
  },
  // ② 字段解析器：首个非 undefined 命中，否则回退 data/defaults
  fieldResolvers: [async (field) => (field === 'now' ? new Date().toISOString() : undefined)],
  // ③ 模型钩子：渲染前最后一次改模型的机会
  transformModel: (model) => model,
});
```

### ① 自定义标记类型

handler 签名 `async (value, option, ctx) => result`。

**value 取值链路**（handler 之前已自动完成）：按序调用已注册的 `fieldResolvers`（首个非 `undefined` 命中）→ 扁平点路径取值 → 标记内默认值 → `option.defaults`。handler 只管渲染，无需自行取值。

**ctx 上下文字段**：

| 字段          | 类型       | 说明                                                                                                           |
| :------------ | :--------- | :------------------------------------------------------------------------------------------------------------- |
| `data`        | `object`   | 本次生成的完整数据对象（未拍平的原始结构，可直接 `ctx.data.a.b` 取嵌套值）                                     |
| `field`       | `string`   | 标记字段名（`#数组` 语法已展开为带下标点路径，如 `items.0.spec`）                                              |
| `row` / `col` | `number`   | 单元格行 / 列号（1 起）                                                                                        |
| `imageCache`  | `Map`      | 本次生成的图片缓存（key = 类型\|宽\|高\|值）；自定义图片类 handler 可复用它避免重复下载 / 编码                 |
| `numFmt`      | `string`   | 单元格数字格式，配合 `helpers.formatValue` 复用 numFmt 渲染                                                    |
| `warnings`    | `string[]` | 本次生成的降级告警收集数组；自定义 handler 可 push 告警，随返回结果 `warnings` 透出（见[降级告警](#warnings)） |

**option 字段**（标记 `|` 之后的解析结果）：`type`（类型名）、`width` / `height` / `offsetX` / `offsetY` / `zIndex` / `opacity` / `minSize` / `lineHeight`（`w120_h40` 等数字参数）、`defaultValue`（`_default:` / `_默认:` / `_dft:`）；其余 `key:value` 自定义键值原样透传（如 `format:YYYY年` → `option.format`）。

**返回值契约**：

| 返回值                                                                              | 行为                                                                                                                                                             |
| :---------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `string`                                                                            | 文本替换（同 text）                                                                                                                                              |
| `number` / `boolean`                                                                | 按文本渲染（`String(value)`）                                                                                                                                    |
| `{ images: [{ dataUrl, width?, height?, offsetX?, offsetY?, zIndex?, opacity? }] }` | 图片浮层；`width`/`height` 未设或为 0 时按原图尺寸 / 宽高比归一（同内置 image 的 `w`/`h` 规则）；`zIndex`/`opacity` 与内置图片 / 条码 / 二维码同一套层级堆叠规则 |
| `{ watermarks: [{ text, zIndex?, opacity?, minSize?, lineHeight? }] }`              | 文本水印浮层（宽度沿用单元格、高度不限）；内置 `watermark` 标记类型自 1.7.0 起社区版可用（自适应收敛属 Pro），自定义 handler 返回 watermarks 走同一套渲染                                         |
| `{ text, images, watermarks }`                                                      | 混合                                                                                                                                                             |
| `null` / `undefined`                                                                | 按空值处理（清除标记）                                                                                                                                           |

handler 抛异常不会中断生成：控制台打印 `[engine]` 错误后该标记按空值清除，其余标记 / 单元格照常；告警同时记入返回结果 `warnings`（文案标注 `E_PLUGIN_RUNTIME`）。与内置类型同名时覆盖内置并告警。

```javascript
import { use, helpers } from 'xlsx2pdf';

use({
  markerTypes: {
    // 模板写 ${signTime|datefmt_format:YYYY年MM月}（自定义键值原样进入 option）
    datefmt: (value, option) => helpers.formatValue(value, option.format),
    // 自定义「印章图」类型：路径 / URL / base64 统一读取后嵌入
    seal: async (value, option) => {
      if (!value) return null; // 空值清除标记
      const buf = await helpers.getFileBuffer(value);
      return {
        images: [
          {
            dataUrl: helpers.bufferToDataUrl(buf, 'png'),
            width: option.width || 100,
            height: option.height || 100,
          },
        ],
      };
    },
  },
});
```

### ② 自定义字段解析器

签名 `async (field, data, ctx) => value`（ctx 同上，`field` 已完成 `#数组` 展开）。按序调用，首个非 `undefined` 返回值命中；全部未命中则回退内置链路（扁平取值 → 标记内默认值 → `option.defaults`）。适用：计算字段、异步数据源（数据库 / RPC）、跨字段派生值。解析器运行抛错影响整份产物取值，包装 `E_PLUGIN_RUNTIME` 快速失败（不降级）。

```javascript
use({
  fieldResolvers: [
    async (field, data) => (field === 'fullName' ? `${data.firstName}${data.lastName}` : undefined),
    async (field) => (field.startsWith('db.') ? await fetchFromDb(field) : undefined), // 异步数据源
  ],
});
```

### ③ 模型后处理钩子

engine 产出 WorksheetModel 之后、render 之前按注册顺序调用，可微调单元格文本 / 样式 / 行高列宽（返回新 model 则替换，原地修改返回 void 亦可；钩子 ctx = `{ data, option }`）。钩子运行抛错影响整份模型，包装 `E_PLUGIN_RUNTIME` 快速失败（不降级）。

**WorksheetModel 主要字段**（即钩子入参 `model`）：

| 字段                         | 类型                        | 说明                                                                    |
| :--------------------------- | :-------------------------- | :---------------------------------------------------------------------- |
| `cells`                      | `CellModel[]`               | 单元格（仅含有内容 / 有样式的格）                                       |
| `columnWidths`               | `number[]`                  | 列宽 px（下标 = 列号 - 1）                                              |
| `rowHeights`                 | `number[]`                  | 行高 px（下标 = 行号 - 1）                                              |
| `columnWidthUnits`           | `number[]`                  | 原始 Excel 字符宽单位列宽                                               |
| `merges`                     | `{top,bottom,left,right}[]` | 合并区域（行列号 1 起）                                                 |
| `columnCount`                | `number`                    | 列数                                                                    |
| `totalWidth` / `totalHeight` | `number`                    | 表格总宽 / 总高 px                                                      |
| `pageSetup`                  | `object`                    | 模板页面设置 `{ orientation, pageSize, paperSizeCode, scale, margins }` |
| `defaultFont`                | `{name,size} \| null`       | 工作簿默认字体（列宽换算基准）                                          |

**CellModel 主要字段**：`row` / `col`（1 起）、`text`、`images`（内嵌图数组）、`segments`（富文本段级样式，存在时渲染层按段输出独立 span）、`font: { bold, size, color, italic, underline, strike }`、`alignment: { horizontal, vertical, wrapText, shrinkToFit }`、`border`（ExcelJS 风格，含 top/bottom/left/right）、`fill: { fgColor }`、`rowspan` / `colspan`。

```javascript
use({
  transformModel: (model) => {
    for (const cell of model.cells) {
      if (cell.text === '机密') cell.font.color = 'FFFF0000'; // 改文本颜色（ARGB）
    }
    return model; // 返回 void 亦可（原地修改）
  },
});
```

### 内部可用工具方法（helpers）

引擎内部同源工具方法以 `helpers` 命名空间开放（`import { helpers } from 'xlsx2pdf'`），与引擎内部同一实现，行为不会漂移：

| 方法                  | 签名                                                   | 说明                                                                                   |
| :-------------------- | :----------------------------------------------------- | :------------------------------------------------------------------------------------- |
| `getFileBuffer`       | `(source) → Promise<Buffer>`                           | 本地路径 / http(s) URL / base64（含 Data URL）→ Buffer，模板与图片通用                 |
| `flattenObject`       | `(obj, prefix?) → flatObj`                             | 嵌套对象 / 数组拍平为点路径键，与引擎取值同规则（可预览标记能引用的 key）              |
| `parseMarkerOption`   | `(optionStr?, knownTypes?, aliases?) → option`         | 解析竖杠之后的 option 串（如 `text_w100_默认:--`），与引擎同规则；aliases 缺省为内置 img/print       |
| `validateMarkerRegex` | `(regex) → void`                                       | 校验自定义标记正则契约（g 标志 + 捕获组 1），不合法抛错                                |
| `formatValue`         | `(value, fmt?) → string`                               | 按 Excel 数字格式渲染值（与 numFmt 自动继承同一实现）；不支持的格式 / 异常兜底原样输出 |
| `generateCode`        | `(type, text, { width?, height? }) → Promise<dataUrl>` | 条码 `'barcode'`（Code128）/ 二维码 `'qrcode'` 文本 → base64 图片，内置类型同款        |
| `bufferToDataUrl`     | `(buffer, extension) → dataUrl`                        | Buffer → base64 Data URL                                                               |

↑ [返回目录](#toc)

---

<a id="api"></a>

## API

| 函数            | 签名                                                                                        | 说明                                                                                       |
| :-------------- | :------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------- |
| `excel2pdf`     | `({ template, data, option }) → Promise<{ pdf: Buffer, html: string, warnings: string[] }>` | 一站式生成：模板解析 → HTML 渲染 → 无头 Chrome 打印 PDF；warnings 见[降级告警](#warnings)  |
| `excel2html`    | `({ template, data, option }) → Promise<{ html: string, warnings: string[] }>`              | 参数与 excel2pdf 一致，只走模板解析 + HTML 渲染，不启动浏览器                              |
| `configure`     | `(option?) → Readonly<BrowserOptions>`                                                      | 浏览器行为与标记语法全局配置（模块级单例），返回当前生效配置                               |
| `ensureBrowser` | `(option?) → Promise<string>`                                                               | 确保内置浏览器就绪（幂等；`{ force: true }` 强制重装），返回可执行文件路径                 |
| `closeBrowser`  | `() → Promise<void>`                                                                        | 关闭复用的单例浏览器（通常在进程退出时调用）                                               |
| `use`           | `(plugin) → void`                                                                           | 全局注册扩展插件（三扩展点，见[扩展](#extend)）                                            |
| `helpers`       | 命名空间                                                                                    | 扩展开发工具方法（引擎同源，见[扩展](#extend)）                                            |
| `getVersion`    | `() → string`                                                                               | 当前包版本（运行时读取安装目录 package.json，首次调用后缓存；缺失 / 损坏兜底 `'unknown'`） |
| `Xlsx2pdfError` | `class extends Error`                                                                       | 所有抛出错误均带稳定 `code` + 双语文案；全表见 [docs/errors.md](./docs/errors.md)          |

### excel2pdf 入参

| 参数       | 类型               | 说明                                                                                                   |
| :--------- | :----------------- | :----------------------------------------------------------------------------------------------------- |
| `template` | `string \| Buffer` | 模板路径 / http(s) URL / Buffer（必填）                                                                |
| `data`     | `object`           | 数据对象，支持嵌套 / 数组拍平取值；缺省渲染一页空模板。传数组（多页批量）属 Pro 能力，社区版抛引导错误 |
| `option`   | `GenerateOptions`  | 配置项，见下表                                                                                         |

### option（社区版）

| 参数              | 类型                                              | 默认                          | 说明                                                                                             |
| :---------------- | :------------------------------------------------ | :---------------------------- | :----------------------------------------------------------------------------------------------- |
| `pageSize`        | `'A3'\|'A4'\|'A5'\|'B4'\|'B5'\|'letter'\|'legal'` | 取模板 pageSetup              | 具名标准纸张；自定义纸张 `{width,height}`（小票卷纸）属 Pro。未知具名纸张直接报错，不静默回退 A4 |
| `orientation`     | `'portrait' \| 'landscape'`                       | 取模板                        | 页面方向                                                                                         |
| `margin`          | `{ top?, right?, bottom?, left? }`                | 模板未设时兜底 Excel 内建默认 | 页边距 mm，逐字段合并；内建默认上下 19.1 / 左右 17.8mm                                           |
| `defaults`        | `Record<string, unknown>`                         | `{}`                          | 全局字段兜底值，见下方示例                                                                       |
| `plugins`         | `Plugin[]`                                        | `[]`                          | 调用级扩展，仅本次生成生效，同名覆盖全局 `use()`                                                 |
| `markerRegex`     | `RegExp`（g 标志 + 捕获组 1）                     | 内置 `${...}`                 | 自定义标记匹配规则，优先于 configure 全局                                                        |
| `markerSeparator` | `string`                                          | `'\|'`                        | 标记内「字段 / 类型\_参数」分隔符，优先于 configure 全局                                         |
| `scale`           | `number \| 'auto'`                                | 取模板 pageSetup / auto       | 打印缩放 1~400%（超 400 封顶），100 与 `'auto'` 同义；非正数/非数值回落 auto 不抛错；模板自带缩放本就生效 |
| `emptyRowPlaceholders` | `string[]`                                   | `[]`                          | 整行均为这些占位符的行按空行处理（行高保真）；只接受字符串数组                              |
| `maxCells`        | `number`                                          | `20000`                       | 单元格数上限，0/负数关闭守卫；优先于 configure 全局；放宽风险见[部署](#deploy)          |
| `maxTemplateSize` | `number`                                          | `5242880`（5MB）              | 模板文件体积上限（字节），0/负数关闭守卫；优先于 configure 全局                              |
| `markerAliases`   | `Record<string,string> \| null`                   | 内置 img/print                | 类型别名映射，整体替换语义；优先于 configure 全局，`null` 恢复内置；见[类型别名](#markeraliases) |
| `maxConcurrency`  | `number`（正整数）                                | `1`                           | 同时渲染的标签页上限，超限排队；优先于 configure 全局；调大风险见[部署](#deploy)                 |
| `signal`          | `AbortSignal`                                     | 无                            | 取消信号：排队摘除 / 渲染中断，抛 `E_CANCELLED`，见[取消](#cancel)                               |

页面设置类（pageSize / orientation / margin）优先级：**调用级 option > 模板 pageSetup > Excel 内建默认**。Pro 专属 option 键（`fitToPage` / `minFontSize` / `pageRotate` / `fontGuard` / `memoryGuard` / `maxPages` / `batchSize`）社区版传入即显式报错引导；未知 option 键同样拒绝（拼错入参不被静默忽略）。注意：configure 对同类护栏键是静默忽略而非报错，差异原因见下文 configure(option)。

`defaults` 是全局兜底：当 `data` 缺某字段、且该标记没写默认值时，用 `defaults` 里的同名值。取值顺序为 **data → 标记内默认值 → `option.defaults`**：

```javascript
await excel2pdf({
  template: './tpl.xlsx',
  data: { name: '张三' },
  // remark、amount 未在 data 中提供，且模板标记没写默认值时按此兜底
  option: { defaults: { remark: '无', amount: 0 } },
});
```

### configure(option)

配置浏览器行为与全局标记语法（模块级单例，`closeBrowser()` 后下次启动按新配置重建）：

```javascript
import { configure } from 'xlsx2pdf';

configure({
  browserPath: '/usr/bin/chromium', // 外部浏览器（优先于内置与环境变量 XLSX2PDF_BROWSER_PATH）
  headless: 'new', // 默认 'new'
  launchArgs: ['--proxy-server=...'], // 追加启动参数
  markerRegex: /\{\{([^}]+)\}\}/g, // 全局默认标记语法（传 null 恢复内置 ${...}）
  markerSeparator: '::', // 全局默认标记内部分隔符（传 null 恢复竖杠）
  maxConcurrency: 2, // 同时渲染的标签页上限（正整数，默认 1；调大前必读部署节风险提醒）
  maxCells: 20000, // 单元格数上限（0/负数关闭；放宽前必读部署节风险提醒）
  maxTemplateSize: 5 * 1024 * 1024, // 模板体积上限（字节，0/负数关闭）
  browserIdleMs: 60000, // 空闲回收 ms（默认 60s，传 0 关闭）
  browserRecycleRenders: 0, // 渲染计数回收（默认 0 关闭，生产调优知情开启）
  browserMaxAgeMs: 0, // 墙钟年龄轮换 ms（默认 0 关闭）
  protocolTimeoutMs: 60000, // CDP 调用挂起上限（≥1000 的整数毫秒）
  onEvent: (evt) => console.log(evt), // 渲染事件钩子（null 关闭，见可观测性小节）
  markerAliases: { seal: 'watermark' }, // 类型别名（null 恢复内置 img/print，{} 清空）
});
```

| 键                | 类型               | 默认          | 说明                                                                           |
| :---------------- | :----------------- | :------------ | :----------------------------------------------------------------------------- |
| `browserPath`     | `string`           | 无            | 外部浏览器可执行文件路径，优先于内置与环境变量                                 |
| `headless`        | `boolean \| 'new'` | `'new'`       | puppeteer 无头模式                                                             |
| `launchArgs`      | `string[]`         | `[]`          | 追加的浏览器启动参数                                                           |
| `markerRegex`     | `RegExp \| null`   | 内置 `${...}` | 全局标记语法，调用级 option 优先；`null` 恢复内置                              |
| `markerSeparator` | `string \| null`   | `'\|'`        | 全局标记内部分隔符，调用级优先；`null` 恢复默认                                |
| `maxConcurrency`  | `number`（正整数） | `1`           | 同时渲染的标签页上限，超限排队；调用级 option 优先；设为 >1 时打一次性风险告警 |
| `maxCells`        | `number`           | `20000`       | 单元格数上限，0/负数关闭；非数值抛 `E_OPTION_INVALID`；超默认值打一次性告警 |
| `maxTemplateSize` | `number`           | `5242880`     | 模板体积上限（字节），0/负数关闭；校验与告警口径同 `maxCells`        |
| `browserIdleMs`   | `number`（非负整数） | `60000`     | 空闲回收 ms，0 关闭；见[部署·浏览器生命周期](#deploy)              |
| `browserRecycleRenders` | `number`（非负整数） | `0`     | 渲染计数回收阈值，0 关闭                                              |
| `browserMaxAgeMs` | `number`（非负整数） | `0`         | 墙钟年龄轮换 ms，0 关闭                                               |
| `protocolTimeoutMs` | `number`（≥1000 整数） | `60000`  | CDP 调用（含打印）挂起上限                                            |
| `onEvent`         | `function \| null` | `null`        | 渲染事件钩子，见[可观测性](#onevent)；非函数抛 `E_OPTION_INVALID`     |
| `markerAliases`   | `object \| null`   | `null`（内置 img/print） | 类型别名映射，整体替换；`null` 恢复内置、`{}` 清空；调用级 option 优先 |

社区版接受以上十四键；`memoryGuard` / `maxPages` / `fontGuard` / `pageRotate` 等其余护栏键须由 Pro 经接缝声明后才接受，社区版传入静默忽略（见[部署](#deploy)），其余未知键也同样静默忽略。`batchSize` 只走调用级 option，configure 两版均不接受。校验口径：`maxConcurrency` 只接受正整数（0/负数/小数/非数值抛 `E_OPTION_INVALID`，无「传 0 不限」语义）；生命周期三键（browserIdleMs / browserRecycleRenders / browserMaxAgeMs）只接受非负整数（0 关闭）；`protocolTimeoutMs` 只接受 ≥1000 的整数毫秒；规模守卫两键只接受数值（0/负数关闭）。

这与 option 段的行为不同，是有意为之：option 是单次生成的入参，Pro 键与拼错的未知键都显式报错（快速失败 + 转化引导）；configure 是进程级配置，社区版对未声明的键宽容忽略、固定上限兜底。想让某个 Pro 护栏键被拦截报错，请放进 option 而非 configure。

### configure 与 option 的优先级

- 页面设置（pageSize / orientation / margin）：调用级 option > 模板 pageSetup > Excel 内建默认；
- 标记语法（markerRegex / markerSeparator）：调用级 option > configure 全局 > 内置默认；
- 渲染并发（maxConcurrency）：调用级 option > configure 全局 > 1；
- 规模守卫（maxCells / maxTemplateSize）：调用级 option > configure 全局 > 默认 20000 格 / 5MB；
- 类型别名（markerAliases）：调用级 option > configure 全局 > 内置 img/print；
- 浏览器生命周期四键（browserIdleMs / browserRecycleRenders / browserMaxAgeMs / protocolTimeoutMs）与 onEvent 仅 configure 级；
- 插件：调用级 `option.plugins` 与全局 `use()` 合并，同名以调用级为准（fieldResolvers 调用级先执行，transformModel 调用级后执行）。

<a id="onevent"></a>

### 可观测性（onEvent）

`configure({ onEvent })` 传入回调即可收到渲染阶段事件（1.7.0 起），自行桥接 pino 等日志库，库零新增依赖：

```javascript
import pino from 'pino'; // 你自己的日志依赖
import { configure } from 'xlsx2pdf';

const log = pino();
configure({ onEvent: (evt) => log.info(evt, 'xlsx2pdf') });
configure({ onEvent: null }); // 关闭
```

事件共 8 个，每个都带 `step`（事件名）与 `ts`（毫秒时间戳）：

| 事件           | 触发时机                             | 主字段                              |
| :------------- | :----------------------------------- | :---------------------------------- |
| `html`         | 模板解析 + HTML 渲染完成             | `ms`、`pages`                       |
| `render.wait`  | 渲染槽位等待完成（排队耗时）         | `ms`、`pages`                       |
| `render.chrome`| 浏览器就绪 + 标签页创建（含冷启动）  | `ms`                                |
| `render.print` | Chrome 打印出片完成                  | `ms`、`bytes`、`pages`              |
| `render`       | 单批渲染完成                         | `ms`、`pages`、`bytes`、`batch`、`batches` |
| `merge`        | 多批 PDF 合并完成（仅分批路径）      | `ms`、`bytes`、`batches`            |
| `rotate`       | 横向页旋转完成（仅旋转路径）         | `ms`、`bytes`                       |
| `done`         | 整次生成完成                         | `ms`（总耗时）、`pages`、`pdfBytes`、`htmlBytes`、`batches` |

社区版单页路径收到其中 6 个（html / render.wait / render.chrome / render.print / render / done）；merge / rotate 只在分批 / 旋转路径出现。钩子抛错不击穿生成（异常吞掉，渲染照常）；未配置时零开销（不构造事件对象）。Pro 的 observe sink 与 onEvent 可共存，收到同一事件流。

<a id="cancel"></a>

### 取消（option.signal）

传入 `AbortSignal`（如 `new AbortController().signal`）可取消生成：已排队请求从队列摘除不占槽位，渲染中关闭标签页中断进行中的调用，多页批量逐页检查；取消抛 `E_CANCELLED`，浏览器单例保留复用，后续任务不受影响。非法类型（非 AbortSignal）抛 `E_OPTION_INVALID`。

```javascript
const ac = new AbortController();
setTimeout(() => ac.abort(), 5000); // 5 秒后取消
try {
  const { pdf } = await excel2pdf({ template: './tpl.xlsx', data, option: { signal: ac.signal } });
} catch (err) {
  if (err.code === 'E_CANCELLED') {
    /* 预期内的取消 */
  }
}
```

取消是**协作式尽力终止**，不保证字节级即时；商业版内存准入排队不感知 signal（其自身超时兜底，放行后的预检仍会拦截已取消请求）。

<a id="warnings"></a>

### 降级告警（warnings）

影响范围限于单个标记/图片的失败不抛错，按空值降级继续渲染：图片内容损坏/非图片、图片读取失败、浏览器内解码失败、自定义 handler 抛错等。告警同时输出到 console 与返回结果的 `warnings: string[]`（逐次生成独立，并发安全，无降级时为空数组）；影响整份产物的失败（模板/下载/护栏/渲染、fieldResolvers 与 transformModel 抛错）才抛稳定错误码。完整分工见 [docs/errors.md 降级策略披露](./docs/errors.md)。

```javascript
const { pdf, warnings } = await excel2pdf({ template: './tpl.xlsx', data });
if (warnings.length > 0) console.warn('本次生成有降级:', warnings);
```

↑ [返回目录](#toc)

---

<a id="faq"></a>

## 已知限制与 FAQ

**Q：长文本会截断或跨页怎么办？**
社区版走 Chrome 原生分页，长文本可能截断或跨页。建议在模板设计时预留足够空间，或由业务侧控制字段长度。

**Q：Pro 的自适应排版能保证不裁剪地收敛到一页吗？**
不能无条件保证——它在明确的下限约束内尽可能适配。字号与行高都有下限，含图片/水印的行受保护不参与压缩，极端内容仍装不下时，剩余溢出会被裁剪并输出告警。按常见场景设计模板，对极端场景处理告警。

**Q：支持明细行动态扩展吗？**
内置 #数组.字段 索引映射：模板按行重复标记，引擎逐次取数组下标，行数由模板固定（需预留足够重复行）。不是「一行自动展开 N 行」的动态循环。

**Q：条形码支持哪些码制？**
内置 Code128（`barcode`）与 QR Code（`qrcode`），由 bwip-js 生成 PNG。

**Q：需要安装 Office 或 LibreOffice 吗？**
不需要。内置 Headless Chrome 渲染，不依赖任何 Office 引擎。

**Q：可以并发调用吗？**
可以。默认单并发、超限排队；1.4.0 起可经 `maxConcurrency`（正整数）调大，但社区版无内存守卫，调大前必读[部署节风险提醒](#deploy)。

**Q：字体缺失怎么办？**
交由 Chrome 字体回退渲染，缺字体时字形可能与 Excel 有差异。建议容器里装好模板所用字体（见[部署](#deploy)）。

**Q：`option.defaults` 和 `${field|text_default:无}` 什么关系？**
取值顺序 data → 标记内默认值 → `option.defaults`。前者是单个标记的兜底，后者是全局字段兜底，优先级更低。

**Q：程序里怎么按错误类型分支处理？**
捕获后判断 `err instanceof Xlsx2pdfError`，按稳定的 `err.code` 分支（不要匹配文案）。错误码全表与修复建议见 [docs/errors.md](./docs/errors.md)。

**Q：社区版水印和 Pro 有什么区别？**
社区版按单元格字号渲染水印，层级 / 透明度等浮层参数生效；Pro 另提供水印随版面自动收敛字号与换行。

**Q：浏览器空闲久了会怎样？**
1.7.0 起默认空闲 60s 自动关闭、下次调用重建（成本是一次冷启动）；希望常驻的话 `configure({ browserIdleMs: 0 })` 关闭，见[部署·浏览器生命周期](#deploy)。

**Q：模板规模上限能放宽吗？**
1.7.0 起 `maxCells` / `maxTemplateSize` 可配（0/负数关闭），但社区版无内存守卫，放宽前必读[部署节风险提醒](#deploy)。

**Q：想把 `print` 用作自己的专属标记？**
`use()` 注册名为 `print` 的类型即接管该别名槽（静默无告警）；或用 `markerAliases` 调整 / 移除别名（移除后模板仍写该 token 且未注册专属类型会显式报 `E_MARKER_ALIAS`，不静默降级）。

↑ [返回目录](#toc)

---

<a id="maintenance"></a>

## 维护与版本

这个库在我们自己的生产环境里跑检测 / 票据类业务单据，已稳定运行数月。版本按 SemVer 走，改动记在 [CHANGELOG.md](./CHANGELOG.md)。社区版会持续维护，能力范围以上面的对照表与[功能清单](#status)为准。

↑ [返回目录](#toc)

---

<a id="feedback"></a>

## 反馈与商业版

- Issue / Feature Request：[GitHub Issues](https://github.com/krstation-open/xlsx2pdf/issues)
- Pro 咨询 / 免费 POC：📧 business@krstation.com
- 官网：[https://www.krstation.com/](https://www.krstation.com/)

↑ [返回目录](#toc)

---

<a id="contributing"></a>

## 贡献

欢迎 issue 与 PR。提交 PR 前请签署 CLA（见 [CONTRIBUTING.md](./CONTRIBUTING.md)）。商业版 Pro 的专有技术不在本仓库范围内，亦不接受相关实现贡献。

仓库：`https://github.com/krstation-open/xlsx2pdf.git`。提交信息强制遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)（husky `commit-msg` + commitlint 拦截），格式 `<type>(<scope>): <subject>`，header ≤ 100 字符。

本地开发流程：

```bash
npm run build      # esbuild 双产物（ESM/CJS）
npm run redline    # 红线扫描（必须零命中）
npm test           # ESM 冒烟
npm run test:cjs   # CJS 冒烟
npm run test:media # 富媒体守卫（image/barcode/qrcode + 浮层 + 尺寸归一）
npm run test:detail # 明细行守卫（索引映射 + 嵌套 + numFmt + 全链路）
npm run test:boundary # 1.7.0 边界守卫（scale/生命周期/空行/onEvent/水印/规模参数/别名）
```

↑ [返回目录](#toc)

---

<a id="license"></a>

## License

[Apache-2.0](./LICENSE) © 恺睿（深圳）软件科技有限公司

社区版可自由商用。商业版 Pro 为独立闭源产品，按商业 EULA 授权，与本仓库代码无关。

↑ [返回目录](#toc)
