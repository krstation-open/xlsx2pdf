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

A few things I value about it: the template is just plain Excel, so business users don't have to learn a new tool; nothing native to compile and no Office dragged in on install; rendering goes through Chrome, so output is consistent across Windows / Linux / macOS; the fiddly bits that usually break — merged cells, rich text, numFmt — are handled and tested; and marker types, field resolvers and model hooks are all extensible.

I should also be clear about the community edition's limits: column width uses a public-formula approximation, and for layouts that are extremely precision-sensitive, Pro offers pixel-accurate column width and single-page auto-fit. It's just a Node.js library — to use it from another language, run a small Node service and call it over HTTP, or hang a Node sidecar off your app.

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

| Cell | Content |
| :--- | :--- |
| A1 | Name |
| B1 | `${name}` |
| A2 | Amount |
| B2 | `${amount}` |
| A3 | Remark |
| B3 | `${remark\|text_default:N/A}` |

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

### Basic placeholders

| Syntax | Meaning |
| :--- | :--- |
| `${field}` | basic field (text type by default) |
| `${field\|text}` | explicit text |
| `${a.b.c}` | nested object dot path |
| `${field\|text_default:N/A}` | default text when empty |
| `${temp}℃ / ${humi}%` | multiple markers + static text mixed in one cell |
| `${#items.name}` | detail-row index mapping (repeated marker rows take successive array indices) |

### Rich-media markers (built-in since 1.1.0)

| Syntax | Meaning |
| :--- | :--- |
| `${photo\|image}` | image (local path / http(s) URL / base64 DataUrl) |
| `${photo\|image_w100_h80}` | explicit width/height (px) |
| `${code\|barcode_w120_h40}` | Code128 barcode |
| `${qr\|qrcode_w80_h80}` | QR code |
| `${logo\|image_zindex2_opacity0.5}` | overlay: z-index / opacity |

Image / barcode / QR share these parameter keys:

| Key | Meaning |
| :--- | :--- |
| `w` / `h` | width / height (px); setting one side derives the other by aspect ratio; neither set normalizes to original dimensions (@96DPI) |
| `ox` / `oy` | horizontal / vertical offset (px) |
| `zindex` | overlay z-index (non-zero does not stretch the row height) |
| `opacity` | opacity (0~1) |

> Community size normalization is pure-JS probing (no compression); automatic image compression and DPI-aware physical sizing are in Pro.

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

| Capability | Community | Pro |
| :--- | :---: | :---: |
| Single-document text / rich-media reports | ✅ | ✅ |
| Image / QR / barcode basic embedding | ✅ | ✅ |
| Automatic image compression + DPI-aware sizing | ❌ | ✅ |
| autoInsertImage / watermark markers | ❌ | ✅ |
| Detail-row index mapping (#array.field) | ✅ | ✅ |
| Array multi-page batch (data array → N pages) | ❌ | ✅ |
| Single-page auto-fit (overflow converges to one page, no clipping) | ❌ | ✅ |
| Column-width precision | public-formula approximation | pixel-accurate conversion + font-missing guard |
| Custom paper (receipt rolls) direct read | ❌ | ✅ |
| Landscape WPS / Clodop (a browser print control) print adaptation | ❌ | ✅ |
| Concurrency / memory-admission guard | fixed single concurrency | parameterized production guardrails |
| Custom extensions (3 points + custom syntax) | ✅ | ✅ |
| License | Apache-2.0, free commercial use | commercial EULA |

The "single-page auto-fit" row deserves a plain explanation: in the community edition, content that overflows goes through native Chrome pagination and may clip or span pages. Pro's single-page auto-fit, when data is too long and would otherwise overflow, automatically adjusts font size and row height to fit everything onto one page — no clipping, no lost data. This matters a lot for "must be one page" cases like shipping labels and fixed invoices.

**Pro consulting / free POC**: send 3 of your real templates; within 48 hours we return Pro output and a benchmark comparison report. 📧 business@krstation.com

---

<a id="deploy"></a>

## Deployment

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

### Safety caps (defaults)

| Item | Default | Note |
| :--- | :--- | :--- |
| Template size | 5MB | reject beyond cap |
| Cell count | 20000 | actual rows×cols; reject beyond cap (streaming pre-check rejects early before load) |
| Render concurrency | 1 | max simultaneously open tabs; excess queued |

---

<a id="extend"></a>

## Extensions

Three extension points, two registration levels: global `use(plugin)` (process-wide) / per-call `option.plugins` (this generation only, same-name overrides global, avoiding multi-tenant concurrency pollution):

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

Marker-type handler return contract: `string` → text substitution; `{ images: [{ dataUrl, width?, height?, ... }] }` → image overlay; `{ watermarks: [{ text, opacity?, ... }] }` → text-watermark overlay; `null/undefined` → clear the marker.

Marker syntax is customizable: `option.markerRegex` (or global `configure({ markerRegex })`) replaces the built-in `${...}` rule (contract: `g` flag + capture group 1 = marker content); `option.markerSeparator` replaces the internal "field / type_params" separator (default `|`). Pass `null` to restore defaults.

Extension development can reuse engine-homologous utilities: `import { helpers } from 'xlsx2pdf'` provides `getFileBuffer` / `flattenObject` / `parseMarkerOption` / `validateMarkerRegex` / `formatValue` / `generateCode` / `bufferToDataUrl` — the same implementation the engine uses internally, so behavior never drifts.

---

<a id="api"></a>

## API

| Function | Description |
| :--- | :--- |
| `excel2pdf({ template, data, option })` | one-stop generation, returns `{ pdf: Buffer, html: string }` |
| `excel2html({ template, data, option })` | render HTML only, no browser launch |
| `configure({ browserPath, headless, launchArgs, markerRegex, markerSeparator })` | global browser behavior & marker syntax |
| `ensureBrowser()` / `closeBrowser()` | bundled browser ready / close on process exit |
| `use(plugin)` | register an extension plugin globally (three points) |
| `helpers` | extension-development utility namespace (engine-homologous) |
| `getVersion()` | current package version |

### option (community edition)

- `pageSize`: `'A3' | 'A4' | 'A5' | 'B4' | 'B5' | 'letter' | 'legal'`, defaults to the template's pageSetup. Standard paper; custom paper (receipt rolls) is Pro.
- `orientation`: `'portrait' | 'landscape'`, defaults to the template. Page orientation.
- `margin`: `{ top?, right?, bottom?, left? }` (mm), merged field by field; when the template sets none, falls back to Excel's built-in defaults (top/bottom 19.1, left/right 17.8).
- `defaults`: `Record<string, unknown>`, default `{}`. Global per-field fallback values, see example below.
- `plugins`: `Plugin[]`, default `[]`. Per-call extensions, this generation only, same-name overrides global `use()`.
- `markerRegex`: `RegExp` (must have `g` flag + capture group 1), defaults to built-in `${...}`. Custom marker matching, takes precedence over configure global.
- `markerSeparator`: `string`, default `'|'`. The internal "field / type_params" separator, takes precedence over configure global.

`defaults` is a global fallback: when `data` lacks a field and that marker has no `text_default`, the same-named value in `defaults` is used. Resolution order is **data → marker-level `text_default` → `option.defaults`**:

```javascript
await excel2pdf({
  template: './tpl.xlsx',
  data: { name: 'Zhang San' },
  // remark / amount not provided in data, and no text_default in the template markers → fall back to these
  option: { defaults: { remark: 'N/A', amount: 0 } },
});
```

### configure vs option precedence

`configure()` sets global defaults (module-level singleton); `option` is the per-call override:

- Page setup (pageSize / orientation / margin): per-call option > template pageSetup > Excel built-in defaults;
- Marker syntax (markerRegex / markerSeparator): per-call option > configure global > built-in defaults;
- Plugins: per-call `option.plugins` merges with global `use()`, same-name resolved in favor of per-call.

configure keys: `browserPath` (external browser path, takes precedence over bundled and the `XLSX2PDF_BROWSER_PATH` env var), `headless` (default `'new'`), `launchArgs` (extra launch args), `markerRegex` / `markerSeparator` (global marker syntax, pass `null` to restore built-in). After `closeBrowser()`, the next launch rebuilds with the new config.

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
Resolution order: data → marker-level `text_default` → `option.defaults`. The former is a per-marker fallback, the latter a global per-field fallback with lower priority.

---

<a id="maintenance"></a>

## Maintenance and versioning

We run this library in our own production for inspection / receipt-style business documents, and it has been running stably for months. Versions follow SemVer; changes are logged in [CHANGELOG.md](./CHANGELOG.md). The community edition is maintained going forward, and its scope is whatever the comparison table above says.

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