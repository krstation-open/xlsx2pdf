# xlsx2pdf

[English](./README.md) | [简体中文](./README.zh-CN.md)

在 Excel 里把单据排版好，填上 `${...}` 标记，后端注入数据就能出 PDF。

一个 Node.js 服务端库，走「Excel 模板 → 标记替换 → HTML → Headless Chrome 打印」这条链路。不依赖 Office / LibreOffice，也不用自己写 HTML。Apache-2.0，可商用。

[![npm](https://img.shields.io/npm/v/xlsx2pdf)](https://www.npmjs.com/package/xlsx2pdf)
[![downloads](https://img.shields.io/npm/dw/xlsx2pdf)](https://www.npmjs.com/package/xlsx2pdf)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
![node](https://img.shields.io/badge/node-%3E%3D18.17-green)

**官网 / Official website**: [https://www.krstation.com/](https://www.krstation.com/)

---

## 快速开始

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

> postinstall 自动下载内置 Chrome（约 150MB，国内走 npmmirror 镜像）。服务器已有 Chrome/Chromium 时可复用：`configure({ browserPath: '/usr/bin/chromium' })`。

---

## 它适合做什么

简单说就是「固定模板 + 批量出单」：发票、票据、证书、标签、对账单、报告、固定格式报表这类。业务人员在 Excel 里把版式排好，后端拿 JSON 数据填进去，出来就是 PDF。中间会先渲染成一份和 Excel 所见基本一致的 HTML，需要预览或二次处理的话，可以用 `excel2html()` 单独拿这份 HTML。

几件事它不做：

- 不是通用转换器。模板里得有占位标记，不能拿任意一个 xlsx 直接转。
- 不是报表设计器。版式在 Excel 里画，不在浏览器里拖拽。
- 不是 PDF 编辑器。只管生成，不做合并、加水印这类后处理。

只想把任意 xlsx 原样转成 PDF 的话，用 LibreOffice 或专门的转换工具更合适。

---

## 和其他语言方案的比较

常有人问 Python / Java 里有没有现成的同类库。我查了一圈，大致是这样：

| 语言 | 常见开源方案 | 差在哪 |
| :--- | :--- | :--- |
| Python | openpyxl + reportlab/WeasyPrint、libreoffice-convert | 无 Chrome 一致的 Excel 模板标记引擎 |
| Java | Apache POI（无 PDF）、JasperReports（模板≠Excel） | 模板非 Excel 或无 PDF |
| Go | excelize（无 PDF）、chromedp + 手绘 | 无模板→PDF 保真引擎 |
| .NET | ClosedXML/EPPlus + 手绘 | 开源侧缺位 |
| PHP | PhpSpreadsheet + Dompdf/mPDF | Excel 保真差 |

归纳一下，其他语言的开源选择基本就四类：拖 LibreOffice 的（重、并发不好做）、自己手绘 PDF 或用自有 HTML 引擎的（对 Excel 还原差）、纯读写 xlsx 的（压根不出 PDF）、以及模板不是 Excel 的报表引擎。还原度真正高的，多半是 Aspose、Spire 这类商业闭源引擎，付费且不轻。

xlsx2pdf 想填的就是中间这块：开源、装的时候不编译 native 模块、不拖 Office、Chrome 在各平台出片一致、模板就是 Excel、还能扩展。合并格、富文本、numFmt 这些容易翻车的细节也都处理并测过了。

不过有两点得说清楚，免得期望错位：

- 还原度上，社区版列宽用的是公开公式近似，商业 native 引擎对任意 xlsx 的还原可能比它更准。真正拉开精度差距的是 Pro 的像素级列宽和单页自适应。
- 这条路线本身不神秘，各语言都有 Chrome/CDP 绑定，别人也能搭。我们的优势是把细节做完整、加上 Pro 的精度和生产护栏，不是什么独门绝技。

另外它就是个 Node.js 库。别的语言想用，要么起个 Node 服务走 HTTP 调，要么挂个 Node 侧车。

---

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
- **工程化**：ESM / CJS 双模式 + TypeScript 声明，内置模板体积 / 单元格数安全上限

---

## 详细用法

### 1. 设计模板

在 Excel 中按业务版式排版，在需要动态数据的位置填写标记：

| 单元格 | 内容 |
| :--- | :--- |
| A1 | 姓名 |
| B1 | `${name}` |
| A2 | 金额 |
| B2 | `${amount}` |
| A3 | 备注 |
| B3 | `${remark\|text_default:无}` |

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

---

## 标记语法

### 基础占位符

| 语法 | 说明 |
| :--- | :--- |
| `${field}` | 基础字段（默认 text 类型） |
| `${field\|text}` | 显式文本 |
| `${a.b.c}` | 嵌套对象点路径 |
| `${field\|text_default:无}` | 空值时的默认文本 |
| `${temp}℃ / ${humi}%` | 同格多段标记 + 静态文本混排 |
| `${#items.name}` | 明细行索引映射（重复标记行逐次取数组下标） |

### 富媒体标记（1.1.0 起内置）

| 语法 | 说明 |
| :--- | :--- |
| `${photo\|image}` | 图片（本地路径 / http(s) URL / base64 DataUrl） |
| `${photo\|image_w100_h80}` | 指定宽高（px） |
| `${code\|barcode_w120_h40}` | Code128 条形码 |
| `${qr\|qrcode_w80_h80}` | 二维码 |
| `${logo\|image_zindex2_opacity0.5}` | 浮层：层级 / 透明度 |

图片 / 条码 / 二维码共用参数键：

| 键 | 含义 |
| :--- | :--- |
| `w` / `h` | 宽 / 高（px）；只设一边按原图比例补另一边；都不设按原图尺寸（@96DPI）归一 |
| `ox` / `oy` | 水平 / 垂直偏移（px） |
| `zindex` | 浮层层级（非 0 时不撑高所在行） |
| `opacity` | 透明度（0~1） |

> 社区版尺寸归一为纯 JS 探测（不压缩）；图片自动压缩与 DPI 感知物理尺寸换算在 Pro 版提供。

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

## 社区版 vs Pro 版

社区版能独立把单份文本 / 富媒体报表从头到尾做完，不是砍了功能的试用版。Pro 主要解决批量、高并发、以及对排版精度特别敏感的生产场景。两者用的是同一套渲染管线。

| 能力 | 社区版 | Pro 版 |
| :--- | :---: | :---: |
| 单文档文本 / 富媒体报表 | ✅ | ✅ |
| 图片 / 二维码 / 条形码基础嵌入 | ✅ | ✅ |
| 图片自动压缩 + DPI 感知尺寸 | ❌ | ✅ |
| autoInsertImage / 水印标记 | ❌ | ✅ |
| 明细行索引映射（#数组.字段） | ✅ | ✅ |
| 数组多页批量（data 数组 → N 页） | ❌ | ✅ |
| 单页自适应（内容溢出自动收敛回一页、不裁剪） | ❌ | ✅ |
| 列宽精度 | 公开公式近似 | 像素级精确换算 + 缺字体守卫 |
| 自定义纸张（小票卷纸）直读 | ❌ | ✅ |
| 横向页 WPS / Clodop 打印适配 | ❌ | ✅ |
| 并发渲染 / 内存准入守卫 | 固定单并发 | 参数化生产护栏 |
| 自定义扩展（三扩展点 + 自定义语法） | ✅ | ✅ |
| 许可 | Apache-2.0，免费商用 | 商业 EULA |

表里的「单页自适应」单独解释一下：社区版内容超页时走 Chrome 原生分页，可能截断或跨页；Pro 的单页自适应会在数据过长、本来要超页时，自动调整字号与行高，把内容完整收敛到一页内，不裁剪、不丢数据。打印快递单、固定发票这类「必须一页」的场景尤其关键。

用之前有几点最好知道：

- 内容溢出走 Chrome 原生分页，长文本可能截断或跨页。要求必须单页输出的话，看 Pro 的单页自适应。
- 数据是单记录注入 + #数组.字段 明细行（行数由模板固定）。没有「一行自动展开 N 行」的动态循环，data 传数组的多页批量也在 Pro。
- 固定单并发，适合单份、低频生成。要高并发上生产，评估下 Pro 的护栏。
- 默认模板 ≤ 5MB、单元格 ≤ 20000，超了直接报错。想调这些上限在 Pro。

**Pro 咨询 / 免费 POC**：提供你的 3 个真实模板，48 小时内返回 Pro 生成效果与基准对比报告。📧 business@krstation.com

---

## 部署

### 系统依赖

内置 Headless Chrome（约 150MB），postinstall 自动下载。Linux 服务器需 Chrome 运行系统库：安装脚本会用 `ldd` 自动探测缺失库并 `apt-get` 安装（需 root 或免密 sudo）；无权限时打印手动安装命令，不中断流程。常见依赖：

```bash
# Debian / Ubuntu（按发行版版本自动选择 libasound2 / libasound2t64）
apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libgbm1 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libpango-1.0-0 libpangocairo-1.0-0 libcairo2 libxshmfence1 libasound2
```

### Docker 示例

```dockerfile
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libgbm1 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libpango-1.0-0 libpangocairo-1.0-0 libcairo2 libxshmfence1 libasound2 \
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

### 安全上限（默认值）

| 项 | 默认 | 说明 |
| :--- | :--- | :--- |
| 模板体积 | 5MB | 超限报错拒绝生成 |
| 单元格数 | 20000 | 实际行×列，超限报错（加载前另有流式预检提前拦截） |
| 渲染并发 | 1 | 同时打开的标签页上限，超限排队 |

---

## 扩展与二次开发

三个扩展点，两级注册：全局 `use(plugin)`（进程内生效）/ 调用级 `option.plugins`（仅本次生成，同名覆盖全局，避免多租户并发污染）：

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

标记类型 handler 返回值契约：`string` → 文本替换；`{ images: [{ dataUrl, width?, height?, ... }] }` → 图片浮层；`{ watermarks: [{ text, opacity?, ... }] }` → 文本水印浮层；`null/undefined` → 清除标记。

标记语法可自定义：`option.markerRegex`（或全局 `configure({ markerRegex })`）替换内置 `${...}` 匹配规则（契约：`g` 标志 + 捕获组 1 = 标记内容）；`option.markerSeparator` 替换内部「字段 / 类型_参数」分隔符（默认 `|`）。传 `null` 恢复内置默认。

扩展开发可复用引擎同源工具：`import { helpers } from 'xlsx2pdf'` 提供 `getFileBuffer` / `flattenObject` / `parseMarkerOption` / `validateMarkerRegex` / `formatValue` / `generateCode` / `bufferToDataUrl`，与引擎内部同一实现，行为不会漂移。

---

## API

| 函数 | 说明 |
| :--- | :--- |
| `excel2pdf({ template, data, option })` | 一站式生成，返回 `{ pdf: Buffer, html: string }` |
| `excel2html({ template, data, option })` | 只渲染 HTML，不启动浏览器 |
| `configure({ browserPath, headless, launchArgs, markerRegex, markerSeparator })` | 浏览器行为与标记语法全局配置 |
| `ensureBrowser()` / `closeBrowser()` | 内置浏览器就绪 / 进程退出时关闭 |
| `use(plugin)` | 全局注册扩展插件（三扩展点） |
| `helpers` | 扩展开发工具命名空间（引擎同源） |
| `getVersion()` | 当前包版本 |

`option`（社区版）：`pageSize` / `orientation` / `margin` / `defaults` / `plugins` / `markerRegex` / `markerSeparator`。

---

## 已知限制与 FAQ

**Q：长文本会截断或跨页怎么办？**
社区版采用原生 Chrome 分页，长文本可能截断或跨页。Pro 版提供单页自适应（内容溢出自动收敛回一页、不裁剪）。社区版建议在模板设计时预留足够空间，或由业务侧控制字段长度。

**Q：支持明细行动态扩展吗？**
社区版内置 #数组.字段 索引映射明细行：模板按行重复标记，引擎逐次取数组下标（行数由模板固定，需预留足够重复行）。不支持「一行自动展开 N 行」的动态循环；如需一份模板批量出多页（data 传数组），请使用 Pro 版数组批量。

**Q：条形码支持哪些码制？**
社区版内置 Code128（`barcode`）与 QR Code（`qrcode`），由 bwip-js 生成 PNG。更多码制与图片自动压缩在 Pro 版提供。

**Q：需要安装 Office 或 LibreOffice 吗？**
不需要。内置 Headless Chrome 渲染，不依赖任何 Office 引擎。

**Q：可以并发调用吗？**
社区版固定单并发（超限排队）。如需高并发，请评估 Pro 版护栏，或自行管理队列。

**Q：字体缺失怎么办？**
社区版交由 Chrome 字体回退渲染，缺字体时字形可能与 Excel 有差异。Pro 版提供缺字体守卫（检测并告警 / 可选严格模式）。

---

## 维护与版本

这个库在我们自己的生产环境里跑业务单据。版本按 SemVer 走，改动记在 [CHANGELOG.md](./CHANGELOG.md)。社区版会持续维护，能力范围以上面的对照表为准。

---

## 反馈与商业版

- Issue / Feature Request：[GitHub Issues](https://github.com/krstation-open/xlsx2pdf/issues)
- Pro 咨询 / 免费 POC：📧 business@krstation.com
- 官网：[https://www.krstation.com/](https://www.krstation.com/)

---

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
```

---

## License

[Apache-2.0](./LICENSE) © 恺睿（深圳）软件科技有限公司

社区版可自由商用。商业版 Pro 为独立闭源产品，按商业 EULA 授权，与本仓库代码无关。