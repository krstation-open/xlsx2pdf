# xlsx2pdf

[English](./README.md) | [简体中文](./README.zh-CN.md)

Lay out a document in Excel, drop in `${...}` markers, and let your backend fill in the data to get a PDF.

A Node.js server-side library that goes Excel template → marker substitution → HTML → headless Chrome print. No Office or LibreOffice needed, and no hand-written HTML. Apache-2.0, free for commercial use.

[![npm](https://img.shields.io/npm/v/xlsx2pdf)](https://www.npmjs.com/package/xlsx2pdf)
[![downloads](https://img.shields.io/npm/dw/xlsx2pdf)](https://www.npmjs.com/package/xlsx2pdf)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![CI](https://github.com/krstation-open/xlsx2pdf/actions/workflows/ci.yml/badge.svg)](https://github.com/krstation-open/xlsx2pdf/actions/workflows/ci.yml)
![node](https://img.shields.io/badge/node-%3E%3D18.17-green)

**Official website**: [https://www.krstation.com/](https://www.krstation.com/)

<a id="toc"></a>

## Contents

- [Quick start](#quick-start)
- [What it's for](#what-for)
- [Why xlsx2pdf](#why)
- [Features (community edition)](#features)
- [How it works](#mechanism)
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

Prefer the command line? The package ships a CLI:

```bash
npx xlsx2pdf convert tpl.xlsx --data '{"name":"Alice"}' --out out.pdf
# HTML-only preview (no browser launch): add --html
```

A runnable end-to-end example ships in `examples/basic.mjs` — in a source checkout, `npm run example` generates a demo template on the fly and outputs `examples/output/demo.pdf`.

↑ [Back to contents](#toc)

---

<a id="what-for"></a>

## What it's for

The short version: fixed templates, batch output — invoices, receipts, certificates, labels, statements, reports, and fixed-format reports. Business users lay things out in Excel, your backend fills in JSON data, and out comes a PDF. Along the way it renders an HTML that looks basically like what Excel shows; if you want to preview or post-process that, `excel2html()` gives you the HTML on its own.

A few things it doesn't do:

- It's not a general converter. Templates need placeholder markers; you can't feed it an arbitrary xlsx.
- It's not a report designer. Layout happens in Excel, not drag-and-drop in a browser.
- It's not a PDF editor. It generates; it doesn't merge, watermark, or otherwise post-process.

If all you want is to turn any xlsx into a PDF as-is, LibreOffice or a dedicated converter is a better fit.

↑ [Back to contents](#toc)

---

<a id="why"></a>

## Why xlsx2pdf

A few things we value about it: the template is just plain Excel, so business users don't have to learn a new tool; nothing native to compile and no Office dragged in on install; rendering goes through Chrome, so output is consistent across Windows / Linux / macOS; the fiddly bits that usually break — merged cells, rich text, numFmt — are handled and tested; and marker types, field resolvers and model hooks are all extensible.

We should also be clear about the community edition's limits: column widths follow Excel's official formula using the workbook's default font (a built-in heuristic table covers common fonts such as SimSun and Microsoft YaHei, so Chinese templates no longer render narrow; column widths of Chinese templates changed in 1.6.0 — if you upgrade from 1.5.x and keep pixel-level visual baselines, re-run them), while Pro adds browser-measured per-column correction for precision-sensitive layouts, and single-page adaptive layout for dynamic-length business content (font-size / row-height adjustment with minimum constraints — see [Community vs Pro](#compare)). It's just a Node.js library — to use it from another language, run a small Node service and call it over HTTP, or hang a Node sidecar off your app.

↑ [Back to contents](#toc)

---

<a id="features"></a>

## Features (community edition)

- **Native Excel templates**: plain `.xlsx`, editable in Excel / WPS / LibreOffice
- **Marker substitution**: `${field}`, nested dot paths `${a.b.c}`, defaults `${field|text_default:N/A}`
- **In-cell mixing**: multiple markers mixed with static text in one cell, each segment substituted independently and inheriting its local rich-text formatting
- **Style fidelity**: merged cells, font / color / background / borders, in-cell rich text
- **Number-format inheritance**: percent / currency / thousands / date automatically (e.g. `¥#,##0.00` → `¥1,234.50`)
- **Template-owned page setup**: standard paper A3/A4/A5/B4/B5/letter/legal, orientation & margins decided by the template — changing paper needs no code change
- **Precise scaling (since 1.7.0)**: `option.scale` 1~400% (matching Excel's print-scaling cap), 100 synonymous with `'auto'`; a scaling set in the template itself already applies
- **Rich-media markers (built-in since 1.1.0)**: `${photo|image}`, `${code|barcode}` (Code128), `${qr|qrcode}`; local path / http(s) URL / base64 DataUrl; overlay params `w/h/ox/oy/zindex/opacity`; unset size auto-normalized to original dimensions
- **Text-watermark marker (built-in since 1.7.0)**: `${stamp|watermark}` (`print` is a legacy alias) for stamp / void scenarios; z-index / opacity use the same overlay params as images, font size inherits the cell (watermarks auto-fitting the layout are in Pro)
- **Detail-row index mapping**: `${#items.name}` repeated per row, the engine takes successive array indices (`items.0`, `items.1`…); row count fixed by the template, nested fields & numFmt inheritance supported
- **Empty-row placeholder recognition (since 1.7.0)**: `emptyRowPlaceholders` treats rows made of placeholders like `--` as empty rows, row heights preserved (adaptive-shrink interplay is in Pro)
- **Bundled headless Chrome**: no external Office engine, consistent rendering
- **Browser lifecycle (since 1.7.0)**: idle auto-reclaim after 60s (on by default, can be disabled), render-count recycling / wall-clock age rotation parameterizable (off by default), see [Deployment](#deploy)
- **Lightweight preview**: `excel2html()` outputs HTML only, no browser launch
- **Render event hook (since 1.7.0)**: `configure({ onEvent })` bridges stage timing, wire it to pino or any logger yourself — zero new dependencies in the library
- **Extensible**: three extension points (marker types / field resolvers / model hooks), custom `markerRegex` / `markerSeparator`, configurable type aliases (`markerAliases`)
- **Engineering**: ESM / CJS dual mode + TypeScript declarations, template-size / cell-count safety caps (parameterizable since 1.7.0, relaxation risk in [Deployment](#deploy)), stable error codes with bilingual messages, CLI (`xlsx2pdf convert`)

↑ [Back to contents](#toc)

---

<a id="mechanism"></a>

## How it works

This section describes how the engine turns an xlsx into a PDF, focusing on the parts that most often cause layout drift: column widths, rich text, number formats, images and browser reuse. You don't need it for day-to-day use; come back when a layout looks off or a render behaves unexpectedly.

### From template to PDF

`excel2pdf` runs in five steps; everything independent of the data is done once:

1. Get the template Buffer. `getFileBuffer` normalizes local paths, http(s) URLs, base64 (including Data URLs) and Buffers into a Buffer.
2. Size guards. First the file size against `maxTemplateSize` (`E_SIZE_CAP`); then the first sheet's `<dimension>` declaration, falling back to streaming the row numbers. If the estimated cell count exceeds `maxCells`, the request is rejected before ExcelJS expands the file (`E_CELL_CAP`). The actual row × column count is checked again after loading.
3. Build the skeleton. Parse merged ranges, row and column sizes, page setup and the workbook default font; extract per-cell styles, number formats and rich-text run boundaries. The result is independent of the data.
4. Fill. Flatten the data into dot-path keys, replace markers cell by cell (including async image / barcode / watermark lookups), then normalize image sizes.
5. Render and print. The model becomes an HTML document (`excel2html` stops here) and goes to headless Chrome's `page.pdf()`.

Page setup follows per-call option > template pageSetup > Excel built-in defaults. A template that uses custom paper, or a paper code we can't resolve, with no paper specified via `option.pageSize`, throws instead of silently falling back to A4. A missing `data` renders one blank page from `[{}]`, which is handy for checking the layout first.

### Markers and rich text in one cell

Cell text goes through `parseCellMarkers`: `markerRegex` finds the markers, `markerSeparator` splits field, type and option. Cells without markers are modeled during the skeleton pass; cells with markers keep their parse artifacts, and the fill pass never reads the workbook again.

When a cell mixes markers and static text, the engine splits it in marker order and emits `segments`:

- replacement text inherits the local formatting of the run it lands in: bold, italic, underline, strike-through, color, size;
- static text between markers is split at run boundaries, each part carrying its local style;
- when the template only sets cell-level font and the runs carry no differences, `richTextSegStyles` returns null and rendering stays plain text, so the HTML is identical to the unsegmented output;
- when segments exist, the renderer emits one `<span>` per segment. Underline is drawn with `border-bottom` across the whole cell by default; only when a segment explicitly cancels underline does it switch to per-segment `text-decoration` — otherwise the cell border would cover the cancellation.

Font names and theme colors deliberately do not count as run differences, so font declarations don't interfere with size or theme-color resolution.

### Column widths

An Excel column width is measured in multiples of the pixel width of the digit `0` in the workbook's default font (MDW). The same character width is not the same number of pixels across fonts. The engine follows Excel's official formula:

```text
px = floor(((256 * width + floor(128 / MDW)) / 256) * MDW)
```

Below 1 character it switches to `round(width * MDW)`, continuous with the formula at 1. Columns without an explicit width are treated as 8.43 characters.

MDW comes from the workbook default font. The community edition doesn't launch a browser; it uses a built-in heuristic table:

| Font family | Size → MDW |
| :--- | :--- |
| SimSun / SimHei / KaiTi / FangSong | 9 / 11 / 12pt → 7 / 8 / 9 |
| Microsoft YaHei | 9 / 10 / 11 / 12pt → 7 / 8 / 9 / 9 |
| Western fonts | 9 / 10 / 11 / 12pt → 6 / 7 / 7 / 8 |

Sizes outside the table are interpolated; with no default font the public constant 7 (Calibri 11) applies. YaHei is checked before the CJK families because it is not monospaced and its digits are wider than SimSun's; DengXian deliberately falls into the Western branch — its digit metrics match Calibri, so its default column width does too, and treating it as CJK would make columns too wide. Uncommon fonts are proportional estimates only; per-column browser measurement is a Pro capability.

### Number formats

The number format set on a template cell applies to the injected value, matching what Excel shows when you type the value in: `0.1234` with `0.00%` renders `12.34%`, `1234.5` with `¥#,##0.00` renders `¥1,234.50`.

- A cell may carry a custom format string or a built-in numeric id (0~49); ids are mapped back to strings first. `General` and the text format `@` are not formatted.
- The format string is split on semicolons into up to four sections (positive / negative / zero / text), chosen by the value's sign; semicolons inside quotes are not separators.
- Numbers support `0` / `#` placeholders, thousands separators, trailing-comma scaling, percentages, currency symbols and quoted literals; dates support y/m/d/h/s tokens, 12-hour clocks and `[h]` elapsed time.
- Fractions, scientific notation and similar rare formats are left as-is rather than guessed at, and never throw.

There are two paths: static cells are formatted during modelling through `displayCellText`; marker cells put `cell.numFmt` into `ctx.numFmt`, and the text and watermark handlers format on replacement. Both paths share the same rules.

### Images and other media

`${photo|image}`, `${code|barcode}` and `${qr|qrcode}` share one resolver: the field value may be a local path, an http(s) URL or a base64 Data URL, and every form ends up as an inline Data URL, so printing makes no network requests.

- Content is validated first: `image-size` must be able to read width and height, which means the magic bytes and structure are valid; the extension and response headers are not trusted. Corrupt or truncated images degrade to empty and are reported in `warnings` instead of failing the whole report.
- With neither width nor height set, the original pixel size is used (96 DPI); with one side set, the other follows the aspect ratio. If parsing fails the historical 100×20 fallback keeps the image visible. The community edition only normalizes size; compression and DPI-aware conversion are Pro.
- Barcodes and QR codes are generated with bwip-js, defaulting to 100×20.
- Within one generation, the same value and size are resolved once; the cache stores the Promise, so concurrent lookups of the same value share one download or encode.

Watermarks are overlays too, using the same `zindex` / `opacity` parameters; font size is inherited from the cell. Shrinking font size and wrapping watermarks to fit the layout is a Pro capability.

### Concurrency and browser lifecycle

Rendering concurrency is controlled by a semaphore, default 1:

- Above the cap, requests queue; each queue entry carries its own cap, so a release wakes only the first entry whose cap allows it and leaves the rest queued. Once `runningPages` reaches zero any cap is admitted, so there is no deadlock.
- With a `signal`, a queued request can be cancelled: it is removed from the queue and throws `E_CANCELLED` without taking a slot.
- Cancellation during a render closes the tab and races the in-flight CDP call to return `E_CANCELLED` promptly.

The browser is a process-level singleton. `getBrowser` uses a shared Promise to prevent concurrent launches; the `disconnected` handler checks the instance identity so an old instance's event cannot clear a newer one; `closeBrowser` holds a generation lock, concurrent closes share one Promise, and a render waits for an in-flight close before judging liveness.

Idle reclaim is on by default: with nothing in flight and no activity past `browserIdleMs` (60 seconds), the singleton is closed; the timer is unref'd and never holds the process open. Render-count recycling and wall-clock age rotation are off by default, and when enabled they run only at a safe point — no in-flight renders and no launch in progress. The community edition has no memory admission guard: raising `maxConcurrency` grows Chrome memory linearly with open tabs, so leave the host enough headroom.

↑ [Back to contents](#toc)

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

### 4. Error handling

Every failure throws an `Xlsx2pdfError` carrying a stable `code` (e.g. `E_TEMPLATE_MISSING`, `E_DOWNLOAD_TIMEOUT`, `E_BROWSER_NOT_FOUND`) and a bilingual message — Chinese first, English appended. The full code table, with per-code causes and fixes, lives in [docs/errors.md](./docs/errors.md).

```javascript
import { excel2pdf, Xlsx2pdfError } from 'xlsx2pdf';

try {
  await excel2pdf({ template: './tpl.xlsx', data });
} catch (err) {
  if (err instanceof Xlsx2pdfError) {
    console.error(err.code); // stable across versions — branch on the code, not on message text
  }
  throw err;
}
```

The CLI prints the code, the message and a doc anchor on failure, and exits non-zero.

↑ [Back to contents](#toc)

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
| `watermark` | text-watermark overlay, `print` is a legacy alias; width follows the cell, font size inherits the cell, z-index / opacity same as images                                                  | `${stamp\|watermark_zindex1_opacity0.3}` |

`watermark` is built-in since 1.7.0, rendered at the cell's font size with overlay params effective; watermarks auto-fitting the layout (font shrink / wrapping) are in Pro. A custom handler can also return a watermark overlay — see [Extensions](#extend).

Image content is validated by magic bytes and structure (same check for base64 / remote / local sources, never trusting content-type / extension alone): corrupt or non-image content degrades to empty and is recorded in the result `warnings` — one broken image never fails the whole document, see [Degradation warnings](#warnings).

### Parameter keys

Image / barcode / QR share these keys (joined with `_`, e.g. `image_w120_h40_ox5`); `watermark` shares `zindex` / `opacity` (width follows the cell; `w/h/ox/oy` do not apply):

| Key       | Example      | Meaning                                                                                                                                                                                                |
| :-------- | :----------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `w`       | `w120`       | width px. For image/img, unset normalizes to original dimensions (96 DPI); with only one of `w`/`h` set, the other follows the original aspect ratio. barcode/qrcode are generated images, default 100 |
| `h`       | `h40`        | height px; same unset rules as `w`; barcode/qrcode default 20                                                                                                                                          |
| `ox`      | `ox5`        | horizontal offset px (default 0)                                                                                                                                                                       |
| `oy`      | `oy3`        | vertical offset px (may be negative, default 0)                                                                                                                                                        |
| `zindex`  | `zindex2`    | z-index: 0 same layer as template, negative below, positive above, stackable; non-zero is treated as a pure overlay — does not stretch the row height, overflow still shows                            |
| `opacity` | `opacity0.5` | opacity 0~1 (same as CSS `opacity`, 0.5 = semi-transparent); values >1 are treated as a percentage for backward compatibility (`opacity50` → 0.5), out-of-range clamped to bounds                      |

> Community size normalization is pure-JS probing (image-size, no compression); automatic image compression and DPI-aware physical sizing are in Pro. `minsize` (the font-shrink floor) depends on Pro's single-page adaptive layout and watermark auto-fit and has no effect here; `lineheight` only affects watermark-overlay line spacing (effective in the community edition); watermarks auto-fitting font size and wrapping to the layout are in Pro.

<a id="markeraliases"></a>

### Type aliases (markerAliases)

Built-in default aliases: `img` → `image`, `print` → `watermark` (legacy compatibility). Aliases normalize to the canonical type at parse time — behavior is identical to writing the canonical name. The mapping is customizable (since 1.7.0):

```javascript
// Per-call (this generation only, over configure global): template writes ${stamp|seal}
await excel2pdf({ template, data, option: { markerAliases: { seal: 'watermark' } } });

configure({ markerAliases: { seal: 'watermark' } }); // global default
configure({ markerAliases: null }); // restore built-in img/print
configure({ markerAliases: {} }); // clear all aliases
```

The semantics are **whole-object replacement**, not merge: passing `{ seal: 'watermark' }` means img/print no longer apply. When an alias is disabled and the template still uses that token with no same-named dedicated type registered, it throws `E_MARKER_ALIAS` explicitly (never silently degrades to text); other unknown type names still fall back to text. A plugin registering a type with the same name as an alias (e.g. `use({ markerTypes: { print: ... } })`) takes over that alias slot, silently without a warning. Alias targets must be known canonical types (built-in or registered); alias→alias chains are not allowed.

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

↑ [Back to contents](#toc)

---

<a id="compare"></a>

## Community vs Pro

The community edition can take a single text / rich-media report all the way through on its own — it's not a feature-cut trial. Pro is mainly for batch, high-concurrency, and production cases that are especially picky about layout precision. Both use the same rendering pipeline.

| Capability                                                                                             |                       Community                       |                         Pro                          |
| :----------------------------------------------------------------------------------------------------- | :---------------------------------------------------: | :--------------------------------------------------: |
| Single-document text / rich-media reports                                                              |                          ✅                           |                          ✅                          |
| Image / QR / barcode basic embedding                                                                   |                          ✅                           |                          ✅                          |
| Automatic image compression + DPI-aware sizing                                                         |                          ❌                           |                          ✅                          |
| autoInsertImage (automatic image insertion)                                                            |                          ❌                           |                          ✅                          |
| Text-watermark markers (watermark/print)                                                               |    ✅ basic form (font size inherits the cell)    |   ✅ incl. layout auto-fit   |
| Detail-row index mapping (#array.field)                                                                |                          ✅                           |                          ✅                          |
| Array multi-page batch (data array → N pages)                                                          |                          ❌                           |                          ✅                          |
| Batched multi-page output (`batchSize`, concurrency-limited between batches)                             |                          ❌                           |                          ✅                          |
| Single-page adaptive layout (font-size & row-height adjustment, minimum constraints, overflow warning) |                          ❌                           |                          ✅                          |
| Precise scaling (scale 1~400%)                                                                         |                          ✅                           |                          ✅                          |
| Empty-row placeholder recognition (emptyRowPlaceholders)                                               |        ✅ (adaptive-shrink interplay in Pro)        |                          ✅                          |
| Column-width precision                                                                                 |   official formula + common-font heuristic (1.6.0)    | browser-measured pixel accuracy + font-missing guard |
| Custom paper (receipt rolls) direct read                                                               |                          ❌                           |                          ✅                          |
| Landscape WPS / Clodop (a browser print control) print adaptation                                      |                          ❌                           |                          ✅                          |
| Concurrency / memory-admission guard                                                                   | concurrency & size caps configurable (no memory guard) | parameterized guardrails + memory admission + autonomous guarding |
| Browser lifecycle (idle reclaim / count recycling / age rotation)                                      |     ✅ configurable (idle default 60s)     |  ✅ zero-config production defaults  |
| Render event hook (onEvent)                                                                            |                          ✅                           | ✅ (observe sink + request timeline) |
| Custom extensions (3 points + custom syntax)                                                           |                          ✅                           |                          ✅                          |
| License                                                                                                |            Apache-2.0, free commercial use            |                   commercial EULA                    |

The ✅ marks only say "present or not". What these Pro capabilities solve in production deserves a plain explanation, one by one.

**Must be one page — single-page adaptive layout.** With dynamic business data, text often outgrows the space the template reserved: content overflows, row heights fall short, and the page no longer prints complete. In the community edition, overflow goes through native Chrome pagination and may clip or span pages. Pro's adaptive layout works from the browser's actual rendering: it adjusts font sizes and row heights to fit the content onto one page while keeping the template's visual structure. Font-size adjustment respects a global floor and a per-cell floor (`minsize`); row heights follow the space the content actually needs; rows carrying images, barcodes, QR codes or watermarks are protected from compression. The goal is not pixel-level replication of Excel's font sizes and row heights, but a complete, readable, print-ready single page. The boundary is explicit: font sizes and row heights have minimums, and when extreme content still cannot fit, the remaining overflow is clipped and a warning is emitted — adaptive layout fits one page as far as the constraints allow, it does not guarantee it unconditionally. This matters for "must be one page" cases like shipping labels, fixed invoices and inspection reports.

**Layout precision — pixel-accurate column width + font-missing guard.** Community column widths are an approximation from the official formula plus heuristics for common fonts — fine for most reports, but the approximation error accumulates, and it shows most in dense tables, amount columns and stamp / signature positions. Pro calibrates column by column against the browser's actual rendering, aligning widths with Excel's print output; missing fonts raise an explicit warning instead of being silently substituted and skewing the whole layout.

**Batch production — array batch + batched output.** The community edition produces one page per call; a testing station emitting hundreds of reports a day has to write its own loop and manage concurrency. Pro takes an array as `data`: one template + N records → an N-page PDF in a single call; beyond `batchSize` pages it renders in batches automatically, keeping the memory peak bounded, with inter-batch concurrency bounded by the guardrails.

**Long-running services — memory admission + guardian autonomy.** Community concurrency and lifecycle parameters are configurable, but "how far is safe" is left for you to find out. Pro estimates admission from the page count before rendering and rejects over-limit requests before they start; the browser guardian recycles and rebuilds at safe points, so repeated large batches do not exhaust host memory. Production defaults are pre-tuned, zero configuration.

**Special media and print paths.** Receipt-roll custom paper read directly; landscape pages adapted for WPS / Clodop print controls; automatic image compression + DPI-aware physical sizing (high-resolution photos no longer bloat the PDF); autoInsertImage; watermarks whose font size and wrapping auto-fit the layout.

**Pro consulting / free POC**: send 3 of your real templates; within 48 hours we return Pro output and a benchmark comparison report. 📧 business@krstation.com

↑ [Back to contents](#toc)

---

<a id="status"></a>

## Feature list and status

Every feature in one table, with a checkbox for implementation status: ☑ implemented (carrying the version it landed in), ☐ not yet implemented (no version shown — subject to actual releases). Pro-only capabilities are listed by effect name at the end of this section; per-version details are in [CHANGELOG.md](./CHANGELOG.md).

| Feature                                                                                               | Status | Since | Note                                                                                           |
| :---------------------------------------------------------------------------------------------------- | :----: | :---- | :--------------------------------------------------------------------------------------------- |
| `excel2pdf` / `excel2html` dual outlets                                                               |   ☑    | 1.0.0 | one-stop PDF generation / HTML-only render, no browser launch                                  |
| Marker substitution: basic fields / nested dot paths / marker defaults / in-cell multi-segment mixing |   ☑    | 1.0.0 | each segment substituted independently, inheriting local rich-text formatting                  |
| Style fidelity: merged cells / font / color / background / borders / in-cell rich text                |   ☑    | 1.0.0 | merged-region outer borders take the union of edge cells                                       |
| numFmt number-format inheritance                                                                      |   ☑    | 1.0.0 | both marker cells and static number/date cells render in their format                          |
| Standard paper / orientation / margins (template-owned)                                               |   ☑    | 1.0.0 | A3/A4/A5/B4/B5/letter/legal                                                                    |
| Bundled headless Chrome / external browser reuse                                                      |   ☑    | 1.0.0 | browserPath, XLSX2PDF_BROWSER_PATH, download can be skipped                                    |
| Three extension points + two registration levels                                                      |   ☑    | 1.0.0 | markerTypes / fieldResolvers / transformModel; use / option.plugins                            |
| Custom marker syntax                                                                                  |   ☑    | 1.0.0 | markerRegex / markerSeparator                                                                  |
| helpers utility namespace                                                                             |   ☑    | 1.0.0 | grew to 7 in 1.1.0 (added generateCode / bufferToDataUrl)                                      |
| ESM / CJS dual output + TypeScript declarations                                                       |   ☑    | 1.0.0 |                                                                                                |
| Template-size / cell-count safety caps                                                                |   ☑    | 1.0.0 | default 5MB / 20000 cells (parameterization in the next row)                                     |
| Size-guard parameterization (maxCells/maxTemplateSize)                                                |   ☑    | 1.7.0 | 0/negative = off; relaxation risk in Deployment                                                  |
| image / img markers                                                                                   |   ☑    | 1.1.0 | local path / http(s) URL / base64 DataUrl                                                      |
| barcode (Code128) / qrcode markers                                                                    |   ☑    | 1.1.0 | PNG generated by bwip-js                                                                       |
| Overlay params w/h/ox/oy/zindex/opacity                                                               |   ☑    | 1.1.0 | shared by image / barcode / QR                                                                 |
| Pure-JS image size normalization                                                                      |   ☑    | 1.1.0 | unset size normalizes to original dimensions at 96 DPI; no compression                         |
| Detail-row index mapping `#array.field`                                                               |   ☑    | 1.2.0 | row count fixed by the template, not a dynamic loop                                            |
| Examples directory + `npm run example` one-shot output                                                |   ☑    | 1.3.0 |                                                                                                |
| CLI (`xlsx2pdf convert`)                                                                              |   ☑    | 1.3.0 |                                                                                                |
| Stable error codes + bilingual messages + error reference doc                                         |   ☑    | 1.3.0 |                                                                                                |
| GitHub Actions CI + status badges                                                                     |   ☑    | 1.3.0 |                                                                                                |
| Render concurrency parameterization (`maxConcurrency`)                                                |   ☑    | 1.4.0 | default 1, positive integers only; no memory guard — see Deployment risk note                  |
| Generation cancellation (`option.signal` / `E_CANCELLED`)                                             |   ☑    | 1.5.0 | queue removal + render interruption, cooperative best-effort                                   |
| Degradation warnings channel (`warnings`) + image content validation                                  |   ☑    | 1.5.0 | single image/marker failures degrade instead of throwing; warnings consumable programmatically |
| Text-watermark marker (watermark, print alias)                                                        |   ☑    | 1.7.0 | overlay params same as images; layout auto-fit is Pro                                            |
| Precise scaling (`option.scale`)                                                                      |   ☑    | 1.7.0 | 1~400%, 100 synonymous with auto; non-positive falls back to auto                                |
| Empty-row placeholder recognition (`emptyRowPlaceholders`)                                            |   ☑    | 1.7.0 | placeholder rows treated as empty, row heights preserved                                         |
| Browser idle auto-reclaim                                                                             |   ☑    | 1.7.0 | default 60s, can be disabled (browserIdleMs:0)                                                   |
| Browser count recycling / age rotation parameterization                                               |   ☑    | 1.7.0 | off by default, opt-in for production tuning                                                     |
| Render event hook (stage / timing observability)                                                      |   ☑    | 1.7.0 | onEvent bridges 8 stage events                                                                   |
| Configurable marker type aliases (markerAliases)                                                      |   ☑    | 1.7.0 | built-in img/print; plugin takeover is silent                                                    |
| Multi-worksheet selection (`option.sheet`)                                                            |   ☐    |       |                                                                                                |
| Hidden row / column filtering                                                                         |   ☐    |       |                                                                                                |
| Reading images already embedded in the template                                                       |   ☐    |       |                                                                                                |
| Hyperlinks → clickable PDF links                                                                      |   ☐    |       |                                                                                                |
| Text rotation / indent                                                                                |   ☐    |       |                                                                                                |
| More barcode symbologies (EAN13 / Code39 etc.) + QR error-correction level                            |   ☐    |       |                                                                                                |
| Print area / repeating title rows                                                                     |   ☐    |       |                                                                                                |
| Header / footer / page numbers                                                                        |   ☐    |       |                                                                                                |
| TS type exports for plugin context and model                                                          |   ☐    |       |                                                                                                |
| Static template validation `validateTemplate`                                                         |   ☐    |       |                                                                                                |
| Official plugin examples (date formatting / enum mapping / i18n / uppercase amount)                   |   ☐    |       |                                                                                                |
| Template parse caching                                                                                |   ☐    |       |                                                                                                |
| URL-fetch safety options (allowlist / timeout / size cap)                                             |   ☐    |       |                                                                                                |
| Official Docker image                                                                                 |   ☐    |       |                                                                                                |

### Pro-only (not in the community edition)

- **Accuracy**: pixel-accurate column width + font-missing guard, single-page adaptive layout (minimum constraints, overflow warning), watermarks auto-fitting the layout
- **Stability**: memory-admission guard and page-count cap, guardian-autonomy production defaults
- **Batch production**: array multi-page batch, batched multi-page output (batchSize)
- **Special media & print**: automatic image compression + DPI-aware sizing, autoInsertImage, custom paper direct read, landscape print-control adaptation

Effect-level comparison in [Community vs Pro](#compare).

↑ [Back to contents](#toc)

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

| Item               | Default          | Note                                                                                  |
| :----------------- | :--------------- | :------------------------------------------------------------------------------------ |
| Template size      | 5MB              | reject beyond cap; configurable since 1.7.0 (`maxTemplateSize`, 0/negative = off), default unchanged |
| Cell count         | 20000            | actual rows×cols; reject beyond cap (streaming pre-check rejects early before load); configurable since 1.7.0 (`maxCells`, 0/negative = off) |
| Render concurrency | 1 (configurable) | max simultaneously open tabs; excess queued; positive integers only — risk note below |

Template size and cell count are parameterized since 1.7.0: `maxCells` / `maxTemplateSize` are accepted via both per-call option and configure (non-numbers throw `E_OPTION_INVALID`, 0/negative disables the guard); the defaults of 20000 cells / 5MB are unchanged — read the relaxation risk note below first. The remaining guardrails such as `memoryGuard` / `maxPages` are still Pro (option raises an explicit guidance error, configure silently ignores them — see [API](#api)). Render concurrency is parameterized since 1.4.0 (`maxConcurrency`, via configure or per-call option; the default of 1 is unchanged). Remote resources (template URL / image URL) download with a 30-second timeout and a 20MB size cap; failures throw a coded error (`E_DOWNLOAD_*`) with a bilingual message and the URL attached — see [docs/errors.md](./docs/errors.md).

> **⚠️ Read before raising render concurrency**: the community edition has **no memory-admission guard**, and Chrome memory grows **linearly** with the number of simultaneously open tabs (measured: ~400–500MB baseline, ~+100MB per tab as a floor, more for large image-heavy templates). Raising `maxConcurrency` on a small container (e.g. 2C4G) can push the whole host service into OOM — not just the library crashing, but every other business in the same process killed with it. Before raising it, budget memory as "baseline + concurrency × per-page peak + the host's own headroom"; setting it above 1 triggers a one-time runtime warning. With multiple worker processes (e.g. egg cluster) each worker holds its own browser singleton, so machine-wide memory ≈ workers × per-worker footprint. The memory-admission guard that lets you "raise concurrency without blowing up" (probes free memory before rendering, admits only when free memory minus in-flight estimates covers the page-scaled estimate + safety reserve; the singleton Chrome is recycled after a configurable render count to break the memory ratchet of repeated large batches) is a Pro capability.

> **⚠️ Read before relaxing the size caps**: same story as raising concurrency — the community edition has **no memory-admission guard**, and parsing / rendering an oversized template can exhaust process memory. Setting `maxCells` / `maxTemplateSize` above the defaults (or disabling the guards) triggers a one-time runtime warning; budget against the host's actual memory headroom before relaxing — this is an informed choice, not a recommended configuration. For production guardrails (cap rejection + memory admission), use Pro.

### Browser lifecycle

The browser singleton's lifecycle is configurable since 1.7.0 (configure-level only):

| Key                     | Default | Meaning                                                                                       |
| :---------------------- | :------ | :-------------------------------------------------------------------------------------------- |
| `browserIdleMs`         | `60000` | close the singleton when idle beyond the threshold with no in-flight render; next call rebuilds; 0 disables idle reclaim |
| `browserRecycleRenders` | `0`     | close and rebuild at a safe point after N completed renders (breaks the memory ratchet); off by default |
| `browserMaxAgeMs`       | `0`     | rotate the singleton at a safe point once its wall-clock age exceeds the threshold; off by default |
| `protocolTimeoutMs`     | `60000` | CDP call (incl. print) hang ceiling; integers ≥1000 ms only                                     |

Idle reclaim is a new well-meaning default in 1.7.0: a long-running service's browser closes automatically after 60s idle to release memory, and the next call rebuilds it — the cost is one cold start (same semantics as a manual `closeBrowser()`). If first-call latency matters and you want the browser to stay resident, `configure({ browserIdleMs: 0 })` turns it off. Count recycling and age rotation are off by default, meant as opt-in tuning for production services with repeated large batches (see the table above); recycling / rotation only happen at safe points with no in-flight render and never interrupt an ongoing generation.

↑ [Back to contents](#toc)

---

<a id="extend"></a>

## Extensions

> Since 1.0 the extension-point API is considered stable; breaking changes go through a major version.

Three extension points, two registration levels: global `use(plugin)` (process-wide) / per-call `option.plugins` (this generation only, same-name overrides global, avoiding multi-tenant concurrency pollution). Where they sit in the pipeline:

```
template xlsx → marker regex matching (customizable)
         → ② field resolution (fieldResolvers → flat lookup → marker default → option.defaults)
         → ① marker-type handler rendering (built-in text/image/img/barcode/qrcode/watermark/print + custom)
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

| Field         | Type       | Meaning                                                                                                                                                          |
| :------------ | :--------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data`        | `object`   | the full data object for this generation (unflattened original structure; read nested values directly via `ctx.data.a.b`)                                        |
| `field`       | `string`   | marker field name (`#array` syntax already expanded to an indexed dot path, e.g. `items.0.spec`)                                                                 |
| `row` / `col` | `number`   | cell row / column number (1-based)                                                                                                                               |
| `imageCache`  | `Map`      | image cache for this generation (key = type\|width\|height\|value); custom image handlers can reuse it to avoid repeated download / encoding                     |
| `numFmt`      | `string`   | the cell's number format, paired with `helpers.formatValue` to reuse numFmt rendering                                                                            |
| `warnings`    | `string[]` | degradation-warning collector for this generation; custom handlers can push warnings, surfaced via the result `warnings` (see [Degradation warnings](#warnings)) |

**option fields** (parsed result after the marker's `|`): `type` (type name), `width` / `height` / `offsetX` / `offsetY` / `zIndex` / `opacity` / `minSize` / `lineHeight` (numeric params like `w120_h40`), `defaultValue` (`_default:` / `_默认:` / `_dft:`); other `key:value` custom pairs pass through as-is (e.g. `format:YYYY年` → `option.format`).

**Return contract**:

| Return value                                                                        | Behavior                                                                                                                                                                                                         |
| :---------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `string`                                                                            | text substitution (same as text)                                                                                                                                                                                 |
| `number` / `boolean`                                                                | rendered as text (`String(value)`)                                                                                                                                                                               |
| `{ images: [{ dataUrl, width?, height?, offsetX?, offsetY?, zIndex?, opacity? }] }` | image overlay; unset or 0 `width`/`height` normalizes to original dimensions / aspect ratio (same as built-in image `w`/`h`); `zIndex`/`opacity` follow the same stacking rules as built-in image / barcode / QR |
| `{ watermarks: [{ text, zIndex?, opacity?, minSize?, lineHeight? }] }`              | text-watermark overlay (width follows the cell, height unbounded); the built-in `watermark` marker type is available in the community edition since 1.7.0 (layout auto-fit is Pro), watermarks returned by a custom handler go through the same rendering                      |
| `{ text, images, watermarks }`                                                      | mixed                                                                                                                                                                                                            |
| `null` / `undefined`                                                                | treated as empty (clears the marker)                                                                                                                                                                             |

A throwing handler does not abort generation: after printing an `[engine]` error to the console, that marker is cleared as empty and the rest proceed normally; the warning is also recorded in the result `warnings` (tagged `E_PLUGIN_RUNTIME`). A type with the same name as a built-in overrides it (with a warning).

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

Signature `async (field, data, ctx) => value` (ctx as above; `field` already has `#array` expanded). Called in order; the first non-`undefined` return wins; if none hit, it falls back to the built-in chain (flat lookup → marker default → `option.defaults`). Use for computed fields, async data sources (database / RPC), or cross-field derived values. A resolver throwing at runtime affects the whole output's values, so it is wrapped as `E_PLUGIN_RUNTIME` and fails fast (no degradation).

```javascript
use({
  fieldResolvers: [
    async (field, data) => (field === 'fullName' ? `${data.firstName}${data.lastName}` : undefined),
    async (field) => (field.startsWith('db.') ? await fetchFromDb(field) : undefined), // async data source
  ],
});
```

### ③ Model post-processing hook

Called in registration order after the engine produces the WorksheetModel and before render; you can tweak cell text / styles / row heights / column widths (returning a new model replaces it, in-place mutation returning void also works; hook ctx = `{ data, option }`). A hook throwing at runtime affects the whole model, so it is wrapped as `E_PLUGIN_RUNTIME` and fails fast (no degradation).

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
| `parseMarkerOption`   | `(optionStr?, knownTypes?, aliases?) → option`         | parse the option string after the vertical bar (e.g. `text_w100_默认:--`), same rules as the engine; aliases defaults to built-in img/print    |
| `validateMarkerRegex` | `(regex) → void`                                       | validate the custom marker regex contract (g flag + capture group 1); throws on violation                                             |
| `formatValue`         | `(value, fmt?) → string`                               | render a value in an Excel number format (same implementation as numFmt inheritance); unsupported formats / errors fall back to as-is |
| `generateCode`        | `(type, text, { width?, height? }) → Promise<dataUrl>` | barcode `'barcode'` (Code128) / QR `'qrcode'` text → base64 image, same as the built-in types                                         |
| `bufferToDataUrl`     | `(buffer, extension) → dataUrl`                        | Buffer → base64 Data URL                                                                                                              |

↑ [Back to contents](#toc)

---

<a id="api"></a>

## API

| Function        | Signature                                                                                   | Description                                                                                                                                            |
| :-------------- | :------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `excel2pdf`     | `({ template, data, option }) → Promise<{ pdf: Buffer, html: string, warnings: string[] }>` | one-stop generation: template parse → HTML render → headless Chrome print PDF; warnings see [Degradation warnings](#warnings)                          |
| `excel2html`    | `({ template, data, option }) → Promise<{ html: string, warnings: string[] }>`              | same params as excel2pdf; template parse + HTML render only, no browser launch                                                                         |
| `configure`     | `(option?) → Readonly<BrowserOptions>`                                                      | global browser behavior & marker syntax (module-level singleton); returns the effective config                                                         |
| `ensureBrowser` | `(option?) → Promise<string>`                                                               | ensure the bundled browser is ready (idempotent; `{ force: true }` reinstalls); returns the executable path                                            |
| `closeBrowser`  | `() → Promise<void>`                                                                        | close the reused singleton browser (usually on process exit)                                                                                           |
| `use`           | `(plugin) → void`                                                                           | register an extension plugin globally (three points, see [Extensions](#extend))                                                                        |
| `helpers`       | namespace                                                                                   | extension-development utilities (engine-homologous, see [Extensions](#extend))                                                                         |
| `getVersion`    | `() → string`                                                                               | current package version (read at runtime from the install dir's package.json, cached after first call; falls back to `'unknown'` if missing / corrupt) |
| `Xlsx2pdfError` | `class extends Error`                                                                       | every thrown error carries a stable `code` + bilingual message; full table in [docs/errors.md](./docs/errors.md)                                       |

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
| `scale`           | `number \| 'auto'`                                | template pageSetup / auto                       | print scaling 1~400% (capped at 400), 100 synonymous with `'auto'`; non-positive / non-numeric falls back to auto without throwing; template-owned scaling already applies |
| `emptyRowPlaceholders` | `string[]`                                   | `[]`                                            | rows made entirely of these placeholders are treated as empty (row heights preserved); array of strings only                                      |
| `maxCells`        | `number`                                          | `20000`                                         | cell-count cap, 0/negative disables the guard; over configure global; relaxation risk in [Deployment](#deploy)                                    |
| `maxTemplateSize` | `number`                                          | `5242880` (5MB)                                 | template file-size cap (bytes), 0/negative disables the guard; over configure global                                                              |
| `markerAliases`   | `Record<string,string> \| null`                   | built-in img/print                              | type-alias mapping, whole-object replacement; over configure global, `null` restores built-in; see [Type aliases](#markeraliases)                 |
| `maxConcurrency`  | `number` (positive integer)                       | `1`                                             | max simultaneously rendering tabs, excess queued; over configure global; raising risk in [Deployment](#deploy)                                      |
| `signal`          | `AbortSignal`                                     | none                                            | cancellation signal: queue removal / render interruption, throws `E_CANCELLED`, see [Cancellation](#cancel)                                         |

Page-setup params (pageSize / orientation / margin) precedence: **per-call option > template pageSetup > Excel built-in defaults**. Pro-only option keys (`fitToPage` / `minFontSize` / `pageRotate` / `fontGuard` / `memoryGuard` / `maxPages` / `batchSize`) raise an explicit guidance error when passed in the community edition; unknown option keys are likewise rejected (a typo is never silently ignored). Note: configure silently ignores the same guardrail keys rather than throwing — see configure(option) below for why.

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
  maxConcurrency: 2, // max simultaneously rendering tabs (positive integer, default 1; read the Deployment risk note first)
  maxCells: 20000, // cell-count cap (0/negative = off; read the Deployment risk note before relaxing)
  maxTemplateSize: 5 * 1024 * 1024, // template size cap (bytes, 0/negative = off)
  browserIdleMs: 60000, // idle reclaim ms (default 60s, 0 disables)
  browserRecycleRenders: 0, // render-count recycling (default 0 = off, opt-in production tuning)
  browserMaxAgeMs: 0, // wall-clock age rotation ms (default 0 = off)
  protocolTimeoutMs: 60000, // CDP call hang ceiling (integer ms ≥1000)
  onEvent: (evt) => console.log(evt), // render event hook (null = off, see Observability)
  markerAliases: { seal: 'watermark' }, // type aliases (null restores built-in img/print, {} clears)
});
```

| Key               | Type                        | Default           | Meaning                                                                                                        |
| :---------------- | :-------------------------- | :---------------- | :------------------------------------------------------------------------------------------------------------- |
| `browserPath`     | `string`                    | none              | external browser executable path, over bundled and env var                                                     |
| `headless`        | `boolean \| 'new'`          | `'new'`           | puppeteer headless mode                                                                                        |
| `launchArgs`      | `string[]`                  | `[]`              | extra browser launch args                                                                                      |
| `markerRegex`     | `RegExp \| null`            | built-in `${...}` | global marker syntax, per-call option wins; `null` restores built-in                                           |
| `markerSeparator` | `string \| null`            | `'\|'`            | global internal separator, per-call wins; `null` restores default                                              |
| `maxConcurrency`  | `number` (positive integer) | `1`               | max simultaneously rendering tabs, excess queued; per-call option wins; one-time risk warning when set above 1 |
| `maxCells`        | `number`                    | `20000`           | cell-count cap, 0/negative = off; non-numbers throw `E_OPTION_INVALID`; one-time warning above the default |
| `maxTemplateSize` | `number`                    | `5242880`         | template size cap (bytes), 0/negative = off; same validation & warning rules as `maxCells` |
| `browserIdleMs`   | `number` (non-negative int) | `60000`           | idle reclaim ms, 0 disables; see [Deployment · Browser lifecycle](#deploy) |
| `browserRecycleRenders` | `number` (non-negative int) | `0`         | render-count recycling threshold, 0 disables                                               |
| `browserMaxAgeMs` | `number` (non-negative int) | `0`               | wall-clock age rotation ms, 0 disables                                                     |
| `protocolTimeoutMs` | `number` (integer ≥1000)  | `60000`           | CDP call (incl. print) hang ceiling                                                        |
| `onEvent`         | `function \| null`          | `null`            | render event hook, see [Observability](#onevent); non-functions throw `E_OPTION_INVALID`   |
| `markerAliases`   | `object \| null`            | `null` (built-in img/print) | type-alias mapping, whole-object replacement; `null` restores built-in, `{}` clears; per-call option wins |

The community edition accepts these fourteen keys; the remaining guardrail keys (`memoryGuard` / `maxPages` / `fontGuard` / `pageRotate`) are accepted only after Pro declares them via seams — in the community edition they are silently ignored (see [Deployment](#deploy)); any other unknown keys are silently ignored too. `batchSize` is a Pro capability: the community edition rejects it in option and silently ignores it in configure, while Pro declares it via the seam so configure accepts it too. Validation rules: `maxConcurrency` takes positive integers only (0 / negatives / fractions / non-numbers throw `E_OPTION_INVALID`; there is no "0 = unlimited" semantics); the three lifecycle keys (browserIdleMs / browserRecycleRenders / browserMaxAgeMs) take non-negative integers (0 = off); `protocolTimeoutMs` takes integer ms ≥1000; the two size-guard keys take numbers only (0/negative = off).

This differs from the option section on purpose: option is per-generation input, where Pro keys and mistyped unknown keys both raise an explicit error (fail fast + conversion guidance); configure is process-level configuration, where the community edition tolerantly ignores undeclared keys and falls back to the fixed caps. If you want a Pro guardrail key to be intercepted with an error, put it in option rather than configure.

### configure vs option precedence

- Page setup (pageSize / orientation / margin): per-call option > template pageSetup > Excel built-in defaults;
- Marker syntax (markerRegex / markerSeparator): per-call option > configure global > built-in defaults;
- Render concurrency (maxConcurrency): per-call option > configure global > 1;
- Size guards (maxCells / maxTemplateSize): per-call option > configure global > defaults of 20000 cells / 5MB;
- Type aliases (markerAliases): per-call option > configure global > built-in img/print;
- The four browser-lifecycle keys (browserIdleMs / browserRecycleRenders / browserMaxAgeMs / protocolTimeoutMs) and onEvent are configure-level only;
- Plugins: per-call `option.plugins` merges with global `use()`, same-name resolved in favor of per-call (fieldResolvers run per-call first, transformModel runs per-call last).

<a id="onevent"></a>

### Observability (onEvent)

Pass a callback to `configure({ onEvent })` to receive render-stage events (since 1.7.0); bridge them to pino or any logger yourself — zero new dependencies in the library:

```javascript
import pino from 'pino'; // your own logging dependency
import { configure } from 'xlsx2pdf';

const log = pino();
configure({ onEvent: (evt) => log.info(evt, 'xlsx2pdf') });
configure({ onEvent: null }); // turn off
```

There are 8 events, each carrying `step` (event name) and `ts` (millisecond timestamp):

| Event          | Fires when                                        | Main fields                         |
| :------------- | :------------------------------------------------ | :---------------------------------- |
| `html`         | template parse + HTML render complete             | `ms`, `pages`                       |
| `render.wait`  | render-slot wait complete (queueing time)         | `ms`, `pages`                       |
| `render.chrome`| browser ready + tab created (incl. cold start)    | `ms`                                |
| `render.print` | Chrome print output complete                      | `ms`, `bytes`, `pages`              |
| `render`       | one batch render complete                         | `ms`, `pages`, `bytes`, `batch`, `batches` |
| `merge`        | multi-batch PDF merge complete (batched path only) | `ms`, `bytes`, `batches`           |
| `rotate`       | landscape rotation complete (rotation path only)  | `ms`, `bytes`                       |
| `done`         | the whole generation complete                     | `ms` (total), `pages`, `pdfBytes`, `htmlBytes`, `batches` |

The community single-page path receives 6 of them (html / render.wait / render.chrome / render.print / render / done); merge / rotate only appear on the batched / rotation paths. A throwing hook never breaks generation (the exception is swallowed, rendering proceeds); when unconfigured there is zero overhead (no event object is constructed). Pro's observe sink coexists with onEvent, receiving the same event stream.

<a id="cancel"></a>

### Cancellation (option.signal)

Pass an `AbortSignal` (e.g. `new AbortController().signal`) to cancel a generation: queued requests are removed from the queue without holding a slot, an in-flight render has its tab closed to interrupt the ongoing call, and multi-page batches are checked per page; cancellation throws `E_CANCELLED`, the browser singleton stays alive for reuse, and subsequent tasks are unaffected. An invalid type (not an AbortSignal) throws `E_OPTION_INVALID`.

```javascript
const ac = new AbortController();
setTimeout(() => ac.abort(), 5000); // cancel after 5 seconds
try {
  const { pdf } = await excel2pdf({ template: './tpl.xlsx', data, option: { signal: ac.signal } });
} catch (err) {
  if (err.code === 'E_CANCELLED') {
    /* expected cancellation */
  }
}
```

Cancellation is **cooperative best-effort**, with no byte-level immediacy guaranteed; the Pro memory-admission queue does not observe the signal (its own timeout bounds the wait, and the post-admission pre-check still rejects an already-cancelled request).

<a id="warnings"></a>

### Degradation warnings (warnings)

Failures scoped to a single marker/image do not throw — they degrade to empty and rendering continues: corrupt/non-image content, image read failures, in-browser decode failures, a throwing custom handler, etc. Warnings go to both the console and the result `warnings: string[]` (per-call, concurrency-safe, empty when nothing degraded); only failures affecting the whole output (template/download/guardrail/rendering, throwing fieldResolvers and transformModel) raise stable error codes. The full division of labor is in [docs/errors.md, Degradation policy](./docs/errors.md).

```javascript
const { pdf, warnings } = await excel2pdf({ template: './tpl.xlsx', data });
if (warnings.length > 0) console.warn('This generation degraded:', warnings);
```

↑ [Back to contents](#toc)

---

<a id="faq"></a>

## Known limits and FAQ

**Q: Long text clips or spans pages?**
Community uses native Chrome pagination; long text may clip or span. Reserve enough space in the template, or control field length on the business side.

**Q: Does Pro's adaptive layout guarantee one page without clipping?**
No — it fits as much as possible within explicit minimums. Font sizes and row heights have floors, rows carrying images / watermarks are protected from compression, and when extreme content still cannot fit, the remaining overflow is clipped and a warning is emitted. Design for the common case and handle the warning for the extreme one.

**Q: Dynamic detail rows?**
Built-in #array.field index mapping: repeat the marker per row in the template and the engine takes successive array indices; row count is fixed by the template (reserve enough repeated rows). It is not a dynamic loop that expands one row into N.

**Q: Which barcode symbologies?**
Built-in Code128 (`barcode`) and QR Code (`qrcode`), generated as PNG by bwip-js.

**Q: Need Office or LibreOffice?**
No. Bundled headless Chrome rendering, no Office engine dependency.

**Q: Concurrent calls?**
Yes. Single concurrency by default, excess queued; since 1.4.0 you can raise it via `maxConcurrency` (positive integer), but the community edition has no memory guard — read the [Deployment risk note](#deploy) first.

**Q: Missing fonts?**
Chrome font fallback handles rendering; glyphs may differ from Excel when a font is missing. Install the fonts your template uses in the container (see [Deployment](#deploy)).

**Q: How do `option.defaults` and `${field|text_default:N/A}` relate?**
Resolution order: data → marker-level default → `option.defaults`. The former is a per-marker fallback, the latter a global per-field fallback with lower priority.

**Q: How do I branch on errors programmatically?**
Catch and check `err instanceof Xlsx2pdfError`, then branch on the stable `err.code` (not on message text). Full code table with fixes: [docs/errors.md](./docs/errors.md).

**Q: Community watermark vs Pro — what's the difference?**
The community edition renders watermarks at the cell's font size with overlay params (z-index / opacity etc.) effective; Pro additionally auto-fits the watermark's font size and wrapping to the layout.

**Q: What happens when the browser sits idle?**
Since 1.7.0 it closes automatically after 60s idle and the next call rebuilds it (the cost is one cold start); to keep it resident, `configure({ browserIdleMs: 0 })` — see [Deployment · Browser lifecycle](#deploy).

**Q: Can the template size caps be relaxed?**
Since 1.7.0 `maxCells` / `maxTemplateSize` are configurable (0/negative = off), but the community edition has no memory guard — read the [Deployment risk note](#deploy) first.

**Q: Want `print` as your own dedicated marker?**
Register a type named `print` via `use()` and it takes over the alias slot (silently, no warning); or adjust / remove the alias via `markerAliases` (after removal, a template still using that token with no dedicated type registered raises `E_MARKER_ALIAS` explicitly — never a silent downgrade).

↑ [Back to contents](#toc)

---

<a id="maintenance"></a>

## Maintenance and versioning

We run this library in our own production for inspection / receipt-style business documents, and it has been running stably for months. Versions follow SemVer; changes are logged in [CHANGELOG.md](./CHANGELOG.md). The community edition is maintained going forward, and its scope is whatever the comparison table and the [feature list](#status) above say.

↑ [Back to contents](#toc)

---

<a id="feedback"></a>

## Feedback and Pro

- Issues / feature requests: [GitHub Issues](https://github.com/krstation-open/xlsx2pdf/issues)
- Pro consulting / free POC: 📧 business@krstation.com
- Official website: [https://www.krstation.com/](https://www.krstation.com/)

↑ [Back to contents](#toc)

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
npm run test:boundary # 1.7.0 boundary guards (scale/lifecycle/empty-row/onEvent/watermark/size-params/aliases)
```

↑ [Back to contents](#toc)

---

<a id="license"></a>

## License

[Apache-2.0](./LICENSE) © 恺睿（深圳）软件科技有限公司

The community edition is free for commercial use. Pro is a separate closed-source product under a commercial EULA, unrelated to the code in this repository.

↑ [Back to contents](#toc)
