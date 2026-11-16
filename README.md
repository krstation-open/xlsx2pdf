# xlsx2pdf

[English](./README.md) | [简体中文](./README.zh-CN.md)

Lay out a document in Excel, drop in `${...}` markers, and let your backend fill in the data to get a PDF.

A Node.js server-side library that goes Excel template → marker substitution → HTML → headless Chrome print. No Office or LibreOffice needed, and no hand-written HTML. Apache-2.0, free for commercial use.

[![npm](https://img.shields.io/npm/v/xlsx2pdf)](https://www.npmjs.com/package/xlsx2pdf)
[![downloads](https://img.shields.io/npm/dw/xlsx2pdf)](https://www.npmjs.com/package/xlsx2pdf)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
![node](https://img.shields.io/badge/node-%3E%3D18.17-green)

**Official website**: [https://www.krstation.com/](https://www.krstation.com/)

## Contents

- [Quick start](#quick-start)
- [What it's for](#what-for)
- [Why xlsx2pdf](#why)
- [Features (community edition)](#features)
- [Detailed usage](#usage)
- [Marker syntax](#markers)
- [Community vs Pro](#compare)
- [Feature list and status](#status)
- [Deployment](#deploy)
- [Extensions](#extend)
- [API](#api)
- [Known limits and FAQ](#faq)
- [Maintenance and versioning](#maintenance)
- [Feedback and Pro](#feedback)
- [Contributing](#contributing)
- [License](#license)

---

<a id="quick-start"></a>

## Quick start

> The first `npm i` triggers a postinstall download of the bundled Chrome (~150MB, mirror-friendly). On a slow network this can take a while — it isn't stuck. If the server already has Chrome/Chromium, set `browserPath` to skip the download (see [Deployment](#deploy)).

```bash
npm i xlsx2pdf
```

Write `${name}` in a cell of `tpl.xlsx`, then:

```javascript
import { excel2pdf } from 'xlsx2pdf';
import { writeFileSync } from 'node:fs';

const { pdf } = await excel2pdf({
  template: './tpl.xlsx',
  data: { name: 'Alice' },
});

// pdf is a Buffer — write it to a file or return it as an HTTP response
writeFileSync('out.pdf', pdf);
```

Merged cells, fonts, backgrounds, borders, number formats and page setup are all preserved.

---

<a id="what-for"></a>

## What it's for

The short version: fixed templates, batch output — invoices, receipts, certificates, labels, statements, reports, and fixed-format reports. Business users lay things out in Excel, your backend fills in JSON data, and out comes a PDF. Along the way it renders an HTML that looks basically like what Excel shows; if you want to preview or post-process that, `excel2html()` gives you the HTML on its own.

A few things it doesn't do:

- It's not a general converter. Templates need placeholder markers; you can't feed it an arbitrary xlsx.
- It's not a report designer. Layout happens in Excel, not drag-and-drop in a browser.
- It's not a PDF editor. It generates; it doesn't merge, watermark, or otherwise post-process.

If all you want is to turn any xlsx into a PDF as-is, LibreOffice or a dedicated converter is a better fit.

---

<a id="why"></a>

## Why xlsx2pdf

A few things we value about it: the template is just plain Excel, so business users don't have to learn a new tool; nothing native to compile and no Office dragged in on install; rendering goes through Chrome, so output is consistent across Windows / Linux / macOS; the fiddly bits that usually break — merged cells, rich text, numFmt — are handled and tested; and marker types, field resolvers and model hooks are all extensible.

We should also be clear about the community edition's limits: column width uses a public-formula approximation, and for layouts that are extremely precision-sensitive, Pro offers pixel-accurate column width and single-page auto-fit. It's just a Node.js library — to use it from another language, run a small Node service and call it over HTTP, or hang a Node sidecar off your app.

---

<a id="features"></a>

## Features (community edition)

- **Native Excel templates**: plain `.xlsx`, editable in Excel / WPS / LibreOffice
- **Marker substitution**: `${field}`, nested dot paths `${a.b.c}`, defaults `${field|text_default:N/A}`
- **In-cell mixing**: multiple markers mixed with static text in one cell, each segment substituted independently and inheriting its local rich-text formatting
- **Style fidelity**: merged cells, font / color / background / borders, in-cell rich text
- **Number-format inheritance**: percent / currency / thousands / date automatically (e.g. `¥#,##0.00` → `¥1,234.50`)
- **Template-owned page setup**: standard paper A3/A4/A5/B4/B5/letter/legal, orientation & margins decided by the template — changing paper needs no code change
- **Rich-media markers (built-in since 1.1.0)**: `${photo|image}`, `${code|barcode}` (Code128), `${qr|qrcode}`; local path / http(s) URL / base64 DataUrl; overlay params `w/h/ox/oy/zindex/opacity`; unset size auto-normalized to original dimensions
- **Detail-row index mapping**: `${#items.name}` repeated per row, the engine takes successive array indices (`items.0`, `items.1`…); row count fixed by the template, nested fields & numFmt inheritance supported
- **Bundled headless Chrome**: no external Office engine, consistent rendering
- **Lightweight preview**: `excel2html()` outputs HTML only, no browser launch
- **Extensible**: three extension points (marker types / field resolvers / model hooks), custom `markerRegex` / `markerSeparator`
- **Engineering**: ESM / CJS dual mode + TypeScript declarations, built-in template-size / cell-count safety caps

---

<a id="usage"></a>

## Detailed usage

### 1. Design the template

Lay out the document in Excel and put markers where dynamic data goes:

| Cell | Content                       |
| :--- | :---------------------------- |
| A1   | Name                          |
| B1   | `${name}`                     |
| A2   | Amount                        |
| B2   | `${amount}`                   |
| A3   | Remark                        |
| B3   | `${remark\|text_default:N/A}` |

> The `\|` in the table is just escaping for the Markdown column separator. In an Excel cell you actually write `${remark|text_default:N/A}`, without the backslash. Same for the marker-syntax tables below.

### 2. Call it

```javascript
import { excel2pdf } from 'xlsx2pdf';

const { pdf } = await excel2pdf({
  template: './tpl.xlsx',
  data: { name: 'Zhang San', amount: 1234.5, remark: 'Urgent' },
});
```

If the amount cell has the `¥#,##0.00` format, the output shows `¥1,234.50` automatically — number formats need no marker params.

### 3. Output

`pdf` is a Buffer: write it to a file, return it as an HTTP response, or upload it to object storage:

```javascript
import { writeFileSync } from 'node:fs';

// write to a file
writeFileSync('out.pdf', pdf);

// Express response
res.setHeader('Content-Type', 'application/pdf');
res.send(pdf);
```

---

<a id="markers"></a>

## Marker syntax

Marker format: `${field|type_param1_param2…}`. The `|` and everything after it can be omitted; omitted means text (`text`). Fields support `a.b`, `a.0.b` dot paths into nested objects / arrays; multiple params are joined with `_`.

### Built-in types

| Type      | Meaning                                                                                                                                                                                    | Example                      |
| :-------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------- |
| `text`    | text substitution (default type, may be omitted)                                                                                                                                           | `${name}` or `${name\|text}` |
| `image`   | image embedding, `img` is an alias; value is a local path / http(s) URL / base64 DataUrl; unset size normalizes to original dimensions, setting one side derives the other by aspect ratio | `${photo\|image_w120_h40}`   |
| `barcode` | barcode (Code128); value is the text to encode                                                                                                                                             | `${code\|barcode_w200_h60}`  |
| `qrcode`  | QR code; value is the text to encode                                                                                                                                                       | `${qr\|qrcode_w80_h80}`      |

The `watermark` (text watermark) marker type is a Pro capability; in the community edition it raises an explicit guidance error rather than silently rendering as text. A custom handler can still return a watermark overlay — see [Extensions](#extend).

### Parameter keys

Image / barcode / QR share these keys (joined with `_`, e.g. `image_w120_h40_ox5`):

| Key       | Example      | Meaning                                                                                                                                                                                                |
| :-------- | :----------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `w`       | `w120`       | width px. For image/img, unset normalizes to original dimensions (@96DPI); with only one of `w`/`h` set, the other follows the original aspect ratio. barcode/qrcode are generated images, default 100 |
| `h`       | `h40`        | height px; same unset rules as `w`; barcode/qrcode default 20                                                                                                                                          |
| `ox`      | `ox5`        | horizontal offset px (default 0)                                                                                                                                                                       |
| `oy`      | `oy3`        | vertical offset px (may be negative, default 0)                                                                                                                                                        |
| `zindex`  | `zindex2`    | z-index: 0 same layer as template, negative below, positive above, stackable; non-zero is treated as a pure overlay — does not stretch the row height, overflow still shows                            |
| `opacity` | `opacity0.5` | opacity 0~1 (same as CSS `opacity`, 0.5 = semi-transparent); values >1 are treated as a percentage for backward compatibility (`opacity50` → 0.5), out-of-range clamped to bounds                      |

> Community size normalization is pure-JS probing (image-size, no compression); automatic image compression and DPI-aware physical sizing are in Pro. `minsize` (the font-shrink floor) depends on Pro's single-page auto-fit and has no effect here; `lineheight` only affects watermark-overlay line height, and the built-in `watermark` type is Pro.

### Default values

Append `_default:xxx` (synonym aliases `_默认:xxx` / `_dft:xxx`) at the end of a marker; it applies when the field is empty. The default must come last in the param string:

```
${remark|text_default:N/A}
${photo|image_w120_h40_默认:./placeholder.png}
```

There is also a global default `option.defaults` (see [API](#api)), with lower priority than the marker-level default. Resolution order: **data → marker-level default → `option.defaults`**.

### Number-format inheritance (numFmt)

If the marker's cell has a non-General number format, injected numbers / dates render in that format; **static number / date cells with no marker also render in their format** — both match what Excel shows when you type the value directly, with no marker params needed:

| Template cell format | Injected value     | Rendered result                                 |
| :------------------- | :----------------- | :---------------------------------------------- |
| `0.00%`              | `0.1234`           | `12.34%`                                        |
| `¥#,##0.00`          | `1234567.8`        | `¥1,234,567.80`                                 |
| `#,##0.00`           | `1234567.8`        | `1,234,567.80`                                  |
| `yyyy-mm-dd`         | `45000` or JS Date | `2023-03-15`                                    |
| `yyyy/mm/dd;@`       | `45000`            | `2023/03/15` (the `;@` text section is ignored) |
| General / no format  | any                | output as-is                                    |

Rules:

- Only number / JS Date / parseable numeric strings are formatted; non-numeric text like names is output as-is and never mis-formatted.
- A common subset is supported: percent, currency symbols, thousands separators, decimal control, positive/negative/zero sections, date-time tokens (including 12-hour AM/PM and `[h]` elapsed). Rare formats (fractions, scientific notation, conditional sections) fall back to as-is output and never throw.
- Multi-section formats (`pos;neg;zero;text`) pick a section by the value's sign; the `;@` text section common in Chinese Excel/WPS date formats never leaks into the output.
- Image markers are unaffected; a custom marker-type handler can read the cell format via `ctx.numFmt` and reuse the same formatter with `helpers.formatValue(value, fmt)`.

### Nested and detail-row data

Field resolution flattens nested objects / arrays into dot paths, so any depth can be referenced directly:

```javascript
const data = {
  report: {
    title: 'Inspection report',
    lab: { name: 'Some Lab Co., Ltd.', contact: { phone: '0755-00000000' } }, // 4 levels deep
  },
  items: [{ spec: 'dia 22' }, { spec: 'dia 25' }], // array of objects
};
```

| Template marker               | Resolved value    | Note                                |
| :---------------------------- | :---------------- | :---------------------------------- |
| `${report.title}`             | Inspection report | 2 levels                            |
| `${report.lab.contact.phone}` | 0755-00000000     | 4 levels                            |
| `${items.0.spec}`             | dia 22            | array index from 0                  |
| `${#items.spec}`              | dia 22 → dia 25   | detail-row index mapping, see below |

`#array.field` is for detail rows: repeat the same marker per row in the template (one row per item); each occurrence takes the next array item (index increments from 0). Dot paths combine freely with params / defaults, e.g. `${#items.spec|text_default:--}`.

### Custom marker syntax (markerRegex / markerSeparator)

The default recognizes `${...}`; a custom regex can replace it (the internal `field|type_params` structure is unchanged):

```javascript
// per-call (this generation only, takes precedence over global): template writes {{name|text_default:--}}
await excel2pdf({ template, data, option: { markerRegex: /\{\{([^}]+)\}\}/g } });

// global default
configure({ markerRegex: /\{\{([^}]+)\}\}/g });
configure({ markerRegex: null }); // restore built-in ${...}
```

Regex contract: must have the `g` flag; **capture group 1 = the marker's inner content** (`field|type_params`), `match[0]` = the full marker text (used for replacement). Invalid regex throws directly — it never silently skips substitution. Under a custom syntax the built-in `${...}` is no longer recognized and is left as-is; the two syntaxes do not coexist.

The internal separator is also customizable (`markerSeparator`, default vertical bar `|`):

```javascript
// per-call: template writes {{name::text_default:--}}
await excel2pdf({
  template,
  data,
  option: { markerRegex: /\{\{([^}]+)\}\}/g, markerSeparator: '::' },
});

configure({ markerSeparator: '::' }); // global default
configure({ markerSeparator: null }); // restore built-in vertical bar
```

The separator splits at its first occurrence only; the type / param / default parsing after it is unchanged. Precedence: per-call option > configure global > built-in default.

### Data-structure boundaries

The community edition supports **single-record** injection and built-in **#array.field detail-row index mapping**:

```javascript
// ✅ single record + nested object
data: { name: 'Alice', customer: { city: 'Shanghai' } }

// ✅ detail rows: repeat ${#items.name} per row in the template; engine takes items.0 / items.1 / items.2…
data: { items: [{ name: 'A' }, { name: 'B' }] }

// ❌ no dynamic loop auto-expanding one marker row into N rows (row count fixed by template; reserve enough repeated rows)
// ❌ no multi-page batch via a data array (Pro capability)
```

Detail-row count is fixed by the template: extra rows are cleared when data is shorter, and markers are cleared for an empty array. To emit many pages from one template (`data` as an array), use Pro's array batch. With `data` omitted, one empty-template page is rendered (markers cleared by default / empty value).

---

<a id="compare"></a>

## Community vs Pro

The community edition can take a single text / rich-media report all the way through on its own — it's not a feature-cut trial. Pro is mainly for batch, high-concurrency, and production cases that are especially picky about layout precision. Both use the same rendering pipeline.

| Capability                                                         |            Community            |                      Pro                       |
| :----------------------------------------------------------------- | :-----------------------------: | :--------------------------------------------: |
| Single-document text / rich-media reports                          |               ✅                |                       ✅                       |
| Image / QR / barcode basic embedding                               |               ✅                |                       ✅                       |
| Automatic image compression + DPI-aware sizing                     |               ❌                |                       ✅                       |
| autoInsertImage / watermark markers                                |               ❌                |                       ✅                       |
| Detail-row index mapping (#array.field)                            |               ✅                |                       ✅                       |
| Array multi-page batch (data array → N pages)                      |               ❌                |                       ✅                       |
| Single-page auto-fit (overflow converges to one page, no clipping) |               ❌                |                       ✅                       |
| Column-width precision                                             |  public-formula approximation   | pixel-accurate conversion + font-missing guard |
| Custom paper (receipt rolls) direct read                           |               ❌                |                       ✅                       |
| Landscape WPS / Clodop (a browser print control) print adaptation  |               ❌                |                       ✅                       |
| Concurrency / memory-admission guard                               |    fixed single concurrency     |      parameterized production guardrails       |
| Custom extensions (3 points + custom syntax)                       |               ✅                |                       ✅                       |
| License                                                            | Apache-2.0, free commercial use |                commercial EULA                 |

The "single-page auto-fit" row deserves a plain explanation: in the community edition, content that overflows goes through native Chrome pagination and may clip or span pages. Pro's single-page auto-fit, when data is too long and would otherwise overflow, automatically adjusts font size and row height to fit everything onto one page — no clipping, no lost data. This matters a lot for "must be one page" cases like shipping labels and fixed invoices.

**Pro consulting / free POC**: send 3 of your real templates; within 48 hours we return Pro output and a benchmark comparison report. 📧 business@krstation.com

---

<a id="status"></a>

## Feature list and status

Every feature in one table, with a checkbox for implementation status: ☑ implemented (carrying the version it landed in), ☐ not yet implemented (no version shown — subject to actual releases). Pro-only capabilities are listed by effect name at the end of this section; per-version details are in [CHANGELOG.md](./CHANGELOG.md).

| Feature                                                                                               | Status | Since | Note                                                                          |
| :---------------------------------------------------------------------------------------------------- | :----: | :---- | :---------------------------------------------------------------------------- |
| `excel2pdf` / `excel2html` dual outlets                                                               |   ☑    | 1.0.0 | one-stop PDF generation / HTML-only render, no browser launch                 |
| Marker substitution: basic fields / nested dot paths / marker defaults / in-cell multi-segment mixing |   ☑    | 1.0.0 | each segment substituted independently, inheriting local rich-text formatting |
| Style fidelity: merged cells / font / color / background / borders / in-cell rich text                |   ☑    | 1.0.0 | merged-region outer borders take the union of edge cells                      |
| numFmt number-format inheritance                                                                      |   ☑    | 1.0.0 | both marker cells and static number/date cells render in their format         |
| Standard paper / orientation / margins (template-owned)                                               |   ☑    | 1.0.0 | A3/A4/A5/B4/B5/letter/legal                                                   |
| Bundled headless Chrome / external browser reuse                                                      |   ☑    | 1.0.0 | browserPath, XLSX2PDF_BROWSER_PATH, download can be skipped                   |
| Three extension points + two registration levels                                                      |   ☑    | 1.0.0 | markerTypes / fieldResolvers / transformModel; use / option.plugins           |
| Custom marker syntax                                                                                  |   ☑    | 1.0.0 | markerRegex / markerSeparator                                                 |
| helpers utility namespace                                                                             |   ☑    | 1.0.0 | grew to 7 in 1.1.0 (added generateCode / bufferToDataUrl)                     |
| ESM / CJS dual output + TypeScript declarations                                                       |   ☑    | 1.0.0 |                                                                               |
| Template-size / cell-count safety caps                                                                |   ☑    | 1.0.0 | 5MB / 20000 cells, fixed values                                               |
| image / img markers                                                                                   |   ☑    | 1.1.0 | local path / http(s) URL / base64 DataUrl                                     |
| barcode (Code128) / qrcode markers                                                                    |   ☑    | 1.1.0 | PNG generated by bwip-js                                                      |
| Overlay params w/h/ox/oy/zindex/opacity                                                               |   ☑    | 1.1.0 | shared by image / barcode / QR                                                |
| Pure-JS image size normalization                                                                      |   ☑    | 1.1.0 | unset size normalizes to original dimensions @96DPI; no compression           |
| Detail-row index mapping `#array.field`                                                               |   ☑    | 1.2.0 | row count fixed by the template, not a dynamic loop                           |
| Examples directory + `npm run example` one-shot output                                                |   ☐    |       |                                                                               |
| CLI (`xlsx2pdf convert`)                                                                              |   ☐    |       |                                                                               |
| Stable error codes + bilingual messages + error reference doc                                         |   ☐    |       |                                                                               |
| GitHub Actions CI + status badges                                                                     |   ☐    |       |                                                                               |
| Multi-worksheet selection (`option.sheet`)                                                            |   ☐    |       |                                                                               |
| Hidden row / column filtering                                                                         |   ☐    |       |                                                                               |
| Reading images already embedded in the template                                                       |   ☐    |       |                                                                               |
| Hyperlinks → clickable PDF links                                                                      |   ☐    |       |                                                                               |
| Text rotation / indent                                                                                |   ☐    |       |                                                                               |
| More barcode symbologies (EAN13 / Code39 etc.) + QR error-correction level                            |   ☐    |       |                                                                               |
| Print area / repeating title rows                                                                     |   ☐    |       |                                                                               |
| Header / footer / page numbers                                                                        |   ☐    |       |                                                                               |
| TS type exports for plugin context and model                                                          |   ☐    |       |                                                                               |
| Static template validation `validateTemplate`                                                         |   ☐    |       |                                                                               |
| Render event hook (stage / timing observability)                                                      |   ☐    |       |                                                                               |
| Official plugin examples (date formatting / enum mapping / i18n / uppercase amount)                   |   ☐    |       |                                                                               |
| Browser idle auto-reclaim                                                                             |   ☐    |       |                                                                               |
| Template parse caching                                                                                |   ☐    |       |                                                                               |
| URL-fetch safety options (allowlist / timeout / size cap)                                             |   ☐    |       |                                                                               |
| Official Docker image                                                                                 |   ☐    |       |                                                                               |

### Pro-only (not in the community edition)

Automatic image compression + DPI-aware sizing, autoInsertImage, watermark markers, array multi-page batch, single-page auto-fit convergence, pixel-accurate column width + font-missing guard, custom paper direct read, landscape print-control adaptation, precise scaling, parameterized concurrency / memory guardrails. Effect-level comparison in [Community vs Pro](#compare).

---

<a id="deploy"></a>

## Deployment

### Platform support

The bundled Chrome is downloaded for whichever OS you're on — Windows, macOS (Intel and Apple Silicon) and Linux are all supported; postinstall detects the platform automatically, so there's no version to pick by hand. This is a separate Chrome downloaded into the package — independent of any Chrome you already have installed, and it does not reuse your local Chrome by default; to use an existing local Chrome/Chromium instead, set `browserPath` (or the `XLSX2PDF_BROWSER_PATH` env var) and skip the download (see "Reuse system Chromium" below). For local development on Windows / macOS, `npm i` is all you need — no extra system dependencies (the system libraries below only concern Linux servers).

Downloads go through the npmmirror mirror (builds available for every platform) with up to 5 automatic retries; the build lands inside the package at `node_modules/xlsx2pdf/browsers/` (resolved relative to the package itself, independent of cwd), and the Chrome version is pinned by puppeteer-core. A postinstall download failure does not abort `npm i` — you can install later with `npx xlsx2pdf-browser install` or `await ensureBrowser()` in code.

### System dependencies

Bundled headless Chrome (~150MB), auto-downloaded on postinstall. Linux servers need Chrome's system libraries: the install script probes missing libs via `ldd` and `apt-get` installs them (requires root or passwordless sudo), choosing `libasound2` / `libasound2t64` by distro; without permission it prints the manual command and does not interrupt. Common dependencies (Debian 12 example below; on Ubuntu 24.04 replace `libasound2` with `libasound2t64`):

```bash
apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libgbm1 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libpango-1.0-0 libpangocairo-1.0-0 libcairo2 libxshmfence1 libasound2
```

### Docker example

The `libasound2` package name differs by distro (Debian 12: `libasound2`; Ubuntu 24.04 / Debian trixie: `libasound2t64`). The fallback below avoids a copy-paste install failure on newer images:

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

### Reuse system Chromium

To skip the bundled Chrome download, configure `browserPath`:

```javascript
import { configure } from 'xlsx2pdf';

configure({ browserPath: '/usr/bin/chromium' });
```

Browser resolution precedence: `configure({ browserPath })` > the `XLSX2PDF_BROWSER_PATH` env var > the bundled Chrome in the package's `browsers/`; if none is found it throws and guides you to install. Paths resolve relative to the package itself, independent of process cwd. To install after skipping: `npx xlsx2pdf-browser install [--force]` or `await ensureBrowser({ force: true })` in code (idempotent; skips in seconds if already present).

### Safety caps (defaults)

| Item               | Default | Note                                                                                |
| :----------------- | :------ | :---------------------------------------------------------------------------------- |
| Template size      | 5MB     | reject beyond cap                                                                   |
| Cell count         | 20000   | actual rows×cols; reject beyond cap (streaming pre-check rejects early before load) |
| Render concurrency | 1       | max simultaneously open tabs; excess queued                                         |

These three are fixed defaults in the community edition and are not parameterized; guardrail parameterization such as `maxCells` / `maxTemplateSize` / `maxConcurrency` / `memoryGuard` is a Pro capability; passing them via option in the community edition raises an explicit guidance error (configure silently ignores them instead — see [API](#api)). Remote resources (template URL / image URL) download with a 30-second timeout and a 20MB size cap; failures throw a Chinese error prefixed `[xlsx2pdf]` with the URL attached.

---

<a id="extend"></a>

## Extensions

> Since 1.0 the extension-point API is considered stable; breaking changes go through a major version.

Three extension points, two registration levels: global `use(plugin)` (process-wide) / per-call `option.plugins` (this generation only, same-name overrides global, avoiding multi-tenant concurrency pollution). Where they sit in the pipeline:

```
template xlsx → marker regex matching (customizable)
         → ② field resolution (fieldResolvers → flat lookup → marker default → option.defaults)
         → ① marker-type handler rendering (built-in text/image/img/barcode/qrcode + custom)
         → image size normalization (community pure JS, no compression) → WorksheetModel
         → ③ model post-processing hook → HTML rendering → PDF
```

```javascript
import { use } from 'xlsx2pdf';

use({
  name: 'my-plugin',
  // ① custom marker type: ${code|upper} → uppercase text
  markerTypes: {
    upper: async (value) => String(value ?? '').toUpperCase(),
  },
  // ② field resolver: first non-undefined hit wins, else falls back to data/defaults
  fieldResolvers: [async (field) => (field === 'now' ? new Date().toISOString() : undefined)],
  // ③ model hook: last chance to mutate the model before render
  transformModel: (model) => model,
});
```

### ① Custom marker types

Handler signature: `async (value, option, ctx) => result`.

**value resolution chain** (done automatically before the handler): call registered `fieldResolvers` in order (first non-`undefined` hit) → flat dot-path lookup → marker-level default → `option.defaults`. The handler only renders; it does not resolve values itself.

**ctx fields**:

| Field         | Type     | Meaning                                                                                                                                      |
| :------------ | :------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| `data`        | `object` | the full data object for this generation (unflattened original structure; read nested values directly via `ctx.data.a.b`)                    |
| `field`       | `string` | marker field name (`#array` syntax already expanded to an indexed dot path, e.g. `items.0.spec`)                                             |
| `row` / `col` | `number` | cell row / column number (1-based)                                                                                                           |
| `imageCache`  | `Map`    | image cache for this generation (key = type\|width\|height\|value); custom image handlers can reuse it to avoid repeated download / encoding |
| `numFmt`      | `string` | the cell's number format, paired with `helpers.formatValue` to reuse numFmt rendering                                                        |

**option fields** (parsed result after the marker's `|`): `type` (type name), `width` / `height` / `offsetX` / `offsetY` / `zIndex` / `opacity` / `minSize` / `lineHeight` (numeric params like `w120_h40`), `defaultValue` (`_default:` / `_默认:` / `_dft:`); other `key:value` custom pairs pass through as-is (e.g. `format:YYYY年` → `option.format`).

**Return contract**:

| Return value                                                                        | Behavior                                                                                                                                                                                                         |
| :---------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `string`                                                                            | text substitution (same as text)                                                                                                                                                                                 |
| `number` / `boolean`                                                                | rendered as text (`String(value)`)                                                                                                                                                                               |
| `{ images: [{ dataUrl, width?, height?, offsetX?, offsetY?, zIndex?, opacity? }] }` | image overlay; unset or 0 `width`/`height` normalizes to original dimensions / aspect ratio (same as built-in image `w`/`h`); `zIndex`/`opacity` follow the same stacking rules as built-in image / barcode / QR |
| `{ watermarks: [{ text, zIndex?, opacity?, minSize?, lineHeight? }] }`              | text-watermark overlay (width follows the cell, height unbounded); the built-in `watermark` marker type is Pro, but watermarks returned by a custom handler render in the community edition                      |
| `{ text, images, watermarks }`                                                      | mixed                                                                                                                                                                                                            |
| `null` / `undefined`                                                                | treated as empty (clears the marker)                                                                                                                                                                             |

A throwing handler does not abort generation: after printing an `[engine]` error to the console, that marker is cleared as empty and the rest proceed normally. A type with the same name as a built-in overrides it (with a warning).

```javascript
import { use, helpers } from 'xlsx2pdf';

use({
  markerTypes: {
    // template writes ${signTime|datefmt_format:YYYY年MM月} (custom pairs pass into option)
    datefmt: (value, option) => helpers.formatValue(value, option.format),
    // custom "seal image" type: read path / URL / base64 uniformly, then embed
    seal: async (value, option) => {
      if (!value) return null; // empty value clears the marker
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

### ② Custom field resolvers

Signature `async (field, data, ctx) => value` (ctx as above; `field` already has `#array` expanded). Called in order; the first non-`undefined` return wins; if none hit, it falls back to the built-in chain (flat lookup → marker default → `option.defaults`). Use for computed fields, async data sources (database / RPC), or cross-field derived values.

```javascript
use({
  fieldResolvers: [
    async (field, data) => (field === 'fullName' ? `${data.firstName}${data.lastName}` : undefined),
    async (field) => (field.startsWith('db.') ? await fetchFromDb(field) : undefined), // async data source
  ],
});
```

### ③ Model post-processing hook

Called in registration order after the engine produces the WorksheetModel and before render; you can tweak cell text / styles / row heights / column widths (returning a new model replaces it, in-place mutation returning void also works; hook ctx = `{ data, option }`).

**WorksheetModel main fields** (the hook's `model` argument):

| Field                        | Type                        | Meaning                                                                        |
| :--------------------------- | :-------------------------- | :----------------------------------------------------------------------------- |
| `cells`                      | `CellModel[]`               | cells (only those with content / styling)                                      |
| `columnWidths`               | `number[]`                  | column widths px (index = column number - 1)                                   |
| `rowHeights`                 | `number[]`                  | row heights px (index = row number - 1)                                        |
| `columnWidthUnits`           | `number[]`                  | original Excel character-width column units                                    |
| `merges`                     | `{top,bottom,left,right}[]` | merged regions (row/col 1-based)                                               |
| `columnCount`                | `number`                    | column count                                                                   |
| `totalWidth` / `totalHeight` | `number`                    | table total width / height px                                                  |
| `pageSetup`                  | `object`                    | template page setup `{ orientation, pageSize, paperSizeCode, scale, margins }` |
| `defaultFont`                | `{name,size} \| null`       | workbook default font (column-width conversion basis)                          |

**CellModel main fields**: `row` / `col` (1-based), `text`, `images` (embedded image array), `segments` (rich-text segment styles; when present the renderer outputs independent spans per segment), `font: { bold, size, color, italic, underline, strike }`, `alignment: { horizontal, vertical, wrapText, shrinkToFit }`, `border` (ExcelJS style, with top/bottom/left/right), `fill: { fgColor }`, `rowspan` / `colspan`.

```javascript
use({
  transformModel: (model) => {
    for (const cell of model.cells) {
      if (cell.text === '机密') cell.font.color = 'FFFF0000'; // change text color (ARGB)
    }
    return model; // returning void also works (in-place mutation)
  },
});
```

### Internal utilities (helpers)

Engine-homologous utilities are exposed under the `helpers` namespace (`import { helpers } from 'xlsx2pdf'`) — the same implementation the engine uses internally, so behavior never drifts:

| Method                | Signature                                              | Meaning                                                                                                                               |
| :-------------------- | :----------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| `getFileBuffer`       | `(source) → Promise<Buffer>`                           | local path / http(s) URL / base64 (incl. Data URL) → Buffer; shared by templates and images                                           |
| `flattenObject`       | `(obj, prefix?) → flatObj`                             | flatten nested objects / arrays into dot-path keys, same rules as engine resolution (preview the keys a marker can reference)         |
| `parseMarkerOption`   | `(optionStr?, knownTypes?) → option`                   | parse the option string after the vertical bar (e.g. `text_w100_默认:--`), same rules as the engine                                   |
| `validateMarkerRegex` | `(regex) → void`                                       | validate the custom marker regex contract (g flag + capture group 1); throws on violation                                             |
| `formatValue`         | `(value, fmt?) → string`                               | render a value in an Excel number format (same implementation as numFmt inheritance); unsupported formats / errors fall back to as-is |
| `generateCode`        | `(type, text, { width?, height? }) → Promise<dataUrl>` | barcode `'barcode'` (Code128) / QR `'qrcode'` text → base64 image, same as the built-in types                                         |
| `bufferToDataUrl`     | `(buffer, extension) → dataUrl`                        | Buffer → base64 Data URL                                                                                                              |

---

<a id="api"></a>

## API

| Function        | Signature                                                               | Description                                                                                                                                            |
| :-------------- | :---------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `excel2pdf`     | `({ template, data, option }) → Promise<{ pdf: Buffer, html: string }>` | one-stop generation: template parse → HTML render → headless Chrome print PDF                                                                          |
| `excel2html`    | `({ template, data, option }) → Promise<{ html: string }>`              | same params as excel2pdf; template parse + HTML render only, no browser launch                                                                         |
| `configure`     | `(option?) → Readonly<BrowserOptions>`                                  | global browser behavior & marker syntax (module-level singleton); returns the effective config                                                         |
| `ensureBrowser` | `(option?) → Promise<string>`                                           | ensure the bundled browser is ready (idempotent; `{ force: true }` reinstalls); returns the executable path                                            |
| `closeBrowser`  | `() → Promise<void>`                                                    | close the reused singleton browser (usually on process exit)                                                                                           |
| `use`           | `(plugin) → void`                                                       | register an extension plugin globally (three points, see [Extensions](#extend))                                                                        |
| `helpers`       | namespace                                                               | extension-development utilities (engine-homologous, see [Extensions](#extend))                                                                         |
| `getVersion`    | `() → string`                                                           | current package version (read at runtime from the install dir's package.json, cached after first call; falls back to `'unknown'` if missing / corrupt) |

### excel2pdf parameters

| Param      | Type               | Meaning                                                                                                                                                                           |
| :--------- | :----------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `template` | `string \| Buffer` | template path / http(s) URL / Buffer (required)                                                                                                                                   |
| `data`     | `object`           | data object, supports nested / array flattened lookup; omitted renders one empty-template page. An array (multi-page batch) is Pro; the community edition throws a guidance error |
| `option`   | `GenerateOptions`  | configuration, see table below                                                                                                                                                    |

### option (community edition)

| Param             | Type                                              | Default                                         | Meaning                                                                                                                                             |
| :---------------- | :------------------------------------------------ | :---------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pageSize`        | `'A3'\|'A4'\|'A5'\|'B4'\|'B5'\|'letter'\|'legal'` | template pageSetup                              | named standard paper; custom paper `{width,height}` (receipt rolls) is Pro. An unknown named paper throws directly, never silently falls back to A4 |
| `orientation`     | `'portrait' \| 'landscape'`                       | template                                        | page orientation                                                                                                                                    |
| `margin`          | `{ top?, right?, bottom?, left? }`                | Excel built-in defaults when template sets none | page margins mm, merged field by field; built-in defaults top/bottom 19.1, left/right 17.8mm                                                        |
| `defaults`        | `Record<string, unknown>`                         | `{}`                                            | global per-field fallback values, see example below                                                                                                 |
| `plugins`         | `Plugin[]`                                        | `[]`                                            | per-call extensions, this generation only, same-name overrides global `use()`                                                                       |
| `markerRegex`     | `RegExp` (g flag + capture group 1)               | built-in `${...}`                               | custom marker matching, takes precedence over configure global                                                                                      |
| `markerSeparator` | `string`                                          | `'\|'`                                          | the internal "field / type_params" separator, takes precedence over configure global                                                                |

Page-setup params (pageSize / orientation / margin) precedence: **per-call option > template pageSetup > Excel built-in defaults**. Pro-only option keys (`fitToPage` / `minFontSize` / `scale` / `pageRotate` / `fontGuard` / `maxCells` / `maxTemplateSize` / `maxConcurrency` / `memoryGuard` / `emptyRowPlaceholders`) raise an explicit guidance error when passed in the community edition; unknown option keys are likewise rejected (a typo is never silently ignored). Note: configure silently ignores the same guardrail keys rather than throwing — see configure(option) below for why.

`defaults` is a global fallback: when `data` lacks a field and that marker has no default, the same-named value in `defaults` is used. Resolution order is **data → marker-level default → `option.defaults`**:

```javascript
await excel2pdf({
  template: './tpl.xlsx',
  data: { name: 'Zhang San' },
  // remark / amount not provided in data, and no default in the template markers → fall back to these
  option: { defaults: { remark: 'N/A', amount: 0 } },
});
```

### configure(option)

Configure browser behavior and global marker syntax (module-level singleton; after `closeBrowser()` the next launch rebuilds with the new config):

```javascript
import { configure } from 'xlsx2pdf';

configure({
  browserPath: '/usr/bin/chromium', // external browser (over bundled and XLSX2PDF_BROWSER_PATH)
  headless: 'new', // default 'new'
  launchArgs: ['--proxy-server=...'], // extra launch args
  markerRegex: /\{\{([^}]+)\}\}/g, // global marker syntax (null restores built-in ${...})
  markerSeparator: '::', // global internal separator (null restores vertical bar)
});
```

| Key               | Type               | Default           | Meaning                                                              |
| :---------------- | :----------------- | :---------------- | :------------------------------------------------------------------- |
| `browserPath`     | `string`           | none              | external browser executable path, over bundled and env var           |
| `headless`        | `boolean \| 'new'` | `'new'`           | puppeteer headless mode                                              |
| `launchArgs`      | `string[]`         | `[]`              | extra browser launch args                                            |
| `markerRegex`     | `RegExp \| null`   | built-in `${...}` | global marker syntax, per-call option wins; `null` restores built-in |
| `markerSeparator` | `string \| null`   | `'\|'`            | global internal separator, per-call wins; `null` restores default    |

The community edition accepts only these five keys; guardrail keys such as `maxConcurrency` / `maxCells` / `maxTemplateSize` / `memoryGuard` / `fontGuard` / `pageRotate` are accepted only after Pro declares them via seams — in the community edition they are silently ignored and the fixed safety caps apply (see [Deployment](#deploy)); any other unknown keys are silently ignored too.

This differs from the option section on purpose: option is per-generation input, where Pro keys and mistyped unknown keys both raise an explicit error (fail fast + conversion guidance); configure is process-level configuration, where the community edition tolerantly ignores undeclared keys and falls back to the fixed caps. If you want a Pro guardrail key to be intercepted with an error, put it in option rather than configure.

### configure vs option precedence

- Page setup (pageSize / orientation / margin): per-call option > template pageSetup > Excel built-in defaults;
- Marker syntax (markerRegex / markerSeparator): per-call option > configure global > built-in defaults;
- Plugins: per-call `option.plugins` merges with global `use()`, same-name resolved in favor of per-call (fieldResolvers run per-call first, transformModel runs per-call last).

---

<a id="faq"></a>

## Known limits and FAQ

**Q: Long text clips or spans pages?**
Community uses native Chrome pagination; long text may clip or span. Reserve enough space in the template, or control field length on the business side.

**Q: Dynamic detail rows?**
Built-in #array.field index mapping: repeat the marker per row in the template and the engine takes successive array indices; row count is fixed by the template (reserve enough repeated rows). It is not a dynamic loop that expands one row into N.

**Q: Which barcode symbologies?**
Built-in Code128 (`barcode`) and QR Code (`qrcode`), generated as PNG by bwip-js.

**Q: Need Office or LibreOffice?**
No. Bundled headless Chrome rendering, no Office engine dependency.

**Q: Concurrent calls?**
Fixed single concurrency, excess queued. For high concurrency, manage your own queue.

**Q: Missing fonts?**
Chrome font fallback handles rendering; glyphs may differ from Excel when a font is missing. Install the fonts your template uses in the container (see [Deployment](#deploy)).

**Q: How do `option.defaults` and `${field|text_default:N/A}` relate?**
Resolution order: data → marker-level default → `option.defaults`. The former is a per-marker fallback, the latter a global per-field fallback with lower priority.

---

<a id="maintenance"></a>

## Maintenance and versioning

We run this library in our own production for inspection / receipt-style business documents, and it has been running stably for months. Versions follow SemVer; changes are logged in [CHANGELOG.md](./CHANGELOG.md). The community edition is maintained going forward, and its scope is whatever the comparison table and the [feature list](#status) above say.

---

<a id="feedback"></a>

## Feedback and Pro

- Issues / feature requests: [GitHub Issues](https://github.com/krstation-open/xlsx2pdf/issues)
- Pro consulting / free POC: 📧 business@krstation.com
- Official website: [https://www.krstation.com/](https://www.krstation.com/)

---

<a id="contributing"></a>

## Contributing

Issues and PRs welcome. Please sign the CLA before submitting a PR (see [CONTRIBUTING.md](./CONTRIBUTING.md)). Pro's proprietary technology is out of scope for this repository, and contributions implementing it are not accepted.

Repository: `https://github.com/krstation-open/xlsx2pdf.git`. Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/) (enforced by husky `commit-msg` + commitlint), format `<type>(<scope>): <subject>`, header ≤ 100 characters.

Local development:

```bash
npm run build      # esbuild dual output (ESM/CJS)
npm run redline    # red-line scan (must be zero hits)
npm test           # ESM smoke
npm run test:cjs   # CJS smoke
npm run test:media # rich-media guard (image/barcode/qrcode + overlay + size normalization)
npm run test:detail # detail-row guard (index mapping + nested + numFmt + full pipeline)
```

---

<a id="license"></a>

## License

[Apache-2.0](./LICENSE) © 恺睿（深圳）软件科技有限公司

The community edition is free for commercial use. Pro is a separate closed-source product under a commercial EULA, unrelated to the code in this repository.
