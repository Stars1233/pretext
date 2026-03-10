## Pretext

Internal notes for contributors and agents. Use `README.md` as the public source of truth for API examples, benchmark/accuracy numbers, and user-facing limitations. Use `RESEARCH.md` for the detailed exploration log.

### Commands

- `bun start` — serve pages at http://localhost:3000 (kills stale `:3000` listeners first)
- `bun run check` — typecheck + lint
- `bun test` — lightweight invariant tests against the shipped implementation
- `bun run accuracy-check` / `:safari` / `:firefox` — browser accuracy sweeps
- `bun run benchmark-check` / `:safari` — benchmark snapshot with both the short shared corpus and long-form corpus stress rows
- `bun run gatsby-check` / `:safari` — Gatsby canary diagnostics
- `bun run gatsby-sweep --start=300 --end=900 --step=10` — fast Gatsby width sweep; add `--diagnose` to rerun mismatching widths through the slow checker
- `bun run probe-check --text='...' --width=320 --font='20px ...' --dir=rtl --lang=ar` — isolate a single snippet in the real browser

### Important files

- `src/layout.ts` — core library; keep `layout()` fast and allocation-light
- `src/measure-harfbuzz.ts` — HarfBuzz backend kept for ad hoc measurement probes
- `src/test-data.ts` — shared corpus for browser accuracy pages/checkers and benchmarks
- `src/layout.test.ts` — small durable invariant tests for the exported prepare/layout APIs
- `pages/accuracy.ts` — browser sweep plus per-line diagnostics
- `pages/benchmark.ts` — performance comparisons
- `pages/bubbles.ts` — bubble shrinkwrap demo

### Implementation notes

- `prepare()` / `prepareWithSegments()` do horizontal-only work. `layout()` / `layoutWithLines()` take explicit `lineHeight`.
- `prepare()` is internally split into a text-analysis phase and a measurement phase; keep that seam clear, but keep the public API simple unless requirements force a change.
- The internal segment model now distinguishes at least four break kinds: normal text, collapsible spaces, non-breaking glue (`NBSP` / `NNBSP` / `WJ`-like runs), and zero-width break opportunities. Do not collapse those back into one boolean unless the model gets richer in a better way.
- `layout()` is the resize hot path: no DOM reads, no canvas calls, no string work, and avoid gratuitous allocations.
- Word width cache is `Map<font, Map<segment, width>>`; shared across texts and resettable via `clearCache()`.
- Word and grapheme segmenters are hoisted at module scope. Any locale reset should also clear the word cache.
- Punctuation is merged into preceding word-like segments only, never into spaces.
- Arabic no-space punctuation clusters such as `فيقول:وعليك` and `همزةٌ،ما` are merged during `prepare()`; keep that logic in preprocessing, not `layout()`.
- That Arabic no-space merge set is intentionally narrow right now: colon / period / Arabic comma / Arabic semicolon. Repeated `!` was a counterexample that over-merged.
- If `Intl.Segmenter` emits an Arabic punctuation cluster with trailing combining marks (for example `،ٍ`), still treat the whole cluster as left-sticky punctuation during preprocessing. The browser keeps `بكشء،ٍ` together.
- If `Intl.Segmenter` emits `" " + combining marks` before Arabic text (for example `كل ِّواحدةٍ`), split it into `" "` plus marks-prefix-on-next-word during preprocessing.
- `NBSP`-style glue should survive `prepare()` as visible content and prevent ordinary word-boundary wrapping; `ZWSP` should survive as a zero-width break opportunity.
- Astral CJK ideographs must still hit the CJK path; do not rely on BMP-only `charCodeAt()` checks there.
- Non-word, non-space segments are break opportunities, same as words.
- CJK grapheme splitting plus kinsoku merging keeps prohibited punctuation attached to adjacent graphemes.
- Emoji correction is auto-detected per font size, constant per emoji grapheme, and effectively font-independent.
- Bidi levels are computed during `prepare()` and stored, but `layout()` does not currently consume them.
- Supported CSS target is the common app-text configuration: `white-space: normal`, `word-break: normal`, `overflow-wrap: break-word`, `line-break: auto`.
- `system-ui` is unsafe for accuracy; canvas and DOM can resolve different fonts on macOS.
- Thai historically mismatched because CSS and `Intl.Segmenter` use different internal dictionaries; keep it in the browser sweep when changing segmentation rules.
- HarfBuzz probes need explicit LTR to avoid wrong direction on isolated Arabic words.
- Accuracy pages and checkers are now expected to be green in all three installed browsers on fresh runs; if a page disagrees, suspect stale tabs/servers before changing the algorithm.
- Keep `src/layout.test.ts` small and durable. For browser-specific or narrow hypothesis work, prefer throwaway probes/scripts and promote only the stable invariants into permanent tests.
- For Gatsby canary work, sweep widths cheaply first and only diagnose the mismatching widths in detail. The slow detailed checker is for narrowing root causes, not for every width by default.
- For Arabic corpus work, trust the RTL `Range`-based diagnostics over the old span-probe path. The remaining misses are currently more about break policy than raw width sums.
- For Arabic probe work, always use normalized corpus slices and the exact corpus font. Raw file offsets or a rough fallback font will mislead you.
- The corpus/probe diagnostic pages now compute our line offsets directly from prepared segments and grapheme fallbacks; do not go back to reconstructing them from `layoutWithLines().line.text.length`.
- The Arabic corpus text has already been cleaned for quote-before-punctuation spacing artifacts like `" ،`, `" .`, and `" ؟`, plus a few obvious `space + punctuation` typos (`هيهات !`, `دجاك ؟!`, `القيان :`). Treat those as corpus hygiene, not engine behavior.
- The repeated Arabic fine-width miss around `قوله:"...` was also a source-text issue; normalizing that one occurrence to `قوله: “...` removed several widths without touching the engine.
- Thai prose can expose ASCII quote behavior like `ทูลว่า "พระองค์...`; treating `"` as contextual quote glue in preprocessing helps there without needing a Thai-specific rule.
- Current line-fit tolerance is `0.005` for Chromium/Gecko and `1/64` for Safari/WebKit. That bump was justified by the remaining Arabic fine-width field and did not move the solved browser corpus or Gatsby coarse canary.

### Open questions

- Locale switch: expose a way to reinitialize the hoisted segmenters and clear cache for a new locale.
- Decide whether line-fit tolerance should stay as a browser-specific shim or move to runtime calibration alongside emoji correction.
- If a future Arabic corpus still exposes misses after preprocessing and corpus cleanup, decide whether that needs a richer break-policy model or a truly shaping-aware architecture beyond segment-sum layout.
- `layoutWithLines()` now returns line boundary cursors (`start` / `end`) in addition to `{ text, width }`; keep that data model useful for future manual reflow work.
- ASCII fast path could skip some CJK, bidi, and emoji overhead.
- Benchmark methodology still needs review.
- `pages/demo.html` is still a placeholder.
- Additional CSS configs are still untested: `break-all`, `keep-all`, `strict`, `loose`, `anywhere`, `pre-wrap`.

### Related

- `../text-layout/` — Sebastian Markbage's original prototype + our experimental variants.

### TODO
- TweetDeck-style 3 columns of the same text scrolling at the same time
- Resize Old Man and the Sea
- Creative responsive magazine-like layout contouring some shapes
- Revisit whitespace normalization only for the remaining NBSP / hard-space edge cases, not ordinary collapsible whitespace
- Make `src/layout.ts` import-safe in non-DOM runtimes and add an explicit server canvas backend path
- Decide whether explicit hard line breaks / paragraph-aware layout belong in scope beyond the current `white-space: normal` collapsing model
- Decide whether automatic hyphenation / soft-hyphen support is in scope for this repo
- Decide whether intrinsic sizing / logical width APIs are needed beyond fixed-width height prediction
- Decide whether bidi rendering strategy work (selection / copy-paste preserving runs) belongs here or stays out of scope
- Decide whether richer text-engine features like ellipsis, per-character offsets, custom selection, vertical text, or shape wrapping should remain explicitly out of scope
