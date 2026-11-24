# Changelog

All notable changes to **xlsx2pdf** (community edition) are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versioning follows [SemVer](https://semver.org/).

## [Unreleased]

## [1.7.0] - 2026-11-24

### Added

- Built-in `watermark` text-watermark marker (`print` is a legacy alias): overlay params `zindex` / `opacity` shared with images, width follows the cell and font size inherits the cell; empty values clear the marker, numFmt inheritance applies. Watermarks auto-fitting font size and wrapping to the layout remain a Pro capability.
- Precise scaling via `option.scale` (1~400%, capped at 400 to match Excel's print-scaling limit): 100 is synonymous with `'auto'`, non-positive / non-numeric values fall back to auto without throwing; a scale set in the template's page setup already applied and keeps working. `scale` values above 1 no longer trigger the out-of-bounds width fallback.
- `option.emptyRowPlaceholders` (array of strings, default `[]`): rows made entirely of the given placeholders (e.g. `--`) are treated as empty rows with row heights preserved. Adaptive-shrink interplay remains Pro.
- Browser lifecycle configure keys: `browserIdleMs` (idle auto-reclaim), `browserRecycleRenders` (render-count recycling at safe points), `browserMaxAgeMs` (wall-clock age rotation at safe points), `protocolTimeoutMs` (CDP call hang ceiling, integer ms ≥1000). Recycling / rotation never interrupt an in-flight generation.
- `configure({ onEvent })` render event hook: 8 stage events (`html` / `render.wait` / `render.chrome` / `render.print` / `render` / `merge` / `rotate` / `done`) with timing and size fields, ready to bridge into pino or any logger (zero new dependencies). A throwing hook never breaks generation; when unconfigured there is zero overhead (no event object constructed). Coexists with the Pro observe sink.
- Size-guard parameterization: `maxCells` / `maxTemplateSize` accepted via both option and configure (numbers only, 0/negative disables the guard); the well-meaning defaults of 20000 cells / 5MB are unchanged. Relaxing above the defaults without Pro guards triggers a one-time bilingual runtime warning — see the new Deployment risk note.
- Configurable marker type aliases (`markerAliases`, option & configure): whole-object replacement semantics, `null` restores the built-in `img`→`image` / `print`→`watermark`, `{}` clears all aliases. A disabled built-in alias token with no registered dedicated type now throws the new stable error code `E_MARKER_ALIAS` instead of silently rendering as text; other unknown type names keep the text fallback. A plugin registering an alias-named type takes over that alias slot silently. `helpers.parseMarkerOption` accepts an optional third `aliases` argument.
- Seven new boundary guards (scale / lifecycle / empty-row / onEvent / watermark / size-params / aliases) and a `npm run test:boundary` script.

### Changed

- **Default behavior change — idle browser reclaim**: the browser singleton now closes automatically after 60s idle (`browserIdleMs` defaults to 60000) and the next call rebuilds it; the cost is one cold start, with the same semantics as a manual `closeBrowser()`. Previously the singleton stayed resident until `closeBrowser()` or process exit. To keep the old resident behavior, set `configure({ browserIdleMs: 0 })`.
- Community/Pro boundary: precise scaling, the basic watermark form, empty-row placeholder recognition, size-guard parameterization and browser lifecycle configuration move into the community edition. Pro keeps watermark layout auto-fit, single-page adaptive layout, automatic image compression + DPI-aware sizing, `autoInsertImage`, array batch / `batchSize`, pixel-accurate column width + font-missing guard, custom paper, landscape print-control adaptation, memory admission and `maxPages`.
- option / configure gate cleanup: the keys released in this version are removed from the Pro-only guidance lists (remaining Pro option keys: `fitToPage` / `minFontSize` / `pageRotate` / `fontGuard` / `memoryGuard` / `maxPages` / `batchSize`); configure now accepts fourteen community keys and keeps silently ignoring undeclared guardrail keys. Internal gating lists were trimmed to the keys actually declared — no behavior change for valid inputs.
- README (EN/zh-CN), nine sections updated in parallel: features, marker syntax (+ new type-alias section), comparison matrix, feature-status table, deployment (+ browser-lifecycle section and size-cap relaxation risk note), API (+ new observability section with the 8-event table), extensions, FAQ (4 new entries), contributing.
- docs/errors.md: added `E_MARKER_ALIAS` (code table 28 → 29); `E_MARKER_PRO` description updated (no Pro-exclusive marker types at present; the guidance mechanism is retained).

## [1.6.3] - 2026-11-24

### Changed

- Multi-page batch performance: template parsing and data filling are now separated — the template skeleton is parsed once per call and reused across pages, and buffer / precheck / font / image caches are shared across pages within a call. Single-page and multi-page HTML output is byte-identical to 1.6.2 (verified by a 13-case byte-comparison harness covering plain, detail-row, image and real static templates).
- Multi-page render scripts can be injected once per document through the new internal `scriptPreamble` seam (no community behavior change; consumed by Pro).
- The landscape `/Rotate` rewrite pass is skipped when every page is portrait by geometry (Pro-only path; no output change).

### Added

- Internal `mergePdf` seam and Pro-only option key `batchSize` (positive integer, default 10): when the page count exceeds `batchSize`, Pro renders in batches and merges the results in page order, with inter-batch concurrency bounded by the existing guardrails. The community edition raises the standard guidance error when `batchSize` is passed via option; configure does not accept the key in either edition.
- README (EN/zh-CN): comparison-matrix row and Pro-only list entry for batched multi-page output; option / configure sections document the `batchSize` entry-point difference.

## [1.6.2] - 2026-11-20

### Fixed

- Browser singleton cold-start race: the shared launch Promise is now established before the first `await` (browser-path resolution is itself async). Previously concurrent `getBrowser()` calls on a cold start could each launch a separate Chrome instance, because `launchPromise` was only assigned after path resolution. Launch failures still reset the shared Promise and rethrow the coded error. Guarded by concurrency-option-guard ⑥ (8 concurrent cold-start calls share one instance).
- Render-slot scheduling under mixed concurrency caps: queue entries now carry their own `maxConcurrency`, and `releaseSlot` wakes the first queued request whose own cap is satisfied. Previously the queue head was woken unconditionally, so a low-cap call-level request could exceed its own limit under the shared running counter. A blocked head no longer stalls later higher-cap entries, and any cap is admitted once the counter reaches zero (no deadlock). Guarded by concurrency-option-guard ⑦.
- Plugin registration atomicity: `use()` now validates the entire plugin before committing any state. A plugin with valid `markerTypes` / `fieldResolvers` but an invalid `transformModel` previously left half-applied global registrations behind. Guarded by error-code-guard (failed registration leaves no residue in any of the three registries).

### Changed

- Image cache stores the in-flight Promise instead of the resolved value: concurrent same-key calls share one download/encode pass. Latent under the current sequential engine walk; hardening for seam/plugin parallelism. Degradation semantics unchanged.
- Registry duplicate-name warning and JSDoc now describe the actual semantics: `markerTypes` override by type name, while `fieldResolvers` / `transformModel` append in registration order (the previous wording claimed a full override that never applied to resolvers/hooks). No behavior change.
- CI runs the full guard suite: `test:robustness` / `test:cancel` / `test:concurrency` / `test:mdw` added to the Node 18/20/22 × ubuntu/windows matrix.
- Guards: cancel-guard adds a 10-round cyclic abort stress loop (queue/slot/tab leak and deadlock check after repeated cancellation); mdw-guard extends font-alias and multi-size coverage (NSimSun / SimHei / KaiTi / FangSong, YaHei 10pt, Latin 9/12pt).
- README (EN/zh-CN): Pro's single-page capability is now described as **adaptive layout** (font-size / row-height adjustment from actual browser rendering, global and per-cell minimum font floors, content-aware row-height adjustment, image/barcode/QR/watermark row protection) instead of a simple auto-fit scaler. The unconditional "no clipping, no lost data" claim is removed: the comparison row, the explanation paragraph and a new FAQ entry state the explicit boundary — minimums apply, and extreme overflow is clipped with a warning. Why-xlsx2pdf and the Pro-only feature list updated accordingly; no algorithm implementation details disclosed.
- No output change on the normal path: all fixes are internal robustness hardening; PDF/HTML results for successful generations are byte-identical to 1.6.1.

## [1.6.1] - 2026-11-20

### Fixed

- MDW heuristic: the Microsoft YaHei family now has a dedicated table (both the Chinese name 微软雅黑 and the English name Microsoft YaHei). Previously the Chinese name coincidentally hit the CJK monospace table via the character “黑” (MDW 8 at 11pt) while the English name fell through to the Latin branch (MDW 7); YaHei digits are wider than SimSun's (~9px at 11pt), so YaHei-default templates rendered narrow. DengXian / 等线 intentionally stays on the Latin branch: its digit metrics are Calibri-derived (Chinese Excel's default column is 64px at MDW 7) — the fractional canvas width must not be rounded up into the CJK table. Guarded by new mdw-guard assertions.

### Changed

- README (EN/zh-CN): community-limit paragraph now lists YaHei coverage and adds an upgrade note — column widths of Chinese templates changed in 1.6.0, so users upgrading from 1.5.x with pixel-level visual baselines should re-run them.

## [1.6.0] - 2026-11-20

### Changed

- Column-width fidelity: the community edition now converts Excel character-width units with the official formula using the **workbook default font's MDW** (digit "0" pixel width), via a built-in common-font heuristic table (SimSun / SimHei / KaiTi / FangSong by size, conservative Latin ratios). Previously a fixed Calibri-11 basis (MDW 7) rendered SimSun-11 templates ~13% narrow — tables sat left-aligned with an oversized right margin instead of filling the paper (e.g. A3). Templates without a readable default font keep the historical MDW 7 behavior; Calibri/Latin templates are unchanged. Pro keeps the seam override plus browser-measured per-column correction (precision differentiation unchanged).
- README (EN/zh-CN): community-limit paragraph and comparison matrix updated (official formula + common-font heuristic vs browser-measured pixel accuracy).

### Added

- `test/mdw-guard.mjs` regression guard (heuristic table, official formula, styles.xml default-font fixture integration, seam-override precedence); `npm run test:mdw`.

## [1.5.0] - 2026-11-20

### Added

- Cancellation support: `option.signal` accepts an `AbortSignal` on both generation APIs (invalid types throw `E_OPTION_INVALID`). Already-aborted requests fail fast at entry; checkpoints run between pages and before memory admission / slot acquisition; queued requests are removed from the wait queue on abort (no slot held); an in-flight render is interrupted and rejects with the new `E_CANCELLED` code. Cancellation is cooperative best-effort: queued requests are removed, open tabs closed, the browser singleton kept for reuse. Pro's memory-admission polling does not observe the signal (its own `maxWaitMs` timeout applies); documented boundary.
- Structured `warnings` channel on results: `excel2pdf → { pdf, html, warnings }`, `excel2html → { html, warnings }` (additive, backward compatible). Per-generation array (concurrency-safe), collecting engine-side degradation warnings only; existing `console.warn` output is preserved. Page-console forwarding stays on console (no noise in the array).
- Image content validation at all three entry points (base64 DataUrl, HTTP download, local file) via the existing `image-size` dependency — magic bytes / structure are verified instead of trusting content-type or extension. Corrupted or non-image content degrades to empty (marker cleared) with a warning, consistent with the existing "unsupported image value" semantics — one broken image never fails the whole report. Local file read failures are now warned instead of silently swallowed.
- New error code `E_PLUGIN_RUNTIME` (code table 26 → 28): `fieldResolvers` / `transformModel` runtime failures now fail fast with a coded bilingual error (previously uncoded); already-coded errors rethrow unchanged. Marker `handler` failures keep the existing degrade-and-continue behavior, now additionally recorded in `warnings` (message annotated with `E_PLUGIN_RUNTIME`). Directly-called `helpers` remain the caller's responsibility (documented boundary).
- `docs/errors.md`: `E_PLUGIN_RUNTIME` / `E_CANCELLED` entries, `E_RENDER` entry covers new-tab failures and close-failure non-masking, `E_PLUGIN_INVALID` clarifies registration-vs-runtime division, new bilingual "Degradation policy" section.
- README (EN/zh-CN): `signal` option row, `warnings` result shape, dedicated Cancellation (`#cancel`) and Degradation warnings (`#warnings`) sections with examples, image-validation and plugin-error notes, feature-status appendix rows marked 1.5.0.
- `index.d.ts`: `GenerateOptions.signal`, `warnings: string[]` on both result interfaces, JSDoc synced.
- `test/robustness-guard.mjs` (corrupted-image degradation at all three entry points, handler-failure degradation, empty warnings on clean runs, full-chain merge) and `test/cancel-guard.mjs` (pre-abort, mid-render abort + browser reuse, queue removal without slot hold); `error-code-guard.mjs` extended for the new codes; `npm run test:robustness` / `npm run test:cancel`.

### Changed

- Render robustness (pdf.js): `page.close()` failures in cleanup no longer mask the original error code; browser acquisition / new-tab failures are wrapped as `E_RENDER` (coded errors rethrow unchanged); the `disconnected` listener now checks instance identity, so a late disconnect from an old browser can no longer clear a rebuilt singleton.
- In-browser image decode failures are counted and reported via `warnings` (previously a silent `.catch(() => {})` blind spot); printing behavior unchanged.
- Internal `htmlToPdf` now returns `{ buffer, warnings }` (its only consumer is the package entry; Pro does not call it directly).

## [1.4.0] - 2026-11-20

### Added

- Render concurrency is now configurable in the community edition: `maxConcurrency` accepted by both `configure()` and per-call `option` (per-call wins), default **1 unchanged**, excess requests queued as before. Positive integers only — 0 / negatives / fractions / non-numbers throw `E_OPTION_INVALID` (there is no "0 = unlimited" semantics; unbounded concurrency without admission control is exactly the OOM posture the semaphore exists to prevent).
- One-time runtime warning when `maxConcurrency` is set above 1 without a memory-admission guard (bilingual, once per process), pointing at the memory risk and the Pro guard.
- README (EN/zh-CN): dedicated Deployment risk note — Chrome memory grows linearly with open tabs (~400–500MB baseline, ~+100MB per tab floor), raising concurrency on small containers can OOM the whole host process, memory budgeting formula, multi-worker footprint note; option / configure tables, precedence list, comparison matrix, feature-status appendix and FAQ updated accordingly.
- `test/concurrency-option-guard.mjs` regression guard (validation, one-time warning, peak-tab throttling, per-call override); `npm run test:concurrency`.

### Changed

- Community/Pro boundary: `maxConcurrency` leaves the Pro-only `resourceGuards` key set (no more `E_OPTION_PRO` for it); Pro keeps the memory-admission guard and template-size guardrail parameterization. Pro's historical `maxConcurrency` contract (0 / Infinity = unlimited) is preserved when Pro declares the key via seams.
- `docs/errors.md`: `E_OPTION_PRO` no longer lists `maxConcurrency`; `E_OPTION_INVALID` documents the always-enforced positive-integer check.
- `index.d.ts`: `maxConcurrency` added to `GenerateOptions` and `BrowserOptions` with defaults / precedence / risk notes.

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
- Pure-JS image size normalization (`image-size`, 96 DPI) when width/height are unset; setting one side derives the other by aspect ratio. No compression (automatic compression & DPI-aware sizing remain in Pro).
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

[1.7.0]: https://github.com/krstation-open/xlsx2pdf/tree/v1.7.0
[1.6.3]: https://github.com/krstation-open/xlsx2pdf/tree/v1.6.3
[1.6.2]: https://github.com/krstation-open/xlsx2pdf/tree/v1.6.2
[1.6.1]: https://github.com/krstation-open/xlsx2pdf/tree/v1.6.1
[1.6.0]: https://github.com/krstation-open/xlsx2pdf/tree/v1.6.0
[1.5.0]: https://github.com/krstation-open/xlsx2pdf/tree/v1.5.0
[1.4.0]: https://github.com/krstation-open/xlsx2pdf/tree/v1.4.0
[1.3.0]: https://github.com/krstation-open/xlsx2pdf/tree/v1.3.0
[1.2.0]: https://github.com/krstation-open/xlsx2pdf/tree/v1.2.0
[1.1.0]: https://github.com/krstation-open/xlsx2pdf/tree/v1.1.0
[1.0.1]: https://github.com/krstation-open/xlsx2pdf/tree/v1.0.1
[1.0.0]: https://github.com/krstation-open/xlsx2pdf/tree/v1.0.0
