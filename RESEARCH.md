# Research Log

Everything we tried, measured, and learned while building this library.

## The problem: DOM measurement interleaving

When UI components independently measure text heights (e.g. virtual scrolling a comment feed), each `getBoundingClientRect()` forces synchronous layout reflow. If components write DOM then read measurements without coordination, the browser re-layouts on every read. For 500 comments, this can cost 30ms+ per frame.

The goal: measure text heights without any DOM reads, so components can measure independently without coordinating batched passes.

## Approach 1: Canvas measureText + word-width caching

Canvas `measureText()` bypasses the DOM layout engine entirely. It goes straight to the browser's font engine. No reflow, no interleaving.

Two-phase design:
- `prepare(text, font)` — segment text, measure each word via canvas, cache widths
- `layout(prepared, maxWidth, lineHeight)` — walk cached widths, count lines, compute height. Pure arithmetic.

On resize (width changes), only `layout()` runs. No canvas calls, no DOM, no strings. ~0.0002ms per text block.

### Benchmarks (500 comments, resize to new width)

| Approach | Chrome | Safari |
|---|---|---|
| Our library | 0.02ms | 0.02ms |
| DOM batch (best case) | 0.18ms | 0.14ms |
| DOM interleaved | ~same (hidden container) | ~same |
| Sebastian's text-layout (no cache) | 30ms | 31ms |
| Sebastian's + word cache added | 3.8ms | 2.7ms |

Sebastian's 30ms breakdown:
- Chrome: createRunList 8.4ms (bidi + break iterator) + breakLine 20ms (canvas measureText per run)
- Safari: createRunList 1ms + breakLine 27ms
- The measurement calls dominate. Word-width caching eliminates them on resize.

CJK scaling: prepare() cost scales linearly with segment count (~1 segment per CJK character vs ~1 per word for Latin). See `/benchmark` page for live numbers.

## Approach 2 (rejected): Full-line measureText in layout

Instead of summing cached word widths, measure the full candidate line as a single string during layout. Should be pixel-perfect since it captures inter-word kerning.

Results:
- Chrome: 27ms for 500 comments. Safari: 136ms.
- **Worse than Sebastian's original.**
- The cost is O(n²) string concatenation: `lineStr + word` copies the entire line on every word.
- Actually **less accurate** than word-by-word (196/208 vs 202/208 match against DOM).

The string concatenation dominates. Not viable.

## Approach 3 (rejected): DOM-based measurement in prepare()

Replace canvas `measureText()` with hidden `<span>` elements in `prepare()`. Create spans for all words, read widths in one batch (one reflow), cache them. Layout stays arithmetic.

Results:
- Accuracy: fixes the system-ui font mismatch (see below). 99.2% → matches DOM exactly for named fonts.
- Problem: **reintroduces DOM reads**. Each `prepare()` call triggers a reflow. If components call `prepare()` independently during a render cycle, we're back to interleaving.

This defeats the purpose. Reverted.

## Approach 4 (rejected): SVG getComputedTextLength()

SVG `<text>` has `getComputedTextLength()` for single-line width measurement. But:
- Still a DOM read (triggers layout)
- No auto-wrapping (SVG text is single-line)
- Strictly worse than canvas for our use case

## Discovery: system-ui font resolution mismatch

Canvas and DOM resolve `system-ui` to different font variants on macOS at certain sizes:

| Size | Canvas/DOM match |
|---|---|
| 10px | MISMATCH (2.9%) |
| 11px | MISMATCH (6.9%) |
| 12px | MISMATCH (11.3%) |
| 13px | OK |
| 14px | MISMATCH (14.5%) |
| 15-25px | OK |
| 26px | MISMATCH (12.4%) |
| 27-28px | OK |

macOS uses SF Pro Text (small sizes) and SF Pro Display (large sizes). Canvas and DOM switch between them at different thresholds.

**Fix: use a named font** (Helvetica Neue, Inter, Arial, etc.). With named fonts, canvas and DOM agree perfectly (0.00px diff).

## Discovery: word-by-word sum accuracy

Tested whether `measureText("word1") + measureText(" ") + measureText("word2")` equals `measureText("word1 word2")` in canvas:

**Diff: 0.0000152587890625px.** Essentially zero for two-word pairs. Canvas `measureText()` is internally consistent — no kerning/shaping across word boundaries.

The same test with HarfBuzz: also 0.00 diff (when using explicit LTR direction).

However, over full paragraphs (20+ segments), the per-pair consistency doesn't guarantee cumulative accuracy. The word-by-word sum of a full text can diverge from `measureText(fullText)` by 1-3px, enough to cause off-by-one line breaks at borderline widths. This affects ~2 tests on Chrome (Georgia) and ~11 on Safari (emoji-heavy text). Two approaches were tried and reverted:

- **Trailing space exclusion**: exclude trailing space width from overflow check. Logically sound (CSS trailing spaces hang) but too disruptive — changed break decisions across the board (99.9% → 95%).
- **Uniform scaling**: measure full text, compute ratio vs word-sum, scale all segment widths. Overcorrects some segments and undercorrects others since the divergence isn't uniformly distributed (99.9% → 99.7%).

- **Character-level + pair kerning** (inspired by [uWrap](https://github.com/leeoniya/uWrap)): measure per-character with uppercase pair kerning LUT instead of per-word. Reduces per-step rounding error but loses the per-word shaping accuracy that Chrome's canvas provides. Chrome 99.9% → 99.7%. The error goes in opposite directions by browser — Chrome's word-level sum runs slightly wide, Safari's runs slightly narrow — so no single measurement granularity wins everywhere.

- **Hybrid verify**: store segment texts, run word-sum layout, verify borderline lines (within 5px of maxWidth) with a full-string `measureText` call. Problem: our emoji correction makes the word-sum MORE accurate than raw `measureText`. The verification uses uncorrected full-string measurement, which reintroduces emoji inflation errors. Result: Chrome 99.9% → 99.8%. To work, the verifier would need to replicate the emoji correction pipeline on the reconstructed string — defeating the simplicity goal.

The divergence is small and varies by character adjacency — it's not a constant bias. The core difficulty: our corrections (emoji, kinsoku, punctuation merging) make the word-sum *more* accurate than raw canvas for those specific cases. Any verification against raw `measureText` fights the corrections. A correct verifier would need the same correction pipeline applied to full-string measurements, which adds complexity for marginal gain. There may be a better approach we haven't found yet.

## Prior art

- **[uWrap](https://github.com/leeoniya/uWrap)** (Leon Sorokin) — <2KB, character-pair kerning LUT for virtual scroll height prediction. 10x faster than canvas-hypertxt. Latin-only (no CJK/bidi/emoji). Measures character pairs instead of words, which avoids cumulative word-sum error but misses per-word shaping.
- **[canvas-hypertxt](https://github.com/glideapps/canvas-hypertxt)** (Glide) — trains a weighting model to estimate string widths without measureText after warmup. ~200K weekly npm downloads.
- **[chenglou/text-layout](https://github.com/chenglou/text-layout)** — Sebastian Markbage's original prototype. Canvas measureText + bidi from pdf.js. No caching, no Intl.Segmenter. Our direct ancestor.
- **[tex-linebreak](https://github.com/robertknight/tex-linebreak)** — Knuth-Plass optimal line breaking. Quality over speed, not for DOM height prediction.
- **[linebreak](https://github.com/foliojs/linebreak)** (foliojs) — UAX #14 Unicode Line Breaking Algorithm. Used by PDFKit, Sebastian's original.

## Discovery: punctuation accumulation error

At larger font sizes, measuring segments separately accumulates error:
- `measureText("better") + measureText(".")` can differ from `measureText("better.")` by up to 2.6px at 28px font.
- Over a full line of segments, this pushes the total 2-3px past what the browser renders.
- At borderline widths, this causes off-by-one line breaks.

**Fix: merge punctuation into preceding word** before measuring. `Intl.Segmenter` produces `["better", "."]` as separate segments. We merge non-space, non-word segments into the preceding word: `["better."]`. Measured as one unit.

This also matches CSS behavior where punctuation is visually attached to its word.

## Discovery: trailing whitespace CSS behavior

CSS `white-space: normal` lets trailing spaces "hang" past the line edge — they don't contribute to the line width for breaking purposes. Our initial algorithm counted space widths in the line total, causing premature breaks at narrow widths.

**Fix: when a space segment causes overflow, skip it** (don't break, don't add to lineW). This matches the CSS behavior: trailing spaces hang.

## Discovery: emoji canvas/DOM width discrepancy

Canvas and DOM measure emoji at different widths on macOS (Chrome):

| Size | Canvas | DOM | Diff |
|---|---|---|---|
| 10px | 13px | 11px | +2 |
| 12px | 15px | 12px | +3 |
| 14px | 18px | 14px | +4 |
| 15px | 19px | 15px | +4 |
| 16px | 20px | 16px | +4 |
| 20px | 22px | 20px | +2 |
| 24px | 24px | 24px | 0 |
| 28px+ | matches | matches | 0 |

Properties:
- Same across all font families — verified across 7 fonts (Helvetica, Arial, Georgia, Times New Roman, Verdana, Courier New, Trebuchet MS). The diff is identical for every font at every size.
- Same for all emoji types tested (59 emoji: simple, ZWJ sequences, flags, skin tones, keycaps)
- Additive per emoji grapheme: "👏👏👏" diff = 3 × single diff
- DOM scales linearly: emoji width = font size (for ≥12px)
- Canvas inflates at small sizes, converges at ≥24px
- CSS line-breaking uses the DOM (visual) width, not the inflated canvas width
- This is a Chrome/macOS issue with Apple Color Emoji rendering pipeline

Complete correction table (all integer sizes):

| Size | Canvas | DOM | Diff |
|---|---|---|---|
| 10px | 13px | 11px | +2 |
| 11px | 14px | 11.5px | +2.5 |
| 12px | 15px | 12px | +3 |
| 13px | 16px | 13px | +3 |
| 14px | 18px | 14px | +4 |
| 15px | 19px | 15px | +4 |
| 16px | 20px | 16px | +4 |
| 17px | 21px | 17px | +4 |
| 18px | 21px | 18px | +3 |
| 19px | 22px | 19px | +3 |
| 20px | 22px | 20px | +2 |
| 21px | 23px | 21px | +2 |
| 22px | 23px | 22px | +1 |
| 23px | 24px | 23px | +1 |
| 24px+ | matches | matches | 0 |

**Root cause** (per Firefox developer Jonathan Kew): DPR mismatch in bitmap font metrics. DOM renders at devicePixelRatio=2, canvas2d uses effective DPR=1. Apple Color Emoji is a bitmap font with non-linear scaling — different DPRs select different bitmap strikes with different advance widths. Neither canvas nor DOM is "wrong"; they're measuring at different resolutions. Scalable emoji fonts (e.g. Twemoji Mozilla) don't have this issue. DOM width does NOT always equal fontSize for emoji — Apple Color Emoji intentionally renders wider than fontSize at small sizes on all browsers (Safari too).

**Fix implemented**: auto-detect by comparing canvas emoji width vs actual DOM emoji width (one DOM measurement per font, cached). This captures the exact discrepancy regardless of cause. Safari renders emoji wider than fontSize but canvas and DOM agree — so correction = 0. The original approach (canvas vs fontSize) over-corrected on Safari.

Browser bugs filed:
- Chrome emoji: [issues.chromium.org/489494015](https://issues.chromium.org/issues/489494015)
- Chrome system-ui: [issues.chromium.org/489579956](https://issues.chromium.org/issues/489579956)
- Firefox emoji: [bugzilla.mozilla.org/2020894](https://bugzilla.mozilla.org/show_bug.cgi?id=2020894)
- Firefox system-ui: [bugzilla.mozilla.org/2020917](https://bugzilla.mozilla.org/show_bug.cgi?id=2020917)
- Safari: no bugs — canvas/DOM agree on everything

## Discovery: HarfBuzz guessSegmentProperties RTL bug

When running headless tests with HarfBuzz, `buf.guessSegmentProperties()` assigns RTL direction to isolated Arabic words. This changes their advance widths compared to measuring them as part of a mixed LTR/RTL string:

- `measure("مستندات")` isolated with RTL: 51.35px
- Same word in `measure("your مستندات with")`: effective width is 74.34px
- Diff: 23px per Arabic word

**Fix: `buf.setDirection('ltr')` explicitly.** This matches browser canvas behavior where `measureText()` always returns the same width regardless of surrounding context. Result: 98.4% → 100% accuracy.

Note: this is a headless testing issue only. Browser canvas is not affected.

## Server-side measurement comparison

Tested three server-side engines:

| Engine | Latin | CJK | Emoji | Notes |
|---|---|---|---|---|
| @napi-rs/canvas | OK | Wrong (fallback widths) | Wrong (0.5x or 1x font size) | Needs explicit font registration |
| opentype.js | OK | OK (with CJK font) | OK (= font size) | Pure JS, no shaping |
| harfbuzzjs | OK | OK (with CJK font) | OK (= font size) | WASM, full shaping |

opentype.js and harfbuzzjs give identical results — both read advance widths from the font file directly. HarfBuzz additionally does shaping (ligatures, contextual forms) which matters for Arabic/Devanagari.

@napi-rs/canvas uses Skia but doesn't auto-detect macOS system fonts. CJK/emoji fall back to generic monospace widths without manual `GlobalFonts.registerFont()`.

None of these match browser canvas/DOM exactly — different font engines, different platform font resolution. Server-side measurement is useful for testing the algorithm but not for matching browser rendering.

## Safari CSS line-breaking differences

Historical note: this section describes the mismatch classes we observed before the later diagnostics pass and line-breaking fixes. Those browser sweeps are now clean on fresh runs in Chrome, Safari, and Firefox.

Safari's canvas and DOM agree on individual word widths (after trimming trailing spaces). But Safari's CSS engine breaks lines at different positions than our algorithm in three cases:

**1. Emoji break opportunities**

Safari breaks before emoji where we keep them on the current line:
- Ours: `"Great work! 👏👏👏"` on one line
- Safari: `"Great work! 👏👏"` then `"👏 This is..."` on next line

Safari treats emoji as break opportunities — you can break before an emoji even mid-phrase. Our algorithm only breaks before word-like segments (emoji are non-word in `Intl.Segmenter`), so emoji get attached to the preceding content.

**2. CJK kinsoku (line-start prohibition)**

Safari prohibits CJK punctuation (，。) from starting a new line:
- Ours: `"这是一段中文文本，"` (comma at end of line)
- Safari: `"这是一段中文文本"` then `"，用于测试..."` — wait, that puts comma at line start?

Actually Safari does the opposite: it keeps the comma with the NEXT line, pushing the preceding character to the next line too. This is the kinsoku shori rule — certain characters are prohibited from appearing at the start or end of a line. The browser rearranges break points to satisfy these constraints. Our grapheme-splitting treats every CJK character as an independent break point without kinsoku rules.

**3. Bidi boundary breaks**

Safari breaks differently around Arabic-Indic digits and mixed-script boundaries:
- Ours: `"The price is $42.99 (approximately ٤٢٫٩٩"` — Arabic digits on same line
- Safari: `"The price is $42.99 (approximately"` then `"٤٢٫٩٩ ريال..."` — breaks before Arabic digits

Safari's CSS engine may treat bidi script boundaries as preferred break points. Our algorithm doesn't consider script boundaries for break decisions.

**What we tried to fix Safari**

- **Trailing space exclusion from line width**: tracked space width separately, only counted it when followed by non-space. No effect on Safari accuracy, hurt Chrome (99.4% → 99.0%). Reverted.
- **Preventing punctuation merge into space segments**: stopped emoji/parens from merging with preceding space (which made them invisible to line breaking). Made Safari worse (48 → 56 mismatches). Reverted.

**Conclusion at the time**: Safari's mismatches looked like CSS line-breaking rule differences rather than raw measurement errors. Later work closed the remaining browser sweep gaps with better punctuation/CJK modeling, browser-specific diagnostics, and a tiny engine-specific line-fit tolerance.

## Final browser sweep closure

The last few browser mismatches were not fixed by moving more work into `layout()`. That path regressed the hot path immediately and was reverted.

What held up:
- better preprocessing in `prepare()` / `prepareWithSegments()`: whitespace normalization, more selective punctuation merging, opening-quote forward merge, and CJK/Hangul punctuation handling
- browser-specific diagnostics pages plus scripted checkers for Chrome, Safari, and Firefox
- a very small browser-specific line-fit tolerance for borderline subpixel overflows (`0.005` for Chromium/Gecko, `1/64` for Safari/WebKit)

What did **not** change:
- `layout()` stayed arithmetic-only on cached widths

## Multilingual corpus stress canaries

After the main browser corpus reached clean sweeps in Chrome, Safari, and Firefox, we added long-form canaries in `corpora/` plus `/corpus` diagnostics:
- Korean: `운수 좋은 날`
- Hindi: `ईदगाह`
- Arabic: `رسالة الغفران/الجزء الأول`

This changed the job of the accuracy work:
- the official sweep stayed the regression gate
- the corpus pages became research canaries for longer prose and rarer break patterns

The first useful results:
- Korean was already close and later reached exact coarse sweeps with a narrow Chromium-only quote-following Hangul rule.
- Hindi became exact once Devanagari danda punctuation (`।`, `॥`) was treated like other left-sticky punctuation.
- Arabic improved a lot once Arabic punctuation (`،`, `؛`, `؟`) was added to the same left-sticky set, but remained the main structural gap.

## Arabic corpus cleanup and diagnostics

The Arabic corpus initially included obvious Wikisource scaffolding (`===`, stray `</ref>`, `|}`), which polluted both the corpus and the diagnostics.

Cleaning that text immediately removed several suspicious misses:
- widths `330`, `340`, `350` became exact

The diagnostics page also needed an RTL-specific fix:
- span-by-span line probing perturbed Arabic shaping and produced misleading line reconstructions
- for RTL content, a `Range`-based extraction path was much more trustworthy

That distinction mattered. After the fix, some Arabic mismatches that previously looked like width-drift bugs turned out to be real browser break-choice differences.

## Rejected: Arabic pair/boundary corrections

First attempt at a richer Arabic model:
- for adjacent Arabic-ish segment boundaries, precompute a correction
- apply that correction during `layout()` when the exact adjacent pair stays on the same line

Why it seemed plausible:
- Arabic shaping is contextual
- isolated-word sums can diverge from shaped phrase widths
- a local boundary delta is the smallest possible upgrade to the current model

Result:
- no meaningful improvement on the Arabic canary widths
- big cost increase in both `prepare()` and `layout()`

Representative outcome:
- Arabic sentinel widths such as `310`, `360`, `470`, `890` stayed essentially unchanged
- top-level `prepare()` rose from the mid-20ms range to the low-40ms range
- Arabic long-form `prepare()` rose to roughly `200ms`
- `layout()` also slowed measurably

Conclusion:
- local pair corrections were too weak to explain the remaining Arabic drift
- the remaining problem is not just "sum isolated words plus small edge deltas"

## Rejected: Arabic run slice widths

Second attempt at a larger shaping-aware model:
- detect contiguous Arabic runs during `prepare()`
- store run-local offsets
- when a line stays inside one Arabic run, let `layout()` query cached exact run-slice widths instead of summing segments

This was intentionally much larger than pair corrections, but still kept `layout()` arithmetic-only from the caller’s perspective.

Result:
- the hard Arabic widths still did not move meaningfully
- `layout()` regressed badly, especially on Arabic corpora

Representative outcome:
- sentinel widths still looked like:
  - `310 -> -170px`
  - `360 -> -102px`
  - `470 -> -68px`
  - `890 -> +34px`
- benchmark impact while the experiment was active:
  - top-level `layout()` roughly `0.03ms -> 0.13ms`
  - Arabic corpus `layout()` roughly `0.07ms -> 0.95ms`

Conclusion:
- "larger shaping context" by itself is not the missing lever
- the remaining Arabic misses are not mostly fixed by asking for wider exact substring widths
- the experiment was reverted

## Current Arabic conclusion

The remaining Arabic misses are mixed:
- some lines still show real shaping/context sensitivity
- several of the worst misses are clearly different browser break choices around phrase boundaries such as `فيقول:` or `همزةٌ،`

Representative diagnostic:
- at width `310`, the first bad break is around ` فيقول:`
- our candidate line width is internally consistent (`sum ~= full ~= DOM`)
- the browser still breaks differently

So the next Arabic step is probably **not** another local width-cache heuristic.

The more likely paths now are:
- better Arabic break-policy modeling around punctuation/space/phrase boundaries
- or, if that fails, a more structural engine change closer to browser shaping-safe break behavior

What we know now:
- `Intl.Segmenter` is not obviously the main issue
- punctuation attachment was worth fixing
- corpus hygiene and RTL diagnostics were worth fixing
- local and medium-sized shaping-width enrichments were not enough

## Arabic probe phase

To isolate the remaining Arabic break classes without dragging the full corpus along, we added a single-snippet probe page/checker (`/probe`, `scripts/probe-check.ts`).

Two practical lessons from that phase:

1. **Use normalized offsets, not raw file offsets**
   - corpus diagnostics report offsets in the normalized text (`prepareWithSegments(text, font).segments.join('')`)
   - probing raw Wikisource offsets gives the wrong substring and can falsely suggest that a mismatch is non-reproducible

2. **Use the exact corpus font**
   - rough probes with `18px serif` were misleading
   - the Arabic corpus uses `20px "Geeza Pro", "Noto Naskh Arabic", "Arial", serif` with `34px` line height
   - once the probe used the real font plus normalized slices, the recurring Arabic classes reproduced cleanly

What the probe established:
- the remaining Arabic classes are genuinely local browser break choices
- they can reproduce in short snippets even when total snippet height still matches (because the shorter probe can re-sync later)
- removing the **trailing punctuation on the moved phrase** can eliminate the mismatch:
  - `لجاز،` vs `لجاز`
  - `فيقول:` vs `فيقول`
- removing punctuation on the earlier phrase did **not** eliminate the mismatch

That strongly suggests the browser is sensitive to short RTL phrase boundaries where the phrase itself ends with punctuation and is immediately followed by more text without an intervening space.

We also tried turning that observation into a layout heuristic and reverted it immediately:
- it fixed the isolated probe snippets
- but it badly over-broke the full Arabic corpus (`browser fits the longer line while our break logic cuts earlier`)

Conclusion:
- the probe tooling is a keeper
- the punctuation finding is real
- but it is not yet a safe direct heuristic for the main engine

## Arabic no-space punctuation clusters

The probe work led to one rule that *did* survive the real corpus:

- if an Arabic segment ends with punctuation and is immediately followed by more Arabic text **with no intervening space**, merge the two during `prepare()`

Representative examples:
- `فيقول:وعليك`
- `لجاز،لأنّها`
- `همزةٌ،ما`
- `الظُنون،ويلتفت`

Why this is different from the rejected heuristic:
- the rejected heuristic said "prefer a break before short punctuated Arabic phrases"
- the surviving rule says "these no-space punctuation sequences are one cluster, so only break before the whole cluster if needed"

That model matches the probes much better. In those cases, the browser is not simply preferring an earlier break for style; it is acting as though the punctuated phrase and the following Arabic word belong to the same unbreakable run.

Results after landing that merge:
- official browser accuracy corpus stayed clean in Chrome, Safari, and Firefox
- Korean coarse corpus stayed exact
- Hindi coarse corpus stayed exact
- Arabic coarse corpus improved from `43/61` exact to `59/61` exact

Remaining Arabic coarse misses after the merge:
- `360 -> -34px`
- `890 -> +34px`

So this looks like a real keep:
- prepare-time semantic improvement
- no hot-path regression
- large Arabic canary win

One important refinement fell out immediately:
- do **not** merge every punctuation-ended Arabic cluster with following no-space text
- repeated exclamation marks (`أمون!!ولقد`) were a counterexample

The safe keep so far is narrower:
- keep colon / period / Arabic comma / Arabic semicolon in the no-space Arabic merge set
- keep exclamation/question-style punctuation out until there is evidence they behave the same way

## Arabic leading combining-mark fix

Another small Arabic-specific preprocessing bug showed up after the no-space punctuation merge.

`Intl.Segmenter` can emit a segment like:
- `" ِّ"` (space + combining marks)

in text such as:
- `كل ِّواحدةٍ`

That allowed the engine to strand the space-plus-marks on the previous line while the browser effectively kept the marks with the following Arabic word.

The keepable fix was:
- turn `["كل", " ِّ", "واحدةٍ"]` into `["كل", " ", "ِّواحدةٍ"]`

This removed the old `كل ِّواحدة` class without affecting the official browser corpus.

## Current Arabic frontier

After the landed Arabic fixes, the remaining coarse Arabic canary is:
- `59/61 exact`
- remaining widths: `360` and `890`

The remaining classes now look like:
- `360`: local width/context drift (not the old segmentation bug anymore)
- `890`: tiny near-edge tolerance (`~0.004px` overflow)

So Arabic is now in a much narrower place:
- the obvious preprocessable break classes are mostly handled
- what remains looks more like a small amount of shaping/context drift plus one edge-tolerance case
- no hot-path `measureText()` verification was reintroduced
- the browser-facing public API stayed `prepare()` / `layout()`

## Arabic diagnostics correction and corpus punctuation cleanup

The next Arabic pass turned up two different problems, and only one of them belonged in the engine.

First, the corpus and probe diagnostics were still reconstructing our logical line offsets from
`layoutWithLines().line.text.length`. That drifted once an earlier line no longer mapped cleanly
back to the normalized text. The symptom was misleading reports like:
- `... وجئت وهو نائ|مٌ ...`

even though the actual rendered line from `layoutWithLines()` still contained the whole word.

The fix was to stop reconstructing offsets and instead walk the prepared segments and grapheme
fallbacks directly inside the diagnostics pages, using the same line-fit epsilon as `layout()`.

Second, the last Arabic coarse miss at `360px` turned out to be a corpus artifact, not a new engine
rule. The text had quote-before-punctuation spacing like:
- `" ،`
- `" .`
- `" ؟`

This came from the cleaned Wikisource text, not from CSS/browser behavior we wanted to model.
Normalizing those quote-adjacent punctuation spaces in the Arabic corpus removed the final coarse
mismatches cleanly, without adding another Arabic-specific layout heuristic.

After those two changes:
- Arabic coarse corpus sweep: `61/61 exact`
- Korean coarse corpus sweep: `61/61 exact`
- Hindi coarse corpus sweep: `61/61 exact`

The remaining lesson is:
- keep using the real browser probe/corpus pages for multilingual work
- distrust reconstructed offsets when a mismatch suddenly looks stranger than the height diff
- prefer corpus cleanup over engine rules when the remaining miss is clearly source-text noise

## Arabic source cleanup, round two

A second pass over the Arabic corpus focused only on obvious source-text artifacts, not engine logic:
- removed remaining spaces before punctuation such as `هيهات !`, `دجاك ؟!`, `القيان :`
- normalized one repeated quote-introducer pattern:
  - `قوله:"..."`
  - to `قوله: “..."`

That one quote-introducer occurrence was disproportionately important. It accounted for the repeated
fine-sweep misses at widths like `463`, `464`, and `498`.

Effect on the Chrome Arabic fine sweep (`300..900`, step `1`):
- before: `574/601 exact`
- after: `581/601 exact`

What remained after the source cleanup:
- one negative width (`527`) that still looks like a real local break-choice mismatch
- a larger set of positive one-line widths that continue to look like tiny browser edge-tolerance cases

So the current evidence is:
- source cleanup still matters for this corpus
- but the remaining Arabic fine field is no longer mostly source noise
- the main unresolved class is now small line-edge tolerance, not broad preprocessing mistakes

## Arabic punctuation-plus-mark clusters

The last remaining negative Arabic fine-width case (`527`) turned out to be one more preprocessing issue,
not a shaping-model failure.

`Intl.Segmenter` emitted:
- `["وحوارى", " ", "بكشء", "،ٍ"]`

That allowed the engine to keep `بكشء` on the previous line while stranding the Arabic comma-plus-mark
cluster on the next line. Chrome behaved as though `بكشء،ٍ` were one left-sticky unit and broke earlier.

The fix was small:
- allow left-sticky punctuation segments to include trailing combining marks
- so clusters like `،ٍ` still merge into the preceding Arabic word during `prepare()`

Effect on the Chrome Arabic fine sweep (`300..900`, step `1`):
- before: `581/601 exact`
- after: `582/601 exact`
- the last negative width (`527`) disappeared
- remaining Arabic fine misses are now all positive one-line edge-tolerance cases

## Arabic edge-tolerance reduction

Once the remaining Arabic fine field was reduced to positive one-line misses only, the surviving cases all
looked like the same Chromium behavior: the browser keeps one more short phrase with only about
`0.003–0.005px` overflow.

We revisited the non-Safari line-fit tolerance and raised it from `0.002` to `0.005`.

What stayed stable:
- browser accuracy corpus: `7680/7680`
- Gatsby coarse sweep (`300..900`, step `10`): unchanged at `47/61 exact`
- multilingual coarse corpus sweeps: Korean/Hindi/Arabic all stayed `61/61 exact`
- hot-path `layout()`: still `0.03ms`

Effect on the Arabic fine field:
- before: `582/601 exact`
- sampled remaining widths dropped from `19` to `7`
- examples that became exact: `312`, `316`, `366`, `371`, `407`, `432`, `441`, `447`, `479`, `593`, `817`, `868`

So this tolerance change looks like a justified browser-compat shim, not just a speculative hack.

The current verification loop:
- `bun run accuracy-check`
- `bun run accuracy-check:safari`
- `bun run accuracy-check:firefox`
- `bun run gatsby-check 300 400 600 800`

These are the checks that now matter more than the older mismatch tables below.

## Accuracy summary

Browser (canvas measureText, named fonts), 4 fonts × 8 sizes × 8 widths × 30 texts = 7680 tests:
- Chrome: 7680/7680 (100%)
- Safari: 7680/7680 (100%)
- Firefox: 7680/7680 (100%)

## Break-kind model strengthening

The old internal `isSpace: boolean` model had become too blunt for the remaining text-engine work.
It compressed several different behaviors into one bit:
- collapsible spaces that should hang and collapse
- hard glue like `NBSP` / `NNBSP` / `WJ`
- zero-width opportunities like `ZWSP`

That was making the implementation harder to reason about and was already hiding real edge cases.

We replaced it with explicit internal segment break kinds:
- `text`
- `space`
- `glue`
- `zero-width-break`

What that bought us immediately:
- `NBSP` survives `prepare()` as real visible glue content instead of getting treated like ordinary hanging space
- `ZWSP` survives as an explicit zero-width break opportunity
- Arabic combining-mark-only clusters now forward-merge like other leading glue
- astral CJK ideographs now correctly enter the CJK path instead of being skipped by BMP-only checks

This was a model-strengthening change, not a benchmark tweak. The important verification:
- `bun test` gained direct invariants for `NBSP`, `ZWSP`, Arabic leading marks, and astral CJK
- Safari accuracy stayed `7680/7680`
- Firefox accuracy stayed `7680/7680`
- coarse corpus sweeps stayed unchanged:
  - Korean `61/61`
  - Hindi `61/61`
  - Arabic `61/61`
  - Hebrew `61/61`
  - Thai `59/61`

So the richer break model appears to be a clean keep: better semantics, same solved accuracy field.

## Thai corpus note

Adding a Thai prose corpus (`นิทานเวตาล/เรื่องที่ 1`) exposed a different class than the Arabic/Hebrew work:
not dictionary segmentation failure, but ASCII quote behavior in prose like `ทูลว่า "พระองค์...`.

Treating ASCII `"` as contextual quote glue during preprocessing was enough to collapse the Thai coarse
field from `43/61 exact` to `59/61 exact`, without moving the browser accuracy corpus in Safari or Firefox.
The two remaining coarse Thai misses are both the familiar tiny positive edge-fit class (`+32px`).

Headless (HarfBuzz, Arial Unicode):
- 1920/1920 (100%) word-sum vs full-line measurement
- Algorithm is exact under the headless HarfBuzz backend; the browser sweeps are now also clean on fresh runs.

## What Sebastian already knew

From his RESEARCH file:
> "Space and tabs are used to define word boundaries. CJK characters are treated as individual words."
> "Spaces are shaped independently from the words."

He designed for per-word caching but never implemented it. His code re-measures every run on every `breakLine()` call. Adding a word-width cache to his library drops it from 30ms to 3ms — a 10x improvement from caching alone, without changing the algorithm.

We went further: the two-phase split (prepare once, layout as arithmetic) drops it to 0.02ms — a 1500x improvement over his original.
