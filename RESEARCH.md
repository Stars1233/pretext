# Research Log

Durable findings and rejected approaches from building this library.

For the current browser accuracy and benchmark results, see `status/dashboard.json`. For the current corpus results, see `corpora/dashboard.json`. `corpora/TAXONOMY.md` defines the mismatch categories. Current browser and OS bugs and workarounds live in `PLATFORM_BUGS.md`.

## DOM Measurement Interleaving

When UI components independently measure text heights with DOM reads like `getBoundingClientRect()`, each read can force synchronous layout. If those reads interleave with writes, the browser can end up relaying out the whole document repeatedly.

Pretext avoids that repeated layout work by following three rules:

- do the expensive text work once in `prepare()`
- keep `layout()` arithmetic-only
- let components recalculate their text layout without coordinating DOM measurements

## Current Measurement Design

Canvas `measureText()` avoids DOM layout. It goes straight to the browser's font engine.

The library uses two phases:

- `prepare(text, font)` — segment text, measure segments, cache widths
- `layout(prepared, maxWidth, lineHeight)` — walk cached widths with pure arithmetic

Across broad browser sweeps, this design remained accurate while `layout()` stayed fast enough for resize-driven work.

## Boundary Policy And Measurement Units

Word-segmenter `isWordLike` is a useful measurement hint, but it does not define
emergency wrapping permission. Independent punctuation and symbol graphemes can
break in an overlong run too. That extension excludes emoji, whose ordinary
boundaries differ from word-internal symbols, as well as control-bearing fragments,
standalone combining marks and emoji modifiers; those need their own shaping and
source-progress model. A grapheme's attached marks stay with its base.

Opening punctuation and Gecko's directional numeric-affix rules must retain the
original neighboring source characters before punctuation, URL and numeric-run
compaction. A later pass cannot recover a boundary after merging has erased it.
The Gecko rule owns classified ASCII opener and numeric-affix seams. Wider
Unicode boundary behavior retains the existing compatibility policy.

CJK kinsoku units and preferred hyphen boundaries belong to analysis. Measurement
still observes each coarse analyzed run before its CJK units and receives
ordinary boundaries separately from emergency permission. An ASCII hyphen after CJK attaches left;
a numeric sign also stays with its suffix. An overlong such unit can still make
grapheme progress. Latin hyphens retain their existing preferred breaks. The
existing CJK-leading mixed-run rule also precedes generic ASCII opener attachment,
even when its final scalar is ASCII: Firefox can keep Hangul plus Latin in one
word segment where other runtimes separate them.

A single URL can contain many preferred hyphen breaks and produce many narrow
lines. Restarting the preferred-break search at zero for every continuation made
streaming and aggregate rich layout quadratic in that run's length. The simple batch walk
carries the next boundary; arbitrary continuation cursors seek within
the sorted break list without rescanning earlier cuts or adding cursor state.
The shared complex batch walker currently uses those bounded searches per line,
so its preferred-cut lookup work is O(lines × log(cuts)), not the simple walker’s
carried-index bound.

Desktop Firefox resolves CSS box widths to 1/60px.
A headed DPR 2 sweep of 241 box widths from 35px through 36px matched
`Math.round(width * 60) / 60` within 0.00002px, including 35.59375px resolving to
35.6px. Applying that quantization to line fitting nevertheless regressed
independent signed-spacing and ligature thresholds in the full sweep. Box
resolution does not establish the inline fit threshold, so the line walkers
retain their existing width handling. Wider Unicode-affix tailoring likewise
exposed inherited trailing-space admission failures; it remains unmodeled here.

## One Decision For Complex Line Layout

The complex batch and streaming walkers used different priorities after SHY.
When a later hanging boundary fit, streaming could rewind to an earlier SHY
while batch layout consumed the later boundary. The source and geometry were
already available; duplicating the decision algorithm caused the disagreement.
Complex batch and streaming layout now use one scan loop with the batch
priority; streaming stops after one line. Scratch values and helpers belong to
the whole walk, while ordinary text retains its simple fast path. In the full native
comparison, this preserves every batch line and browser-accuracy result and
removes the API disagreements in all three browsers. Exact source partition
diagnostics remain separate from allowed suppressed-control boundary gaps.

Line-start normalization must cross every consecutive consumed-only chunk before
returning a start. Skipping just one could make a SHY-only chunk terminate the
paragraph and drop later visible text. Actual empty hard-break chunks still
produce empty lines; consumed controls are not substitutes for those chunks.

## Original Observations And Resumed Runs

Source cuts, whole-item admission and storage partitions are different facts.
An original item can span stored SHY/mark pieces; splitting its storage must not
silently replace the intact observation used to decide whether it fits. A selected
prefix can also leave a real remaining width that is not determined by the source
cursor alone. A copied continuation must retain any such history that its model
needs, rather than reconstructing it from a newly measured suffix.

That does not make arbitrary prefix arithmetic valid. A fresh Safari probe of
134 restart relationships rejected 61 attempts to splice an original-prefix
difference onto a freshly measured leading fragment. For Amiri at 16px and zero
spacing, the inferred width of WJ + acute + b was 12.384px while the direct
observation was 12.768px. Retaining a whole-item remainder and constructing a new
partial measurement are different operations. The observation's exact source
span and shaping context must remain attached to it.

A Unicode count of spacing owners is insufficient too: WJ can advance source
without owning an extra spacing slot, while WJ with a combining mark changes its
advance with the original glyph context. Requested-spacing Canvas observations
resolve some of those cases but disagree with native optional-ligature behavior
in opposing inputs. Neither a blanket owner count nor a blanket Canvas-spacing
replacement is accepted. Measuring every possible resumed substring is outside
the intended bounded preparation model. The broader source-boundary prototype
therefore remains experimental; these findings do not establish a flat #210 fix.

## Rich Inline Source Identity And Boundary Spaces

A rich item has source identity independently of its measured width. Filtering
zero-width items through the flat walker's first line lost standalone ZWSP,
while a compressed item array exposed cursor indices in a different coordinate
space from fragment indices. Prepared items now occupy their original source
indices in one array. The prepared segment count supplies each item's source end;
an infinite-width walk supplies only its natural width. Inactive SHY-only items
retain their source without creating a line on their own.

SPACE presence and advance are separate facts. Its font and letter spacing come
from the first whitespace in the collapsed boundary. `measureText('A A') -
measureText('AA')` also includes the font's A–A kerning difference; measuring SPACE
directly avoids that contamination. A zero or negative advance still creates an
ordinary break opportunity. After forced overflow, the remaining width retains
its negative deficit instead of giving a following signed gap fictitious room.

The batch visitor owns its continuation before handing a line to user code.
Public mutation of that line cannot alter the next line's source position.
These changes leave the flat engine unchanged. Same-font native inline witnesses
and public contract checks do not establish arbitrary cross-item shaping, rich
Markdown layout, or a general solution to flat ZWSP/SHY wrapping.

## Measurement Approaches We Rejected

Several alternatives were tried and rejected:

- measuring full candidate lines as strings during `layout()`
- moving measurement into hidden DOM elements during `prepare()`
- using SVG `getComputedTextLength()`

Each approach either reintroduced DOM reads, ran more slowly than the current two-phase design, or made the benchmark path slower despite simplifying one part of the code.

`layout()` therefore remains arithmetic-only and uses cached widths.

## `system-ui` Font Resolution

Canvas and DOM resolved `system-ui` to different font variants on macOS at certain sizes in the [recorded scan](research-data/system-ui-size-scan.json). Mismatches clustered at `10-12px`, `14px`, and `26px`; `13px`, `15-25px`, and `27-28px` were exact.

Lookup tables, naive scaling, and guessed font substitutions were not reliable. If `system-ui` support becomes important enough, the plausible option is a narrow DOM fallback during `prepare()` for the affected browser and font-size combinations. Current findings and workarounds live in [PLATFORM_BUGS.md](PLATFORM_BUGS.md).

## Summing Segment Widths

Summing measured segments is very accurate, but not exact. Small differences between adjacent glyphs can accumulate enough to change a line break.

Two preprocessing changes improved the browser results:

- merge punctuation into the preceding word before measuring
- let trailing collapsible spaces hang instead of forcing a break

We rejected:

- full-string verification in `layout()`
- uniform rescaling
- generic pair-level correction models

Local preprocessing improved the results more than runtime correction models.

## `text-shaper`

`text-shaper` is useful reference material for Unicode coverage and bidi, but its segmentation and line breaking do not match Pretext's `Intl.Segmenter`, preprocessing, and canvas measurements.

It helped identify missing Unicode ranges, including CJK extension blocks.

We did not adopt:

- its segmentation as a runtime replacement for `Intl.Segmenter`
- its paragraph breaker as a replacement for browser-matched layout

## `pre-wrap`

The current `{ whiteSpace: 'pre-wrap' }` mode deliberately supports:

- ordinary spaces
- `\n` hard breaks
- tabs with default browser-style tab stops
- the other default wrapping behavior unchanged

The mode also follows these browser behaviors:

- preserved spaces still hang at line end
- consecutive hard breaks keep empty lines
- a trailing final hard break does **not** invent an extra empty line
- tabs advance to the next default browser tab stop from the current line start

The mode covers the textarea-like cases we need. Keep its permanent browser check small. A broader brute-force check can justify that coverage once, but does not need to remain in the repository afterward.

## Emoji Widths

Bitmap emoji do not scale linearly with `font-size`, so comparing canvas emoji width with the font size was inaccurate. Pretext instead compares canvas and DOM emoji widths for the same font, then caches the correction outside `layout()`. Current browser findings live in [PLATFORM_BUGS.md](PLATFORM_BUGS.md).

## HarfBuzz

We briefly kept a headless HarfBuzz backend in the repo for server-side measurement probes.

It was useful for research and algorithm experiments, but its measurements did not match the browser canvas and DOM measurements closely enough to keep in the main repository. Isolated Arabic words also needed explicit LTR direction in that backend to avoid misleading widths.

If HarfBuzz is reconsidered, use it as a research reference, not as Pretext's runtime or as a replacement for browser canvas and DOM comparisons.

## Arabic

Changes and practices worth keeping for Arabic:

- merge Arabic punctuation clusters without spaces during `prepare()`, e.g. `فيقول:وعليك` and `همزةٌ،ما`
- keep Arabic punctuation-plus-mark clusters such as `،ٍ` attached to the preceding Arabic text
- split `" " + combining marks` into plain space plus marks attached to the following word
- use normalized text slices and the exact corpus font during diagnosis
- use the RTL diagnostics instead of reconstructing offsets from rendered line text
- remove clear artifacts in the source text instead of adding engine rules for them
- allow a very small non-Safari line-fit tolerance justified by the measured width differences

We rejected:

- pair correction models at segment boundaries
- larger Arabic run-slice width models
- broad phrase-level rules derived from one successful example

Pair corrections were too local to change the actual mismatches. Run-slice widths required much more work and still did not fix the remaining mismatched lines. Both approaches made `prepare()` or `layout()` slower without improving the Arabic corpus enough.

Be skeptical early when an Arabic change starts by adding more shaping-aware width caches inside the current segment-sum design. The useful Arabic changes so far have been preprocessing, source cleanup, better diagnostics, and small tolerance adjustments.

## Long-Form Corpora

The short accuracy sweep became a regression check; long-form corpora exposed patterns that repeat across real application text. Current counts belong in [corpora/dashboard.json](corpora/dashboard.json), not here.

### Mixed Application Text

Book corpora do not cover application patterns such as URLs, escaped quotes, numeric expressions like `२४×७`, time ranges like `7:00-9:00`, emoji ZWJ sequences, non-breaking spaces, word joiners, and manual soft hyphens. The mixed-app corpus collects those cases in one place.

URL queries needed a deliberately narrow representation: one breakable unit from the URL start through `?`, followed by a second unit for the query string. Treating the entire URL as one unit or splitting every query character both produced worse application behavior.

When a soft hyphen is selected, the line must stop at the soft-hyphen boundary and materialize a trailing `-`. Packing later graphemes onto the same line disagreed with the browser and made the rich APIs reconstruct a different break.

### Thai And Khmer

Thai exposed a contextual ASCII quote rule rather than a general segmentation problem. Khmer confirmed that explicit zero-width separators in clean source text were useful input and should survive normalization.

A Lao legal-text sample was rejected because the source contained fixed print wrapping. Using that sample under `white-space: normal` would have measured source formatting rather than language behavior.

### Myanmar

Myanmar punctuation `၊`, `။`, `၍`, `၌`, and `၏` needed to stay with preceding text. The possessive marker `၏` also needed to stay with the following word in text such as `ကျွန်ုပ်၏လက်မ`.

Broader grapheme breaking and closing-quote-plus-follower rules improved one browser while hurting another. Those results showed shaping and context sensitivity, but did not justify another global preprocessing rule.

### Japanese And Chinese

Japanese iteration marks such as `ゝ`, `ゞ`, `ヽ`, and `ヾ` must not begin a line, so preprocessing keeps them with the preceding kana.

The remaining Japanese and Chinese differences varied with browser, width, and font. That variation showed the limit of a width-independent grapheme-sum model in proportional CJK fonts. A one-line difference in one corpus is not enough reason to add another punctuation rule.

### Font Matrices

The first sampled font matrix showed that some differences move when the font changes while other scripts remain stable. Font matrices are therefore most useful after a specific corpus exposes a problem. Running every corpus under every installed font adds cost without identifying the responsible text pattern.

## Algorithmic work and source ownership

The September 2026 history audit found four earlier families of quadratic work:
reclassifying growing punctuation/Arabic strings and rescanning cleared slots
(fixed by `30854d7`, `2148b90`, `4cb8b24`, `f0a326d`); CJK/keep-all growing-unit
merging (`eb3bbbe`, `f0a326d`); measuring every growing Canvas prefix (bounded by
`fcf9c62`); and searching hard-break chunks from the beginning for every streamed
line (`2c52171`). The later source-range cleanup `7201ee8` retained these fixes
with fewer intermediate structures. Experimental duplicates in history are not
separate shipped incidents.

Three remaining retry scans were found and repaired without changing layout
semantics:

- Rich boundary trimming used an unanchored trailing-whitespace regex that tried
  every suffix of a long internal SPACE run followed by content. Two inward
  source-offset scans now derive leading/trailing presence and slice once; the
  exact CSS whitespace set and the first collapsed SPACE's style are preserved.
- Streaming a long hyphenated URL restarted its preferred-break search at zero
  for every continuation. The sorted boundary array now supports a lower-bound
  search for arbitrary starts; an already positioned batch cursor returns
  immediately. There is no additional cursor state or cache.
- Pixel font-size extraction retried within every digit run when no `px` suffix
  followed. Starting only at a digit-run boundary preserves the existing first
  match and fallback while preventing repeated suffix scans.

The whitespace and preferred-break paths dated to `9364741` and `9cf49de`,
respectively, before the wrapping-boundary/source-identity work. Counted probes
verify at most input length plus two whitespace boundary checks; a 4,096-hyphen
URL's streaming search drops from 2,096,128 skipped boundaries to 12,288 binary
comparisons. Semantic probes preserve complete ranges, text, widths and copied
cursors, including signed spacing. Timing probes using a numeric Canvas double
are algorithm diagnosis, not native browser throughput claims.

The Safari prefix-fit policy still caps each segment at 96 graphemes and uses
pair context beyond that. Count total submitted text as well as Canvas calls:
a large combining cluster can appear in up to 96 prefixes, a large but bounded
linear amplification. The cap does not bound the native font shaper's own cost.
Current merging, bidi passes, chunk walking and materialization probes found no
other unbounded repeated scan; output materialization still costs the source it
visits. Shared font/segment caches can accumulate across unique prepared inputs
until `clearCache()`, which is a separate lifetime concern.
