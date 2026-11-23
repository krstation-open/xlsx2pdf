# 错误码对照表 / Error Code Reference

`xlsx2pdf` 的所有可预期失败都抛出携带稳定 `err.code` 的错误（`Xlsx2pdfError`，可从包入口导入做 `instanceof` 判断）。
报错文案为双语：中文原文在前、英文翻译在后；**按码处理，不要匹配文案**。

All expected failures throw an error with a stable `err.code` (`Xlsx2pdfError`, exported from the package entry for `instanceof` checks).
Messages are bilingual (Chinese first, English appended). **Branch on the code, not on the message text.**

```js
import { excel2pdf, Xlsx2pdfError } from 'xlsx2pdf';

try {
  const { pdf } = await excel2pdf({ template: './tpl.xlsx', data });
} catch (err) {
  if (err instanceof Xlsx2pdfError && err.code === 'E_BROWSER_NOT_FOUND') {
    // 补装内置 Chrome 后重试 / install the bundled Chrome, then retry
  }
  throw err;
}
```

## 码表 / Code table

| 错误码 Code                                   | 触发场景 Trigger                                                                       | 修复建议 Fix                                   |
| :-------------------------------------------- | :------------------------------------------------------------------------------------- | :--------------------------------------------- |
| [`E_TEMPLATE_MISSING`](#e_template_missing)   | 未传 `template`                                                                        | 传入模板路径 / URL / Buffer                    |
| [`E_TEMPLATE_LOAD`](#e_template_load)         | 模板读取或解析失败（文件不存在、损坏、非 xlsx、无工作表）                              | 核对路径与文件有效性                           |
| [`E_DATA_TYPE`](#e_data_type)                 | `data` 不是对象                                                                        | 传普通对象（数组批量属 Pro）                   |
| [`E_OPTION_PRO`](#e_option_pro)               | 传入 Pro 专属 option / 数组 data / 对象型 pageSize                                     | 移除该参数或升级 Pro                           |
| [`E_OPTION_UNKNOWN`](#e_option_unknown)       | 未知 option 键（含拼写错误）                                                           | 对照 README option 表                          |
| [`E_OPTION_INVALID`](#e_option_invalid)       | option / configure 值类型非法（含 `maxConcurrency` 非正整数、`signal` 非 AbortSignal） | 按提示传合法值                                 |
| [`E_MARKER_REGEX`](#e_marker_regex)           | 自定义标记正则不合契约                                                                 | g 标志 + 捕获组 1                              |
| [`E_MARKER_SEPARATOR`](#e_marker_separator)   | `markerSeparator` 为空或非字符串                                                       | 传非空字符串                                   |
| [`E_MARKER_PRO`](#e_marker_pro)               | 模板使用未注册的 Pro 标记类型（watermark）                                             | 移除标记或升级 Pro                             |
| [`E_SIZE_CAP`](#e_size_cap)                   | 模板体积超上限（默认 5MB）                                                             | 拆分模板 / 分批生成                            |
| [`E_CELL_CAP`](#e_cell_cap)                   | 单元格数超上限（默认 20000）                                                           | 按业务分页拆分                                 |
| [`E_PAPER_CUSTOM`](#e_paper_custom)           | 模板自定义纸张（代码 ≥256）且未显式指定尺寸                                            | `option.pageSize` 显式指定（自定义纸张属 Pro） |
| [`E_PAPER_CODE`](#e_paper_code)               | 模板纸张代码不在支持列表                                                               | `option.pageSize` 显式指定                     |
| [`E_PAPER_UNSUPPORTED`](#e_paper_unsupported) | `pageSize` 名称/对象无效                                                               | 传具名标准纸张                                 |
| [`E_DOWNLOAD_SIZE`](#e_download_size)         | 远程资源超 20MB 下载上限                                                               | 换更小的资源                                   |
| [`E_DOWNLOAD_TIMEOUT`](#e_download_timeout)   | 远程下载超 30 秒                                                                       | 检查网络 / 换源                                |
| [`E_DOWNLOAD_HTTP`](#e_download_http)         | 远程下载返回 HTTP 错误状态                                                             | 核对 URL 与访问权限                            |
| [`E_DOWNLOAD_NETWORK`](#e_download_network)   | 远程下载网络错误（DNS/连接等）                                                         | 检查网络与出口策略                             |
| [`E_BROWSER_NOT_FOUND`](#e_browser_not_found) | 内置 Chrome 缺失且未指定外部浏览器                                                     | 补装或指定 browserPath                         |
| [`E_BROWSER_PATH`](#e_browser_path)           | 指定的外部浏览器路径不存在                                                             | 核对路径                                       |
| [`E_BROWSER_LAUNCH`](#e_browser_launch)       | Chrome 启动失败                                                                        | 看原始错误；容器加 --no-sandbox 已内置         |
| [`E_BROWSER_DEPS`](#e_browser_deps)           | Linux 缺 Chrome 系统依赖库                                                             | 按 apt 清单安装缺失库                          |
| [`E_BROWSER_DOWNLOAD`](#e_browser_download)   | 内置 Chrome 下载重试耗尽                                                               | 检查网络后手动补装                             |
| [`E_PLUGIN_INVALID`](#e_plugin_invalid)       | 插件结构非法（非对象 / 扩展点非函数）                                                  | 对照 README 扩展契约                           |
| [`E_PLUGIN_RUNTIME`](#e_plugin_runtime)       | 插件运行期失败（fieldResolvers / transformModel 抛错）                                 | 修插件实现；handler 抛错不抛此码而是降级告警   |
| [`E_CODE_TYPE`](#e_code_type)                 | `generateCode` 类型不支持                                                              | 传 barcode / qrcode                            |
| [`E_RENDER`](#e_render)                       | 页面渲染 / 出片失败（含新开标签页失败）                                                | 看原始错误；多为超时或页面异常                 |
| [`E_CANCELLED`](#e_cancelled)                 | `option.signal` 已 abort（入口预检 / 排队摘除 / 渲染中断）                             | 预期行为；需要产物时不取消或重试               |

---

<a id="e_template_missing"></a>

### E_TEMPLATE_MISSING

调用 `excel2pdf` / `excel2html` 时未传 `template`（或传了 `null` / 空串）。
`template` was missing (or `null` / empty) when calling `excel2pdf` / `excel2html`.

**修复 / Fix**：传入 Excel 模板的本地路径、http(s) URL、base64/DataUrl 或 Buffer。
Pass a local path, http(s) URL, base64/DataUrl or Buffer of the Excel template.

<a id="e_template_load"></a>

### E_TEMPLATE_LOAD

模板读取失败（本地文件不存在/无权限）、不是有效 xlsx（损坏或扩展名不符）、或工作簿内没有工作表。
The template could not be read (missing file / permission), is not a valid xlsx (corrupted), or contains no worksheet.

**修复 / Fix**：确认路径正确、文件能用 Excel/WPS 正常打开；远程模板先确认 URL 可下载（下载类失败有独立的 `E_DOWNLOAD_*` 码）。
Verify the path and that the file opens in Excel/WPS; for remote templates check the URL first (download failures carry their own `E_DOWNLOAD_*` codes).

<a id="e_data_type"></a>

### E_DATA_TYPE

`data` 传了非对象值（字符串、数字等）。数组批量出多页属 Pro 能力，见 `E_OPTION_PRO`。
`data` was a non-object value. Array batch rendering is a Pro capability, see `E_OPTION_PRO`.

**修复 / Fix**：传普通对象，嵌套字段用点路径取值（如 `{ customer: { name: '张三' } }` 对应 `${customer.name}`）。
Pass a plain object; nested fields are addressed with dot paths.

<a id="e_option_pro"></a>

### E_OPTION_PRO

传入了商业版 Pro 专属参数：数组 `data`（批量多页）、对象型 `option.pageSize`（自定义纸张）、或 `fitToPage` / `scale` / `pageRotate` / `fontGuard` / `maxCells` / `maxTemplateSize` / `memoryGuard` / `emptyRowPlaceholders` 等护栏/精调键。社区版显式报错引导，不静默降级。（`maxConcurrency` 自 1.4.0 已下放社区版，不再属 Pro 专属，见 `E_OPTION_INVALID`。）
A Pro-only parameter was passed: array `data` (batch pages), object `option.pageSize` (custom paper), or guardrail/fine-tuning keys such as `fitToPage` / `scale` / `pageRotate` / `fontGuard` / `maxCells` / `maxTemplateSize` / `memoryGuard` / `emptyRowPlaceholders`. The community edition fails fast with guidance instead of silently degrading. (`maxConcurrency` is available in the community edition since 1.4.0 and is no longer Pro-only; see `E_OPTION_INVALID`.)

**修复 / Fix**：移除该参数用社区版默认行为，或联系商业版咨询（报错文案内含邮箱）。
Remove the parameter to use community defaults, or contact Pro sales (email included in the message).

<a id="e_option_unknown"></a>

### E_OPTION_UNKNOWN

`option` 中出现不认识的键（常见于拼写错误）。拼错入参不应被静默忽略，故快速失败。
An unrecognized key appeared in `option` (usually a typo); unknown keys fail fast rather than being silently ignored.

**修复 / Fix**：对照报错中列出的支持键清单与 README「option 类型/默认值」表修正拼写。
Check the supported-key list in the message and the option table in the README.

<a id="e_option_invalid"></a>

### E_OPTION_INVALID

option / configure 的值类型非法。社区版恒生效的校验：`maxConcurrency` 只接受正整数（0/负数/小数/非数值均拒绝，无「传 0 不限」语义）；`option.signal` 只接受 AbortSignal；其余如 `pageRotate` 非 boolean、`fontGuard` 不在策略列表等校验仅在 Pro 经接缝声明相应键后生效；纯社区版下这些键会更早被 `E_OPTION_PRO`（option）拦截或静默忽略（configure）。
An option/configure value has an invalid type. Always enforced in the community edition: `maxConcurrency` accepts positive integers only (0 / negatives / fractions / non-numbers are rejected; there is no "0 = unlimited" semantics); `option.signal` accepts an AbortSignal only. Other checks (e.g. non-boolean `pageRotate`, `fontGuard` outside the strategy list) only apply after Pro declares the keys via seams; in the pure community edition such keys are intercepted earlier by `E_OPTION_PRO` (option) or silently ignored (configure).

**修复 / Fix**：按报错提示的合法取值传参。
Pass one of the accepted values listed in the message.

<a id="e_marker_regex"></a>

### E_MARKER_REGEX

自定义 `markerRegex` 不满足契约：必须是 RegExp 实例、带 `g` 标志、含至少一个捕获组（捕获组 1 = 标记内部内容）。
A custom `markerRegex` violates the contract: it must be a RegExp with the `g` flag and at least one capture group (group 1 = marker inner content).

**修复 / Fix**：如 `/\{\{([^}]+)\}\}/g`；契约详见 README「自定义标记语法」。
E.g. `/\{\{([^}]+)\}\}/g`; see "Custom marker syntax" in the README.

<a id="e_marker_separator"></a>

### E_MARKER_SEPARATOR

`markerSeparator` 传了空串或非字符串（空串会令所有标记的字段解析错乱）。
`markerSeparator` was empty or not a string (an empty separator corrupts field parsing of every marker).

**修复 / Fix**：传非空字符串；不传则用默认 `|`。
Pass a non-empty string, or omit it to use the default `|`.

<a id="e_marker_pro"></a>

### E_MARKER_PRO

模板中使用了未注册的 Pro 标记类型（当前为 `watermark`；`image` / `img` / `barcode` / `qrcode` 自 1.1.0 已内置社区版）。
The template uses an unregistered Pro marker type (currently `watermark`; `image` / `img` / `barcode` / `qrcode` are built into the community edition since 1.1.0).

**修复 / Fix**：移除该标记，或联系商业版咨询；也可经 `use()` 插件自行实现同名类型。
Remove the marker, contact Pro sales, or implement the type yourself via a `use()` plugin.

<a id="e_size_cap"></a>

### E_SIZE_CAP

模板文件体积超过安全上限（社区版固定 5MB）。超大模板会让内存与产物成比例膨胀，单页渲染产物必被裁剪，早拒绝优于击穿服务。
The template file exceeds the safety cap (fixed 5MB in the community edition). Oversized templates inflate memory and output proportionally; single-page output would be clipped, so failing early protects the service.

**修复 / Fix**：精简模板（删除无关行列/嵌入对象），或按业务拆分数据分批生成。
Slim the template (drop unused rows/columns/embedded objects) or split the data and generate in batches.

<a id="e_cell_cap"></a>

### E_CELL_CAP

模板单元格数（行 × 列）超过安全上限（社区版固定 20000），含加载前预检与加载后实测两道守卫。
The template cell count (rows × columns) exceeds the safety cap (fixed 20000 in the community edition); guarded both by a pre-load estimate and a post-load measurement.

**修复 / Fix**：按业务分页拆分模板与数据，分批生成。
Split the template and data by business pages and generate in batches.

<a id="e_paper_custom"></a>

### E_PAPER_CUSTOM

模板使用自定义纸张（Excel 纸张代码 ≥256），物理尺寸配置在打印机驱动中、文件内无法读取；未显式指定尺寸时绝不静默回退 A4（会产出错误尺寸的 PDF）。
The template uses custom paper (Excel paper code ≥256) whose physical size lives in the printer driver and cannot be read from the file; without an explicit size the library refuses to silently fall back to A4 (which would produce a wrong-sized PDF).

**修复 / Fix**：通过 `option.pageSize` 显式指定 `{ width, height }` mm（对象型自定义纸张属 Pro 能力）；社区版可改用标准纸张模板。
Specify `{ width, height }` mm via `option.pageSize` (object-form custom paper is a Pro capability); on the community edition, switch the template to a standard paper size.

<a id="e_paper_code"></a>

### E_PAPER_CODE

模板纸张代码不在支持列表（letter/legal/A3/A4/A5/B4/B5），且未显式指定尺寸。
The template paper code is not in the supported list (letter/legal/A3/A4/A5/B4/B5) and no explicit size was given.

**修复 / Fix**：`option.pageSize` 传具名标准纸张；或在 Excel 中把模板页面设置改为标准纸张。
Pass a named standard size via `option.pageSize`, or change the template page setup to a standard paper in Excel.

<a id="e_paper_unsupported"></a>

### E_PAPER_UNSUPPORTED

`pageSize` 传了不支持的名称或无效对象（`{ width, height }` 必须同时为有效正数）。
`pageSize` was an unsupported name or an invalid object (`{ width, height }` must both be valid positive numbers).

**修复 / Fix**：传 A3/A4/A5/B4/B5/letter/legal；缺省（不传）时按「模板 pageSetup > Excel 内建默认 A4」的优先级链路取值。
Use A3/A4/A5/B4/B5/letter/legal; when omitted, the precedence chain applies: template pageSetup > Excel built-in default A4.

<a id="e_download_size"></a>

### E_DOWNLOAD_SIZE

远程模板/图片超过 20MB 下载上限（防超大响应打爆内存）。
The remote template/image exceeds the 20MB download cap (protects memory from oversized responses).

**修复 / Fix**：压缩或更换资源；本地文件不受此限（受 `E_SIZE_CAP` 模板体积守卫约束）。
Compress or replace the resource; local files are not subject to this cap (they go through the `E_SIZE_CAP` template guard).

<a id="e_download_timeout"></a>

### E_DOWNLOAD_TIMEOUT

远程下载超过 30 秒超时。
The remote download exceeded the 30s timeout.

**修复 / Fix**：检查网络与目标服务响应速度；可先把资源下载到本地再传路径。
Check the network and the target service; alternatively download the resource locally and pass a path.

<a id="e_download_http"></a>

### E_DOWNLOAD_HTTP

远程下载返回 HTTP 错误状态（404/403/5xx 等，状态码附在报错中）。
The remote download returned an HTTP error status (404/403/5xx etc., included in the message).

**修复 / Fix**：核对 URL 拼写、资源是否存在、是否需要鉴权（当前下载链路不带自定义鉴权头）。
Verify the URL, resource existence and access rights (the download path sends no custom auth headers).

<a id="e_download_network"></a>

### E_DOWNLOAD_NETWORK

远程下载网络层错误（DNS 解析失败、连接重置等，原始错误码附在报错中）。
Network-level download failure (DNS failure, connection reset etc.; the original error code is included).

**修复 / Fix**：检查服务器出口网络/代理策略；容器环境确认能访问目标域名。
Check egress network/proxy policy; in containers verify the target domain is reachable.

<a id="e_browser_not_found"></a>

### E_BROWSER_NOT_FOUND

包内 `browsers/` 没有内置 Chrome（postinstall 被跳过或下载失败），也未指定外部浏览器。
The bundled Chrome is missing under `browsers/` (postinstall skipped or failed) and no external browser is configured.

**修复 / Fix**：运行 `npx xlsx2pdf-browser install` 或调用 `ensureBrowser()` 补装；已有 Chrome/Chromium 时 `configure({ browserPath })` 或环境变量 `XLSX2PDF_BROWSER_PATH` 指定并跳过下载。
Run `npx xlsx2pdf-browser install` or call `ensureBrowser()`; to reuse an existing Chrome/Chromium set `configure({ browserPath })` or `XLSX2PDF_BROWSER_PATH` and skip the download.

<a id="e_browser_path"></a>

### E_BROWSER_PATH

`configure({ browserPath })` 或 `XLSX2PDF_BROWSER_PATH` 指向的可执行文件不存在。
The executable pointed to by `configure({ browserPath })` or `XLSX2PDF_BROWSER_PATH` does not exist.

**修复 / Fix**：核对路径指向真实可执行文件（Windows 为 chrome.exe，Linux 为 chrome/chromium 二进制）。
Point it at a real executable (chrome.exe on Windows, the chrome/chromium binary on Linux).

<a id="e_browser_launch"></a>

### E_BROWSER_LAUNCH

Chrome 进程启动失败（原始错误附在报错中）。Linux 缺系统库的情形会被诊断为更具体的 `E_BROWSER_DEPS`。
The Chrome process failed to launch (original error included). Missing Linux system libraries are diagnosed as the more specific `E_BROWSER_DEPS`.

**修复 / Fix**：按原始错误排查（常见：可执行文件与平台不符、磁盘/权限问题）；启动参数已内置 `--no-sandbox` 等容器友好项。
Follow the original error (common: executable/platform mismatch, disk/permission issues); container-friendly flags such as `--no-sandbox` are already included.

<a id="e_browser_deps"></a>

### E_BROWSER_DEPS

Linux 下 Chrome 依赖的系统库缺失（启动失败后经 `ldd` 检出 not found）。
Chrome is missing required system libraries on Linux (detected via `ldd` after a launch failure).

**修复 / Fix**：Debian/Ubuntu 按 README 部署节的 apt 包清单安装（`libnss3 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libasound2t64 …`，24.04 以下用 `libasound2`）；root/免密 sudo 环境下补装流程会自动安装。
Install the apt packages listed in the README Deployment section on Debian/Ubuntu (`libnss3 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libasound2t64 …`, use `libasound2` below 24.04); the install flow auto-installs them under root/passwordless sudo.

<a id="e_browser_download"></a>

### E_BROWSER_DOWNLOAD

内置 Chrome 下载重试 5 次仍失败（镜像源不可达/网络中断）。
The bundled Chrome download failed after 5 retries (mirror unreachable / network interrupted).

**修复 / Fix**：检查网络后手动执行 `npx xlsx2pdf-browser install`；已有浏览器可指定 `browserPath` 跳过下载。
Check the network and run `npx xlsx2pdf-browser install` manually; or point `browserPath` at an existing browser to skip the download.

<a id="e_plugin_invalid"></a>

### E_PLUGIN_INVALID

`use()` / `option.plugins` 的插件结构非法：插件必须是对象，`markerTypes` 各项 / `fieldResolvers` 各项 / `transformModel` 必须是函数。
Invalid plugin shape passed to `use()` / `option.plugins`: a plugin must be an object; each `markerTypes` entry, each `fieldResolvers` entry and `transformModel` must be a function.

**修复 / Fix**：对照 README「扩展与二次开发」的插件契约修正结构。
Fix the shape against the plugin contract in the README "Extending" section.

与运行期码的分工：本码只管**注册期结构校验**；插件函数注册合法但运行时报错属 `E_PLUGIN_RUNTIME`（handler 抛错除外，见降级策略披露）。
Division of labor with the runtime code: this code covers **registration-time shape validation** only; a well-shaped plugin function throwing at runtime is `E_PLUGIN_RUNTIME` (except marker handlers, see the degradation policy below).

<a id="e_code_type"></a>

### E_CODE_TYPE

`helpers.generateCode(type, …)` 的 `type` 不支持（当前仅 `barcode` / `qrcode`）。
Unsupported `type` for `helpers.generateCode(type, …)` (currently `barcode` / `qrcode` only).

**修复 / Fix**：传 `barcode`（Code128）或 `qrcode`；更多码制在后续版本扩展。
Pass `barcode` (Code128) or `qrcode`; more symbologies are planned for later versions.

<a id="e_render"></a>

### E_RENDER

页面渲染或 PDF 出片失败（原始错误附在报错中，常见为 setContent 超时）；新开标签页失败（浏览器崩溃/协议超时）同样归入本码。
Page rendering or PDF generation failed (original error included; commonly a setContent timeout); failure to open a new tab (browser crash / protocol timeout) is also covered.

标签页关闭失败（如浏览器已崩溃）不会覆盖原始错误码；`option.signal` 取消引发的中断优先报 `E_CANCELLED`。
A failed tab close (e.g. the browser already crashed) never masks the original error code; interruptions caused by `option.signal` cancellation are reported as `E_CANCELLED` first.

**修复 / Fix**：按原始错误排查；模板过大时先参考 `E_SIZE_CAP` / `E_CELL_CAP` 精简模板。
Follow the original error; for oversized templates slim them down first (see `E_SIZE_CAP` / `E_CELL_CAP`).

<a id="e_plugin_runtime"></a>

### E_PLUGIN_RUNTIME

插件运行期失败：`fieldResolvers` 某项或 `transformModel` 钩子执行时抛错（报错含序号与字段上下文，原始错误附后）。取值/模型钩子失败影响整份产物，降级无意义，故快速失败；已带码错误（插件自行抛 `Xlsx2pdfError`）原样重抛不二次包装。
A plugin failed at runtime: a `fieldResolvers` entry or a `transformModel` hook threw (the message includes the index and field context, with the original error appended). Resolver/hook failures affect the whole output, so they fail fast instead of degrading; errors already carrying a code (a plugin throwing `Xlsx2pdfError` itself) are rethrown unchanged.

`markerTypes` handler 抛错**不抛本码**：单标记失败按空值降级继续渲染，告警记入返回结果 `warnings`（文案标注本码），见下方降级策略披露。
A throwing `markerTypes` handler does **not** raise this code: the single marker degrades to empty and rendering continues, with a warning (tagged with this code) recorded in the result `warnings` — see the degradation policy below.

**修复 / Fix**：按报错中的序号定位插件实现并修复；`helpers` 是调用方直调的纯函数，其运行期错误属调用方责任，不包装为本码。
Locate the plugin implementation by the index in the message and fix it; `helpers` are plain functions called directly by you, so their runtime errors are the caller's responsibility and are not wrapped into this code.

<a id="e_cancelled"></a>

### E_CANCELLED

`option.signal`（AbortSignal）已 abort：入口预检、排队中摘除、渲染中关闭标签页中断，任一检查点命中即抛本码。
`option.signal` (an AbortSignal) has been aborted: the entry pre-check, queue removal while waiting, or tab-close interruption during rendering — any checkpoint hit raises this code.

取消为**协作式尽力终止**：不保证字节级即时；已排队请求从队列摘除不占槽位，已开标签页关闭，浏览器单例保留复用；多页批量逐页检查。商业版内存准入排队（memoryAdmit）不感知 signal，其 maxWaitMs 自带超时兜底，放行后的预检会拦截已取消请求。
Cancellation is **cooperative best-effort**: no byte-level immediacy is guaranteed; queued requests are removed without holding a slot, open tabs are closed, and the shared browser instance stays alive for reuse; multi-page batches are checked per page. The Pro memory-admission queue (memoryAdmit) does not observe the signal (its own maxWaitMs bounds the wait); the post-admission pre-check still rejects an already-cancelled request.

**修复 / Fix**：预期行为，无需修复；需要产物时不取消或重新发起生成。
Expected behavior, nothing to fix; generate again without aborting if the output is needed.

---

## 降级策略披露 / Degradation policy

并非所有失败都抛错：影响范围限于单个标记/图片的失败按空值降级继续渲染，告警同时输出到 console 与返回结果的 `warnings: string[]`（逐次生成独立，无降级时为空数组）；影响整份产物的失败才抛错。
Not every failure throws: failures scoped to a single marker/image degrade to empty and rendering continues, with warnings emitted to both the console and the result `warnings: string[]` (per-call, empty when nothing degraded); only failures affecting the whole output throw.

| 场景 Scenario                                                                  | 行为 Behavior                                         |
| :----------------------------------------------------------------------------- | :---------------------------------------------------- |
| 图片内容损坏/非图片（base64/远程/本地，按魔数与结构校验，不盲信 content-type） | 降级清除标记 + warning                                |
| 图片文件读取失败 / 不支持的图片值                                              | 降级清除标记 + warning                                |
| 浏览器内图片解码失败                                                           | 按原样打印（可能空白/破图）+ warning                  |
| `markerTypes` handler 抛错                                                     | 降级清除标记 + warning（文案标注 `E_PLUGIN_RUNTIME`） |
| `fieldResolvers` / `transformModel` 抛错                                       | 抛 `E_PLUGIN_RUNTIME`（已带码原样重抛）               |
| 模板读取/解析、下载、纸张、护栏、渲染类失败                                    | 抛对应稳定码（见码表）                                |

| Scenario                                                                                                                         | Behavior                                                      |
| :------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------ |
| Corrupt / non-image content (base64 / remote / local, validated by magic bytes and structure, never trusting content-type alone) | Degrade: marker cleared + warning                             |
| Image file read failure / unsupported image value                                                                                | Degrade: marker cleared + warning                             |
| In-browser image decode failure                                                                                                  | Printed as-is (may be blank/broken) + warning                 |
| A `markerTypes` handler throws                                                                                                   | Degrade: marker cleared + warning (tagged `E_PLUGIN_RUNTIME`) |
| A `fieldResolvers` / `transformModel` throws                                                                                     | Throws `E_PLUGIN_RUNTIME` (coded errors rethrown unchanged)   |
| Template load/parse, download, paper, guardrail, rendering failures                                                              | Throw the corresponding stable code (see the table)           |
