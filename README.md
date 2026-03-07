# text-metrics

Text measurement for the browser. Predicts text block heights without triggering layout reflow on the resize hot path.

## Problem

Measuring text in the browser requires DOM reads (`getBoundingClientRect`, `offsetHeight`), which trigger synchronous layout reflow. When UI components independently measure text — e.g. a virtual scrolling list sizing 500 comments — each measurement forces the browser to recompute layout for the entire document. This creates read/write interleaving that can cost 30ms+ per frame.

## Solution

Two-phase measurement centered around canvas `measureText()`:

```js
import { prepare, layout } from './src/layout.ts'

// Phase 1: measure word widths (once, when text appears)
const block = prepare(commentText, '16px Inter')

// Phase 2: compute height at any width (pure arithmetic, on every resize)
const { height, lineCount } = layout(block, containerWidth, 19)
```

`prepare()` segments text via `Intl.Segmenter`, measures each word via canvas, and caches the widths. On browsers that need emoji correction, it also does one cached DOM calibration read per font. `layout()` walks the cached widths to count lines and multiplies by the caller-provided `lineHeight` — no canvas, no DOM, no string operations. Each `layout()` call is ~0.0002ms.

## Performance

500 comments, resize to a new width (the hot path):

| Approach | Time | DOM-free |
|---|---|---|
| **text-metrics** | **0.11ms** | Yes |
| DOM batch (write all, read all) | 0.18ms | No |
| DOM interleaved (per-component) | varies, much worse in practice | No |
| Sebastian's text-layout (no cache) | 30ms | Yes |
| Sebastian's + word cache | 3ms | Yes |

## Accuracy

Tested across 4 fonts × 8 sizes × 8 widths × 30 i18n texts (7680 tests):

| Browser | Match rate | Tests | Remaining mismatches |
|---|---|---|---|
| Chrome | 99.96% | 7680 | Georgia rounding (2), Courier New Korean (1) |
| Safari | 99.92% | 7680 | Georgia rounding (2), bidi paren (1), Verdana/Courier New bidi (3) |
| Firefox | 99.95% | 7680 | Thai dictionary (3), Courier New Korean (1) |
| Headless (HarfBuzz) | 100% | 1920 | Algorithm is exact |

Tested across 4 fonts (Helvetica Neue, Georgia, Verdana, Courier New) × 8 sizes × 8 widths × 30 i18n texts. Remaining mismatches are font-specific measurement edge cases at borderline widths and browser-internal dictionary differences (Thai). Safari's mismatches are CSS line-breaking behavior differences (not measurement errors). See [RESEARCH.md](RESEARCH.md) for details.

## i18n

- **Line breaking**: `Intl.Segmenter` with `granularity: 'word'` handles CJK (per-character breaks), Thai, Arabic, and all scripts the browser supports.
- **Bidi**: Unicode Bidirectional Algorithm (UAX #9) for mixed LTR/RTL text. Pure LTR text fast-paths with zero overhead.
- **Shaping**: canvas `measureText()` uses the browser's font engine, so ligatures, kerning, and contextual forms (Arabic connected letters) are handled correctly.
- **Emoji**: auto-corrected. Chrome/Firefox canvas inflates emoji widths at small font sizes on macOS; the library detects and compensates automatically.

## Known limitations

- **CSS config**: targets the default (`white-space: normal`, `word-break: normal`, `overflow-wrap: break-word`, `line-break: auto`). Other configurations (`break-all`, `keep-all`, `strict`, `loose`, `anywhere`) are untested.
- **`line-height`**: the library does not infer CSS line height. Pass the exact value you render with into `layout()` / `layoutWithLines()`. `line-height: normal` differs across fonts and browsers.
- **`system-ui` font**: canvas and DOM resolve this CSS keyword to different font variants at certain sizes on macOS. Use a named font (Inter, Helvetica, Arial, etc.) for guaranteed accuracy. See [RESEARCH.md](RESEARCH.md#discovery-system-ui-font-resolution-mismatch).
- **Server-side**: requires a canvas implementation (browser, or `@napi-rs/canvas` with registered fonts). Headless tests use HarfBuzz (WASM) instead.

## How it works

1. **Segmentation**: `Intl.Segmenter('word')` splits text into words and non-words (spaces, punctuation).
2. **Punctuation merging**: `"better."` is measured as one unit, not `"better"` + `"."`. This reduces accumulation error from summing individual measurements (up to 2.6px at 28px font without merging).
3. **CJK splitting + kinsoku**: CJK word segments are re-split into individual graphemes, since CSS allows line breaks between any CJK characters. Kinsoku shori rules keep CJK punctuation (，。「」 etc.) attached to their adjacent characters so they can't be separated across line breaks.
4. **Measurement + caching**: each segment is measured via canvas `measureText()` and cached in a `Map<font, Map<segment, width>>`. Common words across texts share cache entries. The cache has no eviction — it grows monotonically per font string. For a typical single-font comment feed this is a few KB; `clearCache()` exists for manual eviction if needed.
5. **Emoji correction**: canvas `measureText` inflates emoji widths on Chrome/Firefox at font sizes <24px on macOS. Auto-detected by measuring a reference emoji; correction subtracted per emoji grapheme. Constant across all emoji types and font families. Safari is unaffected (correction = 0).
6. **Bidi classification**: characters are classified into bidi types and embedding levels are computed. Pure LTR text skips this entirely.
7. **Layout** (per resize): walk the cached widths, accumulate per line, break when exceeding `maxWidth`. Trailing whitespace hangs past the edge (CSS behavior). Non-space overflow (words, emoji, punctuation) triggers a line break. Segments wider than `maxWidth` are broken at grapheme boundaries.

## Research

See [RESEARCH.md](RESEARCH.md) for the full exploration log: every approach we tried, benchmarks, the system-ui font discovery, punctuation accumulation error analysis, emoji width tables, HarfBuzz RTL bug, server-side engine comparison, and what Sebastian already knew.

## Credits

Based on [Sebastian Markbage's text-layout](https://github.com/chenglou/text-layout) research prototype (2016). Sebastian's design — canvas `measureText` for shaping, bidi algorithm from pdf.js, streaming line breaking — informed the architecture. We added: two-phase caching (making resize O(n) arithmetic), `Intl.Segmenter` (replacing the `linebreak` npm dependency and non-standard `Intl.v8BreakIterator`), punctuation merging, CJK grapheme splitting, overflow-wrap support, and trailing whitespace handling.

## Development

```bash
bun install
bun start        # http://localhost:3000 — demo pages
bun run check    # typecheck + lint
bun test         # headless accuracy tests (HarfBuzz)
```

Pages:
- `/demo.html` — visual demo placeholder (`TODO`)
- `/accuracy.html` — sweep across fonts, sizes, widths, i18n texts
- `/benchmark.html` — performance comparison
- `/bubbles.html` — bubble shrinkwrap demo
- `/emoji-test.html` — canvas vs DOM emoji width sweep
