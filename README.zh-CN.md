# xlsx2pdf

[English](./README.md) | [简体中文](./README.zh-CN.md)

> 在 Excel 里设计模板，一键生成高保真 PDF —— Node.js 服务端 Excel 模板 → PDF 生成库（社区版）

[![npm](https://img.shields.io/npm/v/xlsx2pdf)](https://www.npmjs.com/package/xlsx2pdf)
[![downloads](https://img.shields.io/npm/dw/xlsx2pdf)](https://www.npmjs.com/package/xlsx2pdf)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
![node](https://img.shields.io/badge/node-%3E%3D18.17-green)

**官网 / Official website**: [https://www.krstation.com/](https://www.krstation.com/)

**模板即设计稿**：业务人员在 Excel 里排版、写 `${字段}` 标记，你的后端注入数据即可产出
与 Excel 所见一致的 PDF。不用手写 HTML、不用调 CSS 对齐、不用自备浏览器。

## 为什么需要它

把固定模板的报表/票据/表单搬进后端批量生成 PDF，常见路线都有坑：

- **LibreOffice headless**：体积大、并发难、合并格/富文本/自定义纸张保真差，且没有数据注入能力；
- **exceljs + pdfkit 手绘**：等于自己写一个渲染引擎，列宽、字体、分页全是坑；
- **手写 HTML + Puppeteer**：CSS 对齐地狱，换引擎样式走样，内存随并发线性增长。

xlsx2pdf 把链路压缩为「设计模板 → 注入数据」两步，内置无头 Chrome 保证渲染一致。

## 特性（社区版）

- ✅ Excel 模板标记替换：`${field}`、嵌套点路径 `a.b.c`、标记默认值、`option.defaults`
- ✅ 单元格内多段标记：同一格多个标记与静态文本混排（如 `${temp}℃ / ${humi}%`），逐段独立替换，继承所在段富文本局部格式
- ✅ 样式保真：合并单元格、字体/字色/背景/边框、单元格内局部富文本
- ✅ 数字格式自动继承：百分比 / 货币 / 千分位 / 日期，与 Excel 显示一致
- ✅ 标准纸张 A3/A4/A5/B4/B5/letter/legal，方向与页边距，模板页面设置优先
- ✅ 内置无头 Chrome 自动安装（国内镜像源），也可复用外部浏览器
- ✅ `excel2html`：只渲染不启浏览器，轻量拿 HTML
- ✅ 自定义扩展：`use(plugin)` / `option.plugins` 三层扩展点（标记类型 / 字段解析器 / 模型钩子）
- ✅ 自定义标记语法：`markerRegex` / `markerSeparator`（调用级或全局 configure）
- ✅ ESM / CJS 双模式 + TypeScript 类型声明
- ✅ 内置模板体积/单元格数安全上限，异常大模板快速失败
- ✅ 内置富媒体标记：`image`/`img`（本地路径 / http(s) URL / base64 DataUrl）、`barcode`（Code128）、`qrcode`；浮层参数（`w/h/offset/zIndex/opacity`）；未设宽高按原图尺寸自动归一

## 安装

```bash
npm i xlsx2pdf
```

postinstall 自动下载内置 Chrome（约 150MB，国内走 npmmirror 镜像）。
服务器已有 Chrome/Chromium 时可跳过下载并复用：

```js
import { configure } from 'xlsx2pdf';
configure({ browserPath: '/usr/bin/chromium' });
```

## 快速开始

1）在 Excel 里设计模板 `tpl.xlsx`，需要动态填充的单元格写标记：

| 姓名 | `${name}`   |
| ---- | ----------- |
| 部门 | `${dept}`   |
| 金额 | `${amount}` |
| 日期 | `${date}`   |

2）注入数据，一行生成：

```js
import { excel2pdf } from 'xlsx2pdf';
import { writeFileSync } from 'node:fs';

const { pdf } = await excel2pdf({
  template: './tpl.xlsx',
  data: { name: '张三', dept: '质检部', amount: 1234.5, date: new Date() },
});
writeFileSync('out.pdf', pdf);
```

金额单元格若设置了 `¥#,##0.00` 格式，产物自动显示 `¥1,234.50`——数字格式无需任何标记参数。

## 标记语法（社区版）

```
${字段名}                 文本替换（默认类型）
${字段名|text}            显式文本
${字段名|text_default:无}  空值时的默认文本
${a.b.c}                  嵌套对象点路径取值
${temp}℃ / ${humi}%       同格多段标记 + 静态文本混排
${photo|image_w100_h80}   图片（本地路径 / http(s) URL / base64 DataUrl）
${code|barcode_w120_h40}  Code128 条形码
${qr|qrcode_w80_h80}      二维码
${logo|image_zindex2_opacity0.5}  浮层：层级 / 透明度 / 偏移
```

同一单元格可写任意多个标记，与静态文本自由混排，逐段独立替换；在 Excel 里给某段标记
单独设加粗/字色/字号（局部富文本），替换值自动继承该段格式，无需任何参数键。

数据对象支持任意层级嵌套；`data` 缺省时渲染一页空模板（标记按默认值/空值清除）。

标记语法可自定义：`option.markerRegex`（或全局 `configure({ markerRegex })`）替换内置 `${...}`
匹配规则（契约：`g` 标志 + 捕获组 1 = 标记内容）；`option.markerSeparator` 替换标记内部
「字段 / 类型\_参数」分隔符（默认 `|`）。传 `null` 恢复内置默认。

## 自定义扩展

三层扩展点，注册方式两级：全局 `use(plugin)`（进程内生效）/ 调用级 `option.plugins`
（仅本次生成生效，同名覆盖全局，避免多租户并发污染）：

```js
import { excel2pdf, use } from 'xlsx2pdf';

use({
  name: 'my-plugin',
  // ① 自定义标记类型：${code|upper} → 大写文本
  markerTypes: {
    upper: async (value) => String(value ?? '').toUpperCase(),
  },
  // ② 字段解析器：首个非 undefined 命中，否则回退数据/默认值链路
  fieldResolvers: [async (field) => (field === 'now' ? new Date().toISOString() : undefined)],
  // ③ 模型后处理钩子：渲染前最后一次改模型的机会
  transformModel: (model) => model,
});
```

标记类型 handler 返回值契约：`string` → 文本替换；`{ images: [{ dataUrl, width?, height?, ... }] }`
→ 图片浮层；`{ watermarks: [{ text, opacity?, ... }] }` → 文本水印浮层；混合对象亦可；
`null/undefined` → 清除标记。图片/水印浮层的完整参数与内置行为对齐商业版同名标记。

扩展开发可复用引擎同源工具：`import { helpers } from 'xlsx2pdf'` 提供
`getFileBuffer` / `flattenObject` / `parseMarkerOption` / `validateMarkerRegex` / `formatValue` / `generateCode` / `bufferToDataUrl`，
与引擎内部同一实现，行为不会漂移。

## API

| 函数                                                                             | 说明                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------ |
| `excel2pdf({ template, data, option })`                                          | 一站式生成，返回 `{ pdf: Buffer, html: string }` |
| `excel2html({ template, data, option })`                                         | 只渲染 HTML，不启动浏览器                        |
| `configure({ browserPath, headless, launchArgs, markerRegex, markerSeparator })` | 浏览器行为与标记语法全局配置                     |
| `ensureBrowser()` / `closeBrowser()`                                             | 内置浏览器就绪 / 进程退出时关闭                  |
| `use(plugin)`                                                                    | 全局注册扩展插件（三层扩展点）                   |
| `helpers`                                                                        | 扩展开发工具方法命名空间（引擎同源实现）         |
| `getVersion()`                                                                   | 当前包版本                                       |

`option`（社区版）：`pageSize` / `orientation` / `margin` / `defaults` / `plugins` / `markerRegex` / `markerSeparator`。

## 社区版 vs 商业版 Pro

社区版覆盖「文本类报表模板 → PDF」的完整链路及富媒体基础嵌入。以下生产级能力在商业版 Pro 提供：

| 能力                                      | 社区版                            | Pro                                                   |
| ----------------------------------------- | --------------------------------- | ----------------------------------------------------- |
| 内容超页                                  | Chrome 原生分页（可能截断/跨页）  | **单页自适应，自动收敛不裁剪**                        |
| 列宽精度                                  | 公开公式近似                      | **像素级精确换算 + 字体缺失守卫**                     |
| 图片 / 条码 / 二维码标记                  | ✅ 基础嵌入 + 浮层参数 + 尺寸归一 | **＋ 图片自动压缩与 DPI 感知尺寸、autoInsertImage、水印** |
| 数组多页批量 + 明细行语法                 | —                                 | ✅ 一份模板出百单                                     |
| 自定义纸张（小票纸）直读                  | —                                 | ✅                                                    |
| 横向页 WPS / Clodop 打印适配              | —                                 | ✅ `/Rotate` 自动改写                                 |
| 并发限流 / 内存准入守卫                   | 固定单并发                        | ✅ 参数化生产护栏                                     |
| 自定义扩展（三层扩展点 + 自定义标记语法） | ✅ use/plugins + 内置富媒体基础类型 + helpers | ✅ 同机制 + sharp/autoInsert 高级 helpers           |
| 技术支持                                  | 社区 issue                        | SLA 工单 + 专属群                                     |

**商业版咨询 / 免费 POC**：提供你的 3 个真实模板，48 小时内返回 Pro 生成效果与基准对比报告。

- 📧 business@krstation.com
- 官网：[https://www.krstation.com/](https://www.krstation.com/)

## 环境要求

- Node.js ≥ 18.17；Linux 服务器需 Chrome 运行系统库（安装脚本自动检测并提示）。
- Docker 部署建议 `node:18+` 基础镜像，单 worker 优先。

## 开发贡献（提交规范）

欢迎 issue 与 PR。提交 PR 前请签署 CLA（见 [CONTRIBUTING.md](./CONTRIBUTING.md)）。
商业版 Pro 的专有技术不在本仓库范围内，亦不接受相关实现贡献。

仓库：`https://github.com/krstation-open/xlsx2pdf.git`。提交信息强制遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)，由 husky `commit-msg` 钩子 + commitlint 拦截，不符合规范的提交会被直接拒绝。

格式：`<type>(<scope>): <subject>`（scope 可选，subject 支持中文，header 不超过 100 字符）。

| type       | 含义                    |
| ---------- | ----------------------- |
| `feat`     | 新功能                  |
| `fix`      | 修复缺陷                |
| `docs`     | 文档变更                |
| `style`    | 代码格式（不影响逻辑）  |
| `refactor` | 重构（非新功能/非修复） |
| `perf`     | 性能优化                |
| `test`     | 测试相关                |
| `build`    | 构建系统或外部依赖变更  |
| `ci`       | CI 配置变更             |
| `chore`    | 其他杂项                |
| `revert`   | 回滚                    |

示例：`feat(plugin): 新增 upper 标记类型插件`、`fix(render): 修复合并单元格边框丢失`。

克隆后执行 `npm install` 会自动激活 husky 钩子（`prepare` 脚本）。本地开发流程（构建 / 红线扫描 / 冒烟测试）见 CONTRIBUTING.md。

## License

[Apache-2.0](./LICENSE) © 恺睿（深圳）软件科技有限公司

社区版可自由商用。商业版 Pro 为独立闭源产品，按商业 EULA 授权，与本仓库代码无关。
