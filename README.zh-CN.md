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

---

<a id="what-for"></a>

## 它适合做什么

简单说就是「固定模板 + 批量出单」：发票、票据、证书、标签、对账单、报告、固定格式报表这类。业务人员在 Excel 里把版式排好，后端拿 JSON 数据填进去，出来就是 PDF。中间会先渲染成一份和 Excel 所见基本一致的 HTML，需要预览或二次处理的话，可以用 `excel2html()` 单独拿这份 HTML。

几件事它不做：

- 不是通用转换器。模板里得有占位标记，不能拿任意一个 xlsx 直接转。
- 不是报表设计器。版式在 Excel 里画，不在浏览器里拖拽。
- 不是 PDF 编辑器。只管生成，不做合并、加水印这类后处理。

只想把任意 xlsx 原样转成 PDF 的话，用 LibreOffice 或专门的转换工具更合适。

---

<a id="why"></a>

## 为什么用 xlsx2pdf

几个我们看重的点：模板就是普通 Excel，业务人员不用学新工具；装的时候不编译 native 模块、不拖 Office；渲染走 Chrome，Win / Linux / macOS 出片一致；合并格、富文本、numFmt 这些容易翻车的细节都处理并测过了；标记类型、字段解析、模型钩子三层都能扩展。

也得说清楚社区版的限度：列宽用的是公开公式近似，对排版精度要求极高的场景，Pro 提供像素级列宽和单页自适应。它就是个 Node.js 库，别的语言想用，可以起个 Node 服务走 HTTP 调，或挂个 Node 侧车。

---

<a id="features"></a>

## 特性（社区版）

- **Excel 原生模板**：模板就是普通 `.xlsx`，业务人员用 Excel / WPS / LibreOffice 都能编辑
- **标记替换**：`${field}` 基础占位符、嵌套对象 `${a.b.c}`、默认值 `${field|text_default:无}`
- **单元格内混排**：一个单元格可混排多个标记与静态文本，各片段独立替换并继承局部富文本格式
- **样式保真**：合并单元格、字体 / 颜色 / 背景 / 边框、单元格内富文本
- **数字格式继承**：自动继承 Excel 的百分比、货币、千分位、日期格式（如 `¥#,##0.00` → `¥1,234.50`）
- **页面设置模板自治**：标准纸张 A3/A4/A5/B4/B5/letter/legal、方向、边距由模板决定，业务改纸张不用改代码
- **富媒体标记（1.1.0 起内置）**：`${photo|image}`、`${code|barcode}`（Code128）、`${qr|qrcode}`；支持本地路径 / http(s) URL / base64 DataUrl；浮层参数 `w/h/ox/oy/zindex/opacity`；未设宽高按原图尺寸自动归一
- **明细行索引映射**：`${#items.name}` 同一标记按行重复，引擎逐次取数组下标（`items.0`、`items.1`…）；行数由模板固定，支持嵌套字段与 numFmt 继承
- **内置 Headless Chrome**：无需外部 Office 引擎，渲染一致性可控
- **轻量预览**：`excel2html()` 仅输出 HTML、不启动浏览器，适合预览或二次处理
- **可扩展**：标记类型、字段解析器、模型钩子三个扩展点，支持自定义 `markerRegex` / `markerSeparator`
- **工程化**：ESM / CJS 双模式 + TypeScript 声明，内置模板体积 / 单元格数安全上限，稳定错误码 + 双语报错，CLI（`xlsx2pdf convert`）

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

`watermark`（文本水印）标记类型属商业版 Pro，社区版模板中出现会显式报错引导，不静默当文本渲染。自定义 handler 仍可返回水印浮层，见[扩展](#extend)。

### 参数键

图片 / 条码 / 二维码共用下列参数键（`_` 连接，如 `image_w120_h40_ox5`）：

| 键        | 示例         | 说明                                                                                                                        |
| :-------- | :----------- | :-------------------------------------------------------------------------------------------------------------------------- |
| `w`       | `w120`       | 宽度 px。image/img 缺省时按原图尺寸（96 DPI）归一，与 `h` 只配其一时另一边按原图宽高比例；barcode/qrcode 为生成图，缺省 100 |
| `h`       | `h40`        | 高度 px。缺省适配规则同 `w`；barcode/qrcode 缺省 20                                                                         |
| `ox`      | `ox5`        | 水平偏移 px（默认 0）                                                                                                       |
| `oy`      | `oy3`        | 垂直偏移 px（可负，默认 0）                                                                                                 |
| `zindex`  | `zindex2`    | 层级：0 跟模板同层、负数在模板下方、正数在上方，可堆叠；设为非 0 后按纯浮层处理——不撑高所在行，越界部分照常显示             |
| `opacity` | `opacity0.5` | 不透明度 0~1（与 CSS `opacity` 一致，0.5 = 半透明）；值 >1 时按百分数兼容旧写法（`opacity50` → 0.5），越界按边界收敛        |

> 社区版尺寸归一为纯 JS 探测（image-size，不压缩）；图片自动压缩与 DPI 感知物理尺寸换算在 Pro 版提供。`minsize`（字号收缩下限）依赖 Pro 的单页自适应，社区版不生效；`lineheight` 仅作用于水印浮层行高，而内置 `watermark` 类型属 Pro。

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

---

<a id="compare"></a>

## 社区版 vs Pro 版

社区版能独立把单份文本 / 富媒体报表从头到尾做完，不是砍了功能的试用版。Pro 主要解决批量、高并发、以及对排版精度特别敏感的生产场景。两者用的是同一套渲染管线。

| 能力                                          |        社区版        |           Pro 版            |
| :-------------------------------------------- | :------------------: | :-------------------------: |
| 单文档文本 / 富媒体报表                       |          ✅          |             ✅              |
| 图片 / 二维码 / 条形码基础嵌入                |          ✅          |             ✅              |
| 图片自动压缩 + DPI 感知尺寸                   |          ❌          |             ✅              |
| autoInsertImage / 水印标记                    |          ❌          |             ✅              |
| 明细行索引映射（#数组.字段）                  |          ✅          |             ✅              |
| 数组多页批量（data 数组 → N 页）              |          ❌          |             ✅              |
| 单页自适应（内容溢出自动收敛回一页、不裁剪）  |          ❌          |             ✅              |
| 列宽精度                                      |     公开公式近似     | 像素级精确换算 + 缺字体守卫 |
| 自定义纸张（小票卷纸）直读                    |          ❌          |             ✅              |
| 横向页 WPS / Clodop（浏览器打印控件）打印适配 |          ❌          |             ✅              |
| 并发渲染 / 内存准入守卫                       |      固定单并发      |       参数化生产护栏        |
| 自定义扩展（三扩展点 + 自定义语法）           |          ✅          |             ✅              |
| 许可                                          | Apache-2.0，免费商用 |          商业 EULA          |

表里的「单页自适应」单独解释一下：社区版内容超页时走 Chrome 原生分页，可能截断或跨页；Pro 的单页自适应会在数据过长、本来要超页时，自动调整字号与行高，把内容完整收敛到一页内，不裁剪、不丢数据。打印快递单、固定发票这类「必须一页」的场景尤其关键。

**Pro 咨询 / 免费 POC**：提供你的 3 个真实模板，48 小时内返回 Pro 生成效果与基准对比报告。📧 business@krstation.com

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
| 模板体积 / 单元格数安全上限                                 |    ☑     | 1.0.0    | 5MB / 20000 格，固定值                                              |
| image / img 图片标记                                        |    ☑     | 1.1.0    | 本地路径 / http(s) URL / base64 DataUrl                             |
| barcode（Code128）/ qrcode 标记                             |    ☑     | 1.1.0    | bwip-js 生成 PNG                                                    |
| 浮层参数 w/h/ox/oy/zindex/opacity                           |    ☑     | 1.1.0    | 图片 / 条码 / 二维码共用                                            |
| 纯 JS 图片尺寸归一                                          |    ☑     | 1.1.0    | 未设宽高按原图 96 DPI 归一；不压缩                                  |
| 明细行索引映射 `#数组.字段`                                 |    ☑     | 1.2.0    | 行数由模板固定，非动态循环                                          |
| 示例目录 + `npm run example` 一键出片                       |    ☑     | 1.3.0    |                                                                     |
| CLI（`xlsx2pdf convert`）                                   |    ☑     | 1.3.0    |                                                                     |
| 稳定错误码 + 双语报错 + 错误对照文档                        |    ☑     | 1.3.0    |                                                                     |
| GitHub Actions CI + 状态徽章                                |    ☑     | 1.3.0    |                                                                     |
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
| 渲染事件钩子（阶段 / 耗时可观测）                           |    ☐     |          |                                                                     |
| 官方插件示例（日期格式 / 枚举映射 / i18n / 大写金额）       |    ☐     |          |                                                                     |
| 浏览器空闲自动回收                                          |    ☐     |          |                                                                     |
| 模板解析缓存                                                |    ☐     |          |                                                                     |
| URL 取材安全选项（白名单 / 超时 / 体积上限）                |    ☐     |          |                                                                     |
| 官方 Docker 镜像                                            |    ☐     |          |                                                                     |

### Pro 专属（社区版不提供）

图片自动压缩 + DPI 感知尺寸、autoInsertImage、watermark 标记、数组多页批量、单页自适应收敛、像素级列宽 + 缺字体守卫、自定义纸张直读、横向页国产打印控件适配、精确缩放、并发与内存护栏参数化。效果对照见[社区版 vs Pro 版](#compare)。

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

| 项       | 默认  | 说明                                              |
| :------- | :---- | :------------------------------------------------ |
| 模板体积 | 5MB   | 超限报错拒绝生成                                  |
| 单元格数 | 20000 | 实际行×列，超限报错（加载前另有流式预检提前拦截） |
| 渲染并发 | 1     | 同时打开的标签页上限，超限排队                    |

这三项在社区版是固定默认值，不开放参数化；`maxCells` / `maxTemplateSize` / `maxConcurrency` / `memoryGuard` 等护栏参数化属 Pro 能力，社区版经 option 传入会显式报错引导（configure 则静默忽略，见 [API](#api)）。远程资源（模板 URL / 图片 URL）下载带 30 秒超时与 20MB 体积上限，失败统一抛带稳定错误码（`E_DOWNLOAD_*`）的双语报错并附 URL，见 [docs/errors.md](./docs/errors.md)。

---

<a id="extend"></a>

## 扩展与二次开发

> 1.0 起扩展点 API 视为稳定，破坏性变更走 major 版本。

三个扩展点，两级注册：全局 `use(plugin)`（进程内生效）/ 调用级 `option.plugins`（仅本次生成，同名覆盖全局，避免多租户并发污染）。它们在管线中的位置：

```
模板 xlsx → 标记正则匹配（可自定义）
         → ② 字段解析器取值（fieldResolvers → 扁平取值 → 标记内默认值 → option.defaults）
         → ① 标记类型 handler 渲染（内置 text/image/img/barcode/qrcode + 自定义）
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

| 字段          | 类型     | 说明                                                                                           |
| :------------ | :------- | :--------------------------------------------------------------------------------------------- |
| `data`        | `object` | 本次生成的完整数据对象（未拍平的原始结构，可直接 `ctx.data.a.b` 取嵌套值）                     |
| `field`       | `string` | 标记字段名（`#数组` 语法已展开为带下标点路径，如 `items.0.spec`）                              |
| `row` / `col` | `number` | 单元格行 / 列号（1 起）                                                                        |
| `imageCache`  | `Map`    | 本次生成的图片缓存（key = 类型\|宽\|高\|值）；自定义图片类 handler 可复用它避免重复下载 / 编码 |
| `numFmt`      | `string` | 单元格数字格式，配合 `helpers.formatValue` 复用 numFmt 渲染                                    |

**option 字段**（标记 `|` 之后的解析结果）：`type`（类型名）、`width` / `height` / `offsetX` / `offsetY` / `zIndex` / `opacity` / `minSize` / `lineHeight`（`w120_h40` 等数字参数）、`defaultValue`（`_default:` / `_默认:` / `_dft:`）；其余 `key:value` 自定义键值原样透传（如 `format:YYYY年` → `option.format`）。

**返回值契约**：

| 返回值                                                                              | 行为                                                                                                                                                             |
| :---------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `string`                                                                            | 文本替换（同 text）                                                                                                                                              |
| `number` / `boolean`                                                                | 按文本渲染（`String(value)`）                                                                                                                                    |
| `{ images: [{ dataUrl, width?, height?, offsetX?, offsetY?, zIndex?, opacity? }] }` | 图片浮层；`width`/`height` 未设或为 0 时按原图尺寸 / 宽高比归一（同内置 image 的 `w`/`h` 规则）；`zIndex`/`opacity` 与内置图片 / 条码 / 二维码同一套层级堆叠规则 |
| `{ watermarks: [{ text, zIndex?, opacity?, minSize?, lineHeight? }] }`              | 文本水印浮层（宽度沿用单元格、高度不限）；内置 `watermark` 标记类型属 Pro，但自定义 handler 返回 watermarks 社区版可渲染                                         |
| `{ text, images, watermarks }`                                                      | 混合                                                                                                                                                             |
| `null` / `undefined`                                                                | 按空值处理（清除标记）                                                                                                                                           |

handler 抛异常不会中断生成：控制台打印 `[engine]` 错误后该标记按空值清除，其余标记 / 单元格照常。与内置类型同名时覆盖内置并告警。

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

签名 `async (field, data, ctx) => value`（ctx 同上，`field` 已完成 `#数组` 展开）。按序调用，首个非 `undefined` 返回值命中；全部未命中则回退内置链路（扁平取值 → 标记内默认值 → `option.defaults`）。适用：计算字段、异步数据源（数据库 / RPC）、跨字段派生值。

```javascript
use({
  fieldResolvers: [
    async (field, data) => (field === 'fullName' ? `${data.firstName}${data.lastName}` : undefined),
    async (field) => (field.startsWith('db.') ? await fetchFromDb(field) : undefined), // 异步数据源
  ],
});
```

### ③ 模型后处理钩子

engine 产出 WorksheetModel 之后、render 之前按注册顺序调用，可微调单元格文本 / 样式 / 行高列宽（返回新 model 则替换，原地修改返回 void 亦可；钩子 ctx = `{ data, option }`）。

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
| `parseMarkerOption`   | `(optionStr?, knownTypes?) → option`                   | 解析竖杠之后的 option 串（如 `text_w100_默认:--`），与引擎同规则                       |
| `validateMarkerRegex` | `(regex) → void`                                       | 校验自定义标记正则契约（g 标志 + 捕获组 1），不合法抛错                                |
| `formatValue`         | `(value, fmt?) → string`                               | 按 Excel 数字格式渲染值（与 numFmt 自动继承同一实现）；不支持的格式 / 异常兜底原样输出 |
| `generateCode`        | `(type, text, { width?, height? }) → Promise<dataUrl>` | 条码 `'barcode'`（Code128）/ 二维码 `'qrcode'` 文本 → base64 图片，内置类型同款        |
| `bufferToDataUrl`     | `(buffer, extension) → dataUrl`                        | Buffer → base64 Data URL                                                               |

---

<a id="api"></a>

## API

| 函数            | 签名                                                                    | 说明                                                                                       |
| :-------------- | :---------------------------------------------------------------------- | :----------------------------------------------------------------------------------------- |
| `excel2pdf`     | `({ template, data, option }) → Promise<{ pdf: Buffer, html: string }>` | 一站式生成：模板解析 → HTML 渲染 → 无头 Chrome 打印 PDF                                    |
| `excel2html`    | `({ template, data, option }) → Promise<{ html: string }>`              | 参数与 excel2pdf 一致，只走模板解析 + HTML 渲染，不启动浏览器                              |
| `configure`     | `(option?) → Readonly<BrowserOptions>`                                  | 浏览器行为与标记语法全局配置（模块级单例），返回当前生效配置                               |
| `ensureBrowser` | `(option?) → Promise<string>`                                           | 确保内置浏览器就绪（幂等；`{ force: true }` 强制重装），返回可执行文件路径                 |
| `closeBrowser`  | `() → Promise<void>`                                                    | 关闭复用的单例浏览器（通常在进程退出时调用）                                               |
| `use`           | `(plugin) → void`                                                       | 全局注册扩展插件（三扩展点，见[扩展](#extend)）                                            |
| `helpers`       | 命名空间                                                                | 扩展开发工具方法（引擎同源，见[扩展](#extend)）                                            |
| `getVersion`    | `() → string`                                                           | 当前包版本（运行时读取安装目录 package.json，首次调用后缓存；缺失 / 损坏兜底 `'unknown'`） |
| `Xlsx2pdfError` | `class extends Error`                                                   | 所有抛出错误均带稳定 `code` + 双语文案；全表见 [docs/errors.md](./docs/errors.md)      |

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

页面设置类（pageSize / orientation / margin）优先级：**调用级 option > 模板 pageSetup > Excel 内建默认**。Pro 专属 option 键（`fitToPage` / `minFontSize` / `scale` / `pageRotate` / `fontGuard` / `maxCells` / `maxTemplateSize` / `maxConcurrency` / `memoryGuard` / `emptyRowPlaceholders`）社区版传入即显式报错引导；未知 option 键同样拒绝（拼错入参不被静默忽略）。注意：configure 对同类护栏键是静默忽略而非报错，差异原因见下文 configure(option)。

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
});
```

| 键                | 类型               | 默认          | 说明                                              |
| :---------------- | :----------------- | :------------ | :------------------------------------------------ |
| `browserPath`     | `string`           | 无            | 外部浏览器可执行文件路径，优先于内置与环境变量    |
| `headless`        | `boolean \| 'new'` | `'new'`       | puppeteer 无头模式                                |
| `launchArgs`      | `string[]`         | `[]`          | 追加的浏览器启动参数                              |
| `markerRegex`     | `RegExp \| null`   | 内置 `${...}` | 全局标记语法，调用级 option 优先；`null` 恢复内置 |
| `markerSeparator` | `string \| null`   | `'\|'`        | 全局标记内部分隔符，调用级优先；`null` 恢复默认   |

社区版只接受以上五键；`maxConcurrency` / `maxCells` / `maxTemplateSize` / `memoryGuard` / `fontGuard` / `pageRotate` 等护栏键须由 Pro 经接缝声明后才接受，社区版传入静默忽略、按固定安全上限执行（见[部署](#deploy)），其余未知键也同样静默忽略。

这与 option 段的行为不同，是有意为之：option 是单次生成的入参，Pro 键与拼错的未知键都显式报错（快速失败 + 转化引导）；configure 是进程级配置，社区版对未声明的键宽容忽略、固定上限兜底。想让某个 Pro 护栏键被拦截报错，请放进 option 而非 configure。

### configure 与 option 的优先级

- 页面设置（pageSize / orientation / margin）：调用级 option > 模板 pageSetup > Excel 内建默认；
- 标记语法（markerRegex / markerSeparator）：调用级 option > configure 全局 > 内置默认；
- 插件：调用级 `option.plugins` 与全局 `use()` 合并，同名以调用级为准（fieldResolvers 调用级先执行，transformModel 调用级后执行）。

---

<a id="faq"></a>

## 已知限制与 FAQ

**Q：长文本会截断或跨页怎么办？**
社区版走 Chrome 原生分页，长文本可能截断或跨页。建议在模板设计时预留足够空间，或由业务侧控制字段长度。

**Q：支持明细行动态扩展吗？**
内置 #数组.字段 索引映射：模板按行重复标记，引擎逐次取数组下标，行数由模板固定（需预留足够重复行）。不是「一行自动展开 N 行」的动态循环。

**Q：条形码支持哪些码制？**
内置 Code128（`barcode`）与 QR Code（`qrcode`），由 bwip-js 生成 PNG。

**Q：需要安装 Office 或 LibreOffice 吗？**
不需要。内置 Headless Chrome 渲染，不依赖任何 Office 引擎。

**Q：可以并发调用吗？**
固定单并发，超限排队。高并发场景需自行管理队列。

**Q：字体缺失怎么办？**
交由 Chrome 字体回退渲染，缺字体时字形可能与 Excel 有差异。建议容器里装好模板所用字体（见[部署](#deploy)）。

**Q：`option.defaults` 和 `${field|text_default:无}` 什么关系？**
取值顺序 data → 标记内默认值 → `option.defaults`。前者是单个标记的兜底，后者是全局字段兜底，优先级更低。

**Q：程序里怎么按错误类型分支处理？**
捕获后判断 `err instanceof Xlsx2pdfError`，按稳定的 `err.code` 分支（不要匹配文案）。错误码全表与修复建议见 [docs/errors.md](./docs/errors.md)。

---

<a id="maintenance"></a>

## 维护与版本

这个库在我们自己的生产环境里跑检测 / 票据类业务单据，已稳定运行数月。版本按 SemVer 走，改动记在 [CHANGELOG.md](./CHANGELOG.md)。社区版会持续维护，能力范围以上面的对照表与[功能清单](#status)为准。

---

<a id="feedback"></a>

## 反馈与商业版

- Issue / Feature Request：[GitHub Issues](https://github.com/krstation-open/xlsx2pdf/issues)
- Pro 咨询 / 免费 POC：📧 business@krstation.com
- 官网：[https://www.krstation.com/](https://www.krstation.com/)

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
```

---

<a id="license"></a>

## License

[Apache-2.0](./LICENSE) © 恺睿（深圳）软件科技有限公司

社区版可自由商用。商业版 Pro 为独立闭源产品，按商业 EULA 授权，与本仓库代码无关。
