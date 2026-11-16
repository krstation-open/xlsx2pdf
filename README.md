# xlsx2pdf

[English](./README.md) | [简体中文](./README.zh-CN.md)

Lay out a document in Excel, drop in `${...}` markers, and let your backend fill in the data to get a PDF.

A Node.js server-side library that goes Excel template → marker substitution → HTML → headless Chrome print. No Office or LibreOffice needed, and no hand-written HTML. Apache-2.0, free for commercial use.

[![npm](https://img.shields.io/npm/v/xlsx2pdf)](https://www.npmjs.com/package/xlsx2pdf)
[![downloads](https://img.shields.io/npm/dw/xlsx2pdf)](https://www.npmjs.com/package/xlsx2pdf)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
![node](https://img.shields.io/badge/node-%3E%3D18.17-green)

**Official website**: [https://www.krstation.com/](https://www.krstation.com/)

---

## Quick start

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

> postinstall auto-downloads the bundled Chrome (~150MB, mirror-friendly). To reuse an existing Chrome/Chromium: `configure({ browserPath: '/usr/bin/chromium' })`.

---

## What it's for

The short version: fixed templates, batch output — invoices, receipts, certificates, labels, statements, reports, and fixed-format reports. Business users lay things out in Excel, your backend fills in JSON data, and out comes a PDF. Along the way it renders an HTML that looks basically like what Excel shows; if you want to preview or post-process that, `excel2html()` gives you the HTML on its own.

A few things it doesn't do:

- It's not a general converter. Templates need placeholder markers; you can't feed it an arbitrary xlsx.
- It's not a report designer. Layout happens in Excel, not drag-and-drop in a browser.
- It's not a PDF editor. It generates; it doesn't merge, watermark, or otherwise post-process.

If all you want is to turn any xlsx into a PDF as-is, LibreOffice or a dedicated converter is a better fit.

---

## How it compares to options in other languages

People often ask whether Python or Java has something equivalent. I looked around; here's roughly what's out there:

| Language | Common open-source options | What's missing |
| :--- | :--- | :--- |
| Python | openpyxl + reportlab/WeasyPrint, libreoffice-convert | no Chrome-consistent Excel-template marker engine |
| Java | Apache POI (no PDF), JasperReports (template ≠ Excel) | template not Excel, or no PDF |
| Go | excelize (no PDF), chromedp + hand-drawing | no template→PDF fidelity engine |
| .NET | ClosedXML/EPPlus + hand-drawing | open-source slot empty |
| PHP | PhpSpreadsheet + Dompdf/mPDF | poor Excel fidelity |

Basically the open-source choices in other languages fall into four groups: LibreOffice-based (heavy, awkward to run concurrently), hand-drawn PDF or a custom HTML engine (poor Excel fidelity), pure xlsx read/write libraries (no PDF at all), and report engines whose template isn't Excel. The ones with genuinely high fidelity are mostly commercial closed-source engines like Aspose or Spire — paid, and not light.

xlsx2pdf aims at the gap in between: open source, no native modules to compile on install, no Office dragged in, consistent Chrome output across platforms, the template is just Excel, and it's extensible. The fiddly bits that usually break — merged cells, rich text, numFmt — are handled and tested.

Two things worth being upfront about, so expectations line up:

- On fidelity, community column width uses a public-formula approximation; a commercial native engine may render an arbitrary xlsx more accurately. What really widens the precision gap is Pro's pixel-accurate column width and single-page auto-fit.
- The route itself isn't secret — every language has Chrome/CDP bindings, so others can build it too. Our edge is doing the details thoroughly, plus Pro's precision and production guardrails, not some unique trick.

Also, it's just a Node.js library. To use it from another language, run a small Node service and call it over HTTP, or hang a Node sidecar off your app.

---

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

## Detailed usage

### 1. Design the template

Lay out the report in Excel and write markers where dynamic data goes:

| Cell | Content |
| :--- | :--- |
| A1 | Name |
| B1 | `${name}` |
| A2 | Amount |
| B2 | `${amount}` |
| A3 | Remark |
| B3 | `${remark\|text_default:N/A}` |

### 2. Call

```javascript
import { excel2pdf } from 'xlsx2pdf';

const { pdf } = await excel2pdf({
  template: './tpl.xlsx',
  data: { name: 'Alice', amount: 1234.5, remark: 'urgent' },
});
```

If the amount cell uses `¥#,##0.00`, the output shows `¥1,234.50` automatically — number formats need no marker parameters.

### 3. Output

`pdf` is a Buffer — write to file, return as an HTTP response, or upload to object storage:

```javascript
import { writeFileSync } from 'node:fs';

// write to file
writeFileSync('out.pdf', pdf);

// Express response
res.setHeader('Content-Type', 'application/pdf');
res.send(pdf);
```

---

## Marker syntax

### Basic placeholders

| Syntax | Meaning |
| :--- | :--- |
| `${field}` | basic field (default text type) |
| `${field\|text}` | explicit text |
| `${a.b.c}` | nested object dot path |
| `${field\|text_default:N/A}` | default text when empty |
| `${temp}℃ / ${humi}%` | multiple markers + static text in one cell |
| `${#items.name}` | detail-row index mapping (repeated marker rows take successive array indices) |

### Rich-media markers (built-in since 1.1.0)

| Syntax | Meaning |
| :--- | :--- |
| `${photo\|image}` | image (local path / http(s) URL / base64 DataUrl) |
| `${photo\|image_w100_h80}` | explicit width / height (px) |
| `${code\|barcode_w120_h40}` | Code128 barcode |
| `${qr\|qrcode_w80_h80}` | QR code |
| `${logo\|image_zindex2_opacity0.5}` | overlay: z-index / opacity |

Shared parameter keys for image / barcode / qrcode:

| Key | Meaning |
| :--- | :--- |
| `w` / `h` | width / height (px); setting one side derives the other by aspect ratio; setting neither normalizes to original dimensions (@96DPI) |
| `ox` / `oy` | horizontal / vertical offset (px) |
| `zindex` | overlay stacking (non-zero does not stretch the row height) |
| `opacity` | opacity (0~1) |

> Community size normalization is pure-JS probing (no compression); automatic image compression and DPI-aware physical sizing are offered in Pro.

### Data-structure boundary

The community edition supports **single-record** injection and built-in **#array.field detail-row index mapping**:

```javascript
// ✅ single record + nested object
data: { name: 'Alice', customer: { city: 'Shanghai' } }

// ✅ detail rows: repeat ${#items.name} per row in the template; engine takes items.0 / items.1 / items.2…
data: { items: [{ name: 'A' }, { name: 'B' }] }

// ❌ no dynamic loop that auto-expands one marker row into N rows (row count fixed by template; reserve enough repeated rows)
// ❌ no multi-page batch via data array (Pro capability)
```

Detail-row count is fixed by the template: excess rows are cleared when data is shorter, and markers are cleared for an empty array. For emitting many pages from one template (`data` as an array), use Pro's array batch. When `data` is omitted, one empty template page is rendered (markers cleared via defaults / empty values).

---

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
| Landscape WPS / Clodop print adaptation | ❌ | ✅ |
| Concurrency / memory-admission guard | fixed single concurrency | parameterized production guardrails |
| Custom extensions (3 points + custom syntax) | ✅ | ✅ |
| License | Apache-2.0, free commercial use | commercial EULA |

The "single-page auto-fit" row deserves a plain explanation: in the community edition, content that overflows goes through native Chrome pagination and may clip or span pages. Pro's single-page auto-fit, when data is too long and would otherwise overflow, automatically adjusts font size and row height to fit everything onto one page — no clipping, no lost data. This matters a lot for "must be one page" cases like shipping labels and fixed invoices.

A few things worth knowing before you use it:

- Overflow goes through native Chrome pagination, so long text may clip or span pages. If it must be one page, look at Pro's single-page auto-fit.
- Data is single-record injection plus #array.field detail rows (row count fixed by the template). There's no dynamic loop that expands one row into N, and multi-page batch via a data array is in Pro.
- Fixed single concurrency, fine for single documents and low-frequency generation. For high-concurrency production, weigh Pro's guardrails.
- Defaults cap templates at 5MB and cells at 20000; beyond that it errors out. Adjusting those caps is in Pro.

**Pro consulting / free POC**: send 3 of your real templates; within 48 hours we return Pro output and a benchmark comparison report. 📧 business@krstation.com

---

## Deployment

### System dependencies

Bundled headless Chrome (~150MB), auto-downloaded on postinstall. Linux servers need Chrome's system libraries: the install script probes missing libs via `ldd` and `apt-get` installs them (requires root or passwordless sudo); without permission it prints the manual command and does not interrupt. Common dependencies:

```bash
# Debian / Ubuntu (libasound2 / libasound2t64 chosen by distro version)
apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libgbm1 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libpango-1.0-0 libpangocairo-1.0-0 libcairo2 libxshmfence1 libasound2
```

### Docker example

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

`option` (community): `pageSize` / `orientation` / `margin` / `defaults` / `plugins` / `markerRegex` / `markerSeparator`.

---

## Known limits & FAQ

**Q: Long text clips or spans pages?**
Community uses native Chrome pagination; long text may clip or span. Pro offers single-page auto-fit (overflow converges to one page without clipping). In community, reserve enough space in the template or control field length on the business side.

**Q: Dynamic detail rows?**
Community ships #array.field index-mapping detail rows: repeat the marker per row in the template and the engine takes successive array indices (row count fixed by template; reserve enough repeated rows). It does not auto-expand one marker row into N rows; for emitting many pages from one template (data array), use Pro's array batch.

**Q: Which barcode symbologies?**
Community ships Code128 (`barcode`) and QR Code (`qrcode`), generated as PNG by bwip-js. More symbologies and automatic image compression are in Pro.

**Q: Need Office or LibreOffice?**
No. Bundled headless Chrome rendering, no Office engine dependency.

**Q: Concurrent calls?**
Community is fixed single concurrency (excess queued). For high concurrency, evaluate Pro guardrails or manage your own queue.

**Q: Missing fonts?**
Community relies on Chrome font fallback; glyphs may differ from Excel when a font is missing. Pro offers a font-missing guard (detect + warn / optional strict mode).

---

## Maintenance & versioning

We run this library in our own production for business documents. Versions follow SemVer; changes are logged in [CHANGELOG.md](./CHANGELOG.md). The community edition is maintained going forward, and its scope is whatever the comparison table above says.

---

## Feedback & Pro

- Issues / feature requests: [GitHub Issues](https://github.com/krstation-open/xlsx2pdf/issues)
- Pro consulting / free POC: 📧 business@krstation.com
- Website: [https://www.krstation.com/](https://www.krstation.com/)

---

## Contributing

Issues and PRs welcome. Sign the CLA before submitting a PR (see [CONTRIBUTING.md](./CONTRIBUTING.md)). Pro's proprietary technology is out of scope for this repository; related implementation contributions are not accepted.

Repository: `https://github.com/krstation-open/xlsx2pdf.git`. Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/) (husky `commit-msg` + commitlint), format `<type>(<scope>): <subject>`, header ≤ 100 characters.

Local dev flow:

```bash
npm run build      # esbuild dual output (ESM/CJS)
npm run redline    # red-line scan (must be zero hits)
npm test           # ESM smoke
npm run test:cjs   # CJS smoke
npm run test:media # rich-media guard (image/barcode/qrcode + overlay + size normalize)
```

---

## License

[Apache-2.0](./LICENSE) © 恺睿（深圳）软件科技有限公司

The community edition is free for commercial use. Pro is a separate closed-source product under a commercial EULA, unrelated to this repository's code.