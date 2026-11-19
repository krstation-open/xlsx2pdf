# Changelog

All notable changes to **xlsx2pdf** (community edition) are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versioning follows [SemVer](https://semver.org/).

## [Unreleased]

## [1.3.0] - 2026-11-19

### Added

- README (EN/zh-CN): Deployment section opens with a "Platform support" note — the bundled Chrome auto-downloads per OS (Windows / macOS Intel & Apple Silicon / Linux), Windows/macOS need no extra system dependencies for local development, plus mirror / retry / cache-location / pinned-version details and postinstall-failure recovery.
- README (EN/zh-CN): "Feature list and status" appendix (`#status`) — a single table with a checkbox status column (☑ implemented, carrying the introduction version; ☐ not yet implemented, no version shown), plus Pro-only capabilities listed by effect name. Maintenance section now references the appendix alongside the comparison table.
- Stable error codes: every failure now throws `Xlsx2pdfError` with a stable `err.code` (26 `E_*` codes) and a bilingual message (Chinese original preserved verbatim, English appended — existing message matching keeps working). Per-code reference with causes, fixes and anchors in `docs/errors.md`; `test/error-code-guard.mjs` + `npm run test:errors`.
- CLI `xlsx2pdf convert` (zero new dependencies): `--data` JSON string / `@file.json`, `--out`, `--html` (HTML-only, no browser), `--page-size` / `--orientation` / `--margin`; shares the conversion pipeline with the example; failures print code + bilingual message + doc anchor and exit non-zero.
- `examples/basic.mjs` one-shot example (`npm run example`): generates a demo template on the fly (no private assets) and outputs `examples/output/demo.pdf`; shipped inside the package.
- GitHub Actions: CI matrix (Node 18/20/22 × ubuntu/windows) with bundled-Chrome install cache; Release workflow (tag push → CHANGELOG section → GitHub Release) with `workflow_dispatch` backfill for historical tags; `scripts/release-notes.mjs` section extractor.
- `index.d.ts`: per-option defaults / precedence / invalid-value (`null` / `''`) semantics documented; `Xlsx2pdfError` class declaration exported.

### Changed

- README (EN/zh-CN): Platform support note clarifies the bundled Chrome is a separate auto-downloaded build that does not reuse local Chrome by default (set browserPath / XLSX2PDF_BROWSER_PATH and skip the download to reuse a local one).
- README (EN/zh-CN): documented the intentional option-vs-configure difference for Pro guardrail keys — option raises an explicit error for Pro keys and unknown keys (fail fast), while configure silently ignores undeclared keys and runs on the fixed safety caps; cross-referenced the option, configure and Deployment safety-caps sections so the contrast is no longer read as a contradiction.
- README (EN/zh-CN): narrative voice uses organizational "we" instead of personal "I" (krstation-open is an organization project); the CLA attestation "I" in CONTRIBUTING is intentionally kept.
- README (EN/zh-CN): CI badge; quick start adds CLI usage and the one-shot example; new "Error handling" section (stable codes + `Xlsx2pdfError` + `docs/errors.md`); safety-caps wording updated from "Chinese error" to coded bilingual errors; API table and FAQ gain error-code entries.

## [1.2.0] - 2026-11-16

### Added

- Community built-in `#array.field` detail-row index mapping (previously Pro-gated): repeated marker rows take successive array indices (`arr.0.field`, `arr.1.field`…); row count fixed by the template, nested fields & numFmt inheritance supported. Not an auto-expanding loop; multi-page batch via `data` array remains Pro.
- `test/detail-row-guard.mjs` regression guard; `npm run test:detail` script.

### Changed

- README (EN/zh-CN) restructured: quickstart with first-install Chrome-download notice, explicit "Excel template → high-fidelity HTML → PDF" pipeline, scope clarification, own-advantage positioning (competitor comparison removed), corrected capability table (rich media & detail rows now community; `/Rotate`, custom paper, watermark, image compression stay Pro) with a plain-language single-page auto-fit note and Clodop gloss, table-of-contents, deployment & safety-cap defaults, Docker `libasound2t64` fallback, pipe-escape note for marker tables, full option types/defaults/precedence + `defaults` example, production endorsement, de-duplicated FAQ.
- Added CHANGELOG.md (shipped with the package).

## [1.1.0] - 2026-11-16

### Added

- Built-in rich-media markers: `image` / `img` (local path, http(s) URL, base64 DataUrl), `barcode` (Code128), `qrcode` (QR Code).
- Overlay parameter keys for rich-media markers: `w` / `h` / `ox` / `oy` / `zindex` / `opacity`.
- Pure-JS image size normalization (`image-size`, @96DPI) when width/height are unset; setting one side derives the other by aspect ratio. No compression (automatic compression & DPI-aware sizing remain in Pro).
- `helpers.generateCode` and `helpers.bufferToDataUrl` (engine-homologous, now 7 helpers).
- `test/media-guard.mjs` rich-media regression guard; `npm run test:media` script.

### Changed

- Community/Pro boundary: basic image/barcode/qrcode embedding moves into the community edition; Pro keeps automatic image compression, DPI-aware sizing, `autoInsertImage`, watermark markers, single-page auto-fit, pixel-accurate column width, array batch, production guardrails, custom paper and landscape print adaptation.
- README (EN/zh-CN) restructured: 30-second quickstart, scope clarification, corrected capability table, deployment & safety-cap defaults, real extension API, FAQ.
- Red-line scan updated for the new boundary: `bwip-js` / `image-size` are legitimate community dependencies; `sharp` is blocked at import/dependency level (comments allowed).

### Dependencies

- Added `bwip-js` (barcode/QR generation) and `image-size` (dimension probing). Both pure JS — no native compilation.

## [1.0.1] - 2026-11-16

### Changed

- First publicly available release on registry.npmjs.org. (1.0.0 was unpublished and its version number permanently reserved by npm; re-released as 1.0.1.)
- Package author metadata set to `royhatsune <royhatsune@gmail.com>`.

## [1.0.0] - 2026-11-13

### Added

- Initial open-source community baseline: Excel-template marker substitution, nested dot paths, marker defaults, in-cell multi-marker mixing with local rich-text inheritance, style fidelity (merged cells / fonts / colors / borders), automatic numFmt inheritance, standard paper & page setup, bundled headless Chrome, `excel2html`, three extension points (`use` / `option.plugins`), custom marker syntax, ESM/CJS dual mode + TypeScript declarations, template-size / cell-count safety caps.

[1.3.0]: https://github.com/krstation-open/xlsx2pdf/tree/v1.3.0
[1.2.0]: https://github.com/krstation-open/xlsx2pdf/tree/v1.2.0
[1.1.0]: https://github.com/krstation-open/xlsx2pdf/tree/v1.1.0
[1.0.1]: https://github.com/krstation-open/xlsx2pdf/tree/v1.0.1
[1.0.0]: https://github.com/krstation-open/xlsx2pdf/tree/v1.0.0
