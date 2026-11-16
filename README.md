# xlsx2pdf

[English](./README.md) | [简体中文](./README.zh-CN.md)

> Design templates in Excel, generate high-fidelity PDFs in one call — a Node.js server-side Excel-template → PDF library (community edition).

[![npm](https://img.shields.io/npm/v/xlsx2pdf)](https://www.npmjs.com/package/xlsx2pdf)
[![downloads](https://img.shields.io/npm/dw/xlsx2pdf)](https://www.npmjs.com/package/xlsx2pdf)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
![node](https://img.shields.io/badge/node-%3E%3D18.17-green)

**Official website / 官网**: [https://www.krstation.com/](https://www.krstation.com/)

**The template is the design**: business users lay out reports in Excel and write `${field}` markers; your backend injects data and produces PDFs that match what Excel shows. No hand-written HTML, no CSS alignment tweaks, no browser to provision.

## Why

Moving fixed-template reports / invoices / forms into backend batch PDF generation, the usual routes all have pitfalls:

- **LibreOffice headless**: heavy, hard to run concurrently, poor fidelity for merged cells / rich text / custom paper, and no data-injection capability;
- **exceljs + pdfkit hand-drawing**: you end up writing your own rendering engine — column widths, fonts and pagination are all pitfalls;
- **Hand-written HTML + Puppeteer**: CSS alignment hell, styles drift when you swap engines, memory grows linearly with concurrency.

xlsx2pdf compresses the pipeline to two steps — "design template → inject data" — with a bundled headless Chrome for consistent rendering.

## Features (community edition)

- ✅ Excel template marker substitution: `${field}`, nested dot paths `a.b.c`, marker defaults, `option.defaults`
- ✅ Multiple markers per cell: several markers mixed with static text in one cell (e.g. `${temp}℃ / ${humi}%`), each segment substituted independently, inheriting its local rich-text formatting
- ✅ Style fidelity: merged cells, font / color / background / borders, in-cell local rich text
- ✅ Number formats inherited automatically: percent / currency / thousands / date, matching Excel display
- ✅ Standard paper A3/A4/A5/B4/B5/letter/legal, orientation & margins, template page setup takes priority
- ✅ Bundled headless Chrome auto-install (mirror-friendly), or reuse an external browser
- ✅ `excel2html`: render only, no browser launch, lightweight HTML output
- ✅ Custom extensions: `use(plugin)` / `option.plugins`, three extension points (marker types / field resolvers / model hooks)
- ✅ Custom marker syntax: `markerRegex` / `markerSeparator` (per-call or global configure)
- ✅ ESM / CJS dual mode + TypeScript declarations
- ✅ Built-in template size / cell-count safety caps, fail fast on abnormally large templates
- ✅ Built-in rich-media markers: `image`/`img` (local path / http(s) URL / base64 DataUrl), `barcode` (Code128), `qrcode`; overlay params (`w/h/offset/zIndex/opacity`); unset size auto-normalized to original dimensions

## Install

```bash
npm i xlsx2pdf
```

postinstall auto-downloads the bundled Chrome (~150MB). If the server already has Chrome/Chromium, skip the download and reuse it:

```js
import { configure } from 'xlsx2pdf';
configure({ browserPath: '/usr/bin/chromium' });
```

## Quick start

1. Design a template `tpl.xlsx` in Excel; write markers in the cells that need dynamic values:

| Name   | `${name}`   |
| ------ | ----------- |
| Dept   | `${dept}`   |
| Amount | `${amount}` |
| Date   | `${date}`   |

2. Inject data, generate in one line:

```js
import { excel2pdf } from 'xlsx2pdf';
import { writeFileSync } from 'node:fs';

const { pdf } = await excel2pdf({
  template: './tpl.xlsx',
  data: { name: 'Alice', dept: 'QA', amount: 1234.5, date: new Date() },
});
writeFileSync('out.pdf', pdf);
```

If the amount cell uses a `¥#,##0.00` format, the output shows `¥1,234.50` automatically — number formats need no marker parameters.

## Marker syntax (community edition)

```
${field}                  text substitution (default type)
${field|text}             explicit text
${field|text_default:N/A} default text when empty
${a.b.c}                  nested object dot path
${temp}℃ / ${humi}%       multiple markers + static text in one cell
${photo|image_w100_h80}   image (local path / http(s) URL / base64 DataUrl)
${code|barcode_w120_h40}  Code128 barcode
${qr|qrcode_w80_h80}      QR code
${logo|image_zindex2_opacity0.5}  overlay: z-index / opacity / offset
```

A cell can hold any number of markers freely mixed with static text, each substituted independently; give a marker segment its own bold / color / size in Excel (local rich text) and the substituted value inherits that segment's formatting — no parameter keys needed.

Data objects support arbitrary nesting; when `data` is omitted, one empty template page is rendered (markers cleared via defaults / empty values).

Marker syntax is customizable: `option.markerRegex` (or global `configure({ markerRegex })`) replaces the built-in `${...}` matching rule (contract: `g` flag + capture group 1 = marker content); `option.markerSeparator` replaces the internal "field / type_params" separator (default `|`). Pass `null` to restore the built-in defaults.

## Custom extensions

Three extension points, two registration levels: global `use(plugin)` (process-wide) / per-call `option.plugins` (this generation only, same-name overrides global, avoiding multi-tenant concurrency pollution):

```js
import { excel2pdf, use } from 'xlsx2pdf';

use({
  name: 'my-plugin',
  // ① custom marker type: ${code|upper} → uppercase text
  markerTypes: {
    upper: async (value) => String(value ?? '').toUpperCase(),
  },
  // ② field resolver: first non-undefined hit wins, else falls back to data/defaults
  fieldResolvers: [async (field) => (field === 'now' ? new Date().toISOString() : undefined)],
  // ③ model post-process hook: last chance to mutate the model before render
  transformModel: (model) => model,
});
```

Marker-type handler return contract: `string` → text substitution; `{ images: [{ dataUrl, width?, height?, ... }] }` → image overlay; `{ watermarks: [{ text, opacity?, ... }] }` → text watermark overlay; mixed objects also work; `null/undefined` → clear the marker. Image / watermark overlay parameters align with the commercial edition's same-named markers.

Extension development can reuse engine-homologous utilities: `import { helpers } from 'xlsx2pdf'` provides `getFileBuffer` / `flattenObject` / `parseMarkerOption` / `validateMarkerRegex` / `formatValue` / `generateCode` / `bufferToDataUrl` — the same implementation the engine uses internally, so behavior never drifts.

## API

| Function                                                                         | Description                                                    |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `excel2pdf({ template, data, option })`                                          | one-stop generation, returns `{ pdf: Buffer, html: string }`   |
| `excel2html({ template, data, option })`                                         | render HTML only, no browser launch                            |
| `configure({ browserPath, headless, launchArgs, markerRegex, markerSeparator })` | global browser behavior & marker syntax                        |
| `ensureBrowser()` / `closeBrowser()`                                             | bundled browser ready / close on process exit                  |
| `use(plugin)`                                                                    | register an extension plugin globally (three extension points) |
| `helpers`                                                                        | extension-development utility namespace (engine-homologous)    |
| `getVersion()`                                                                   | current package version                                        |

`option` (community edition): `pageSize` / `orientation` / `margin` / `defaults` / `plugins` / `markerRegex` / `markerSeparator`.

## Community vs Pro

The community edition covers the full "text-report template → PDF" pipeline plus basic rich-media embedding. These production-grade capabilities are offered in the commercial Pro edition:

| Capability                                                    | Community                                  | Pro                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------- |
| Overflow content                                              | native Chrome pagination (may clip / span) | **single-page auto-fit, converges without clipping**                                  |
| Column-width precision                                        | public-formula approximation               | **pixel-accurate conversion + font-missing guard**                                    |
| Image / barcode / QR markers                                | ✅ basic embed + overlay params + size normalize | **+ auto image compression & DPI-aware sizing, autoInsertImage, watermark**       |
| Array multi-page batch + detail-row syntax                    | —                                          | ✅ hundreds of documents from one template                                            |
| Custom paper (receipt rolls) direct read                      | —                                          | ✅                                                                                    |
| Landscape WPS / Clodop print adaptation                       | —                                          | ✅ automatic `/Rotate` rewrite                                                        |
| Concurrency limiting / memory admission guard                 | fixed single concurrency                   | ✅ parameterized production guardrails                                                |
| Custom extensions (3 extension points + custom marker syntax) | ✅ use/plugins + built-in rich-media basic types + helpers | ✅ same mechanism + sharp/autoInsert advanced helpers                             |
| Support                                                       | community issues                           | SLA tickets + dedicated group                                                         |

**Pro consulting / free POC**: send 3 of your real templates; within 48 hours we return Pro output and a benchmark comparison report.

- 📧 business@krstation.com
- Website: [https://www.krstation.com/](https://www.krstation.com/)

## Requirements

- Node.js ≥ 18.17; Linux servers need Chrome's system libraries (the install script auto-detects and prompts).
- For Docker, a `node:18+` base image is recommended; prefer a single worker.

## Contributing (commit convention)

Issues and PRs welcome. Sign the CLA before submitting a PR (see [CONTRIBUTING.md](./CONTRIBUTING.md)). Pro's proprietary technology is out of scope for this repository; related implementation contributions are not accepted.

Repository: `https://github.com/krstation-open/xlsx2pdf.git`. Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/), enforced by a husky `commit-msg` hook + commitlint; non-conforming commits are rejected.

Format: `<type>(<scope>): <subject>` (scope optional, header ≤ 100 characters).

| type       | meaning                      |
| ---------- | ---------------------------- |
| `feat`     | new feature                  |
| `fix`      | bug fix                      |
| `docs`     | documentation                |
| `style`    | formatting (no logic change) |
| `refactor` | refactor (not feature/fix)   |
| `perf`     | performance                  |
| `test`     | tests                        |
| `build`    | build system / external deps |
| `ci`       | CI config                    |
| `chore`    | misc                         |
| `revert`   | revert                       |

Examples: `feat(plugin): add upper marker-type plugin`, `fix(render): preserve merged-cell borders`.

After cloning, `npm install` activates the husky hooks (`prepare` script). The local dev flow (build / red-line scan / smoke tests) is documented in CONTRIBUTING.md.

## License

[Apache-2.0](./LICENSE) © 恺睿（深圳）软件科技有限公司

The community edition is free for commercial use. Pro is a separate closed-source product under a commercial EULA, unrelated to this repository's code.
