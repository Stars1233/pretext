# Wrapping suite validation

This branch implements the boundary-policy fixes for #206/#208, #212/#213 and
#214/#215, plus the separate rich-inline source-identity and signed-space fix.
The exact flat #210/#211 reproduction remains a known failure. Its twelve native
rich-inline height witnesses are required, as are two exact-fit admission
opposites discovered during review.
[README.md](README.md) explains the runner; [INVENTORY.md](INVENTORY.md) records
coverage, provenance and research protocols outside its scope.

## Published-main landing validation

The isolated landing starts at published main `76b4b4e`; unrelated unpublished
local demo/Freerange commits are excluded. Runtime commit `ac6289f` matches every
frozen source hash in the landing run. It was compared with both published main
and previously validated `9b02df1` on the full shared inventory in all three
installed browsers, both directions, at DPR 2: 656,402 inputs. Every prediction
and assessment matches the validated branch. There are zero lost passing metrics
against either reference, zero required/execution failures and zero new API/rich
failures, including research observations. All fourteen native rich-item height
witnesses pass in each browser; nine numeric environment profiles preserve
contracts and TAB behavior. Flat #210/#211 remains observed and unresolved.

The ordinary baseline now points at `ac6289f`, so later changes must preserve the
newly gained successes too. The pin is a reachable source commit, not disabled
tests or a frozen list of browser answers. Accuracy, spacing and corpus snapshots
were regenerated from these same full observations. Unit/static/package/site
checks pass (168 tests, 991 assertions on this published-main base; three local
demo tests remain with their unpublished changes). Earlier paired foreground
benchmarks are recorded below; the landing did not add another engine change.

Suite hash: `a3567aaad94c409992fbd828f041c780a16162dba4779837d88a6ec6cd3b9e4d`.
Raw rows, source fingerprints and the independent equality/loss audit are in
`/private/tmp/pretext-merge-audit-20260905/landing-full` and `landing-audit.json`.

## Rich-inline implementation and review

Relative to boundary branch `9f00a4f`, only `src/rich-inline.ts` changes in
production. One source-indexed array replaces the compressed array and reverse
lookup; source extent and line presence no longer depend on positive width.
Collapsed SPACE is measured directly, keeps its first style and signed advance,
and retains its ordinary break opportunity. The visitor keeps its continuation
before calling user code. All flat engine files remain byte-identical to the
validated boundary base.

Independent review caught a whole zero-width item rejected at exact fit. Moving
whole-item fit ahead of reservation fixed it but lost nine opposing Safari
matches: a negative next item could undo forced overflow. A broader prior-overflow
guard also lost 62 matches when item/style boundaries differed. The final redo
keeps reservation first and changes its comparison from `>=` to `>`.

A 1,926-input Safari comparison covers the earlier 720 source opposites, 450
signed-space controls, 540 exact-fit cases and 216 mixed-style cases. The selected
redo gains 78 native height matches and loses none against v4, with zero API/rich
failures. It retains twelve inherited mixed-style missed fits; the trailing-SPACE
and separate-SPACE native paragraphs genuinely differ. Those observations remain
research evidence, not a claim of general styled-inline correctness. See
`/private/tmp/pretext-focused-results-20260905/rich-admission-v6-v7-probe/`.

Permanent unit tests retain the exact-fit and forced-overflow opposites. Two
same-font native witnesses were also promoted into ordinary/full. An independent
generator comparison verifies zero removed or changed old inputs, assertions or
provenance in either schedule, in every browser. The styled-item pair remains in
the research artifact because the canonical native inline protocol is same-font.

The final production source passed the full corpus at DPR 2 in Chrome, Safari
and Firefox, across both directions: 656,396 inputs, zero lost passing metrics
against main or boundary, zero required/execution failures, and zero new API/rich
failures. Every flat prediction and assessment is identical to boundary; all
global rich contracts pass. The twelve native rich witnesses pass in each browser.

| Browser | Full LTR / RTL | Gained API/rich-height metrics over boundary | Lost |
| --- | ---: | ---: | ---: |
| Chrome | 147,711 / 71,008 | 3,650 | 0 |
| Safari | 148,014 / 70,974 | 2,675 | 0 |
| Firefox | 147,677 / 71,012 | 2,798 | 0 |

These are independent metric gains, not counts of fully browser-correct cases.
The full run uses suite hash
`d8b6f632d374c1ff3fa35f94f4ece70e44f361f790ad504a0002ed6546e4f3bc`.
The subsequent two-case native promotion passed fresh in all three browsers with
the same production source, under suite hash
`02907abf1689588c5a6a5e88685d0faa137eeefbb00bf0652912cf340631d59d`.
Nine numeric profiles have no new failures or changed TAB behavior. Exact sources,
raw observations and audits are under
`/private/tmp/pretext-focused-results-20260905/rich-source-v6-full-{chrome,safari,firefox}`,
`RICH-SOURCE-V6-FULL-AUDIT.json` and `RICH-SOURCE-V6-ADMISSION-AUDIT.json`.
Accuracy, spacing and all three corpus snapshots were regenerated from those
same full-run observations, using the existing snapshot writer.

Relative to boundary, runtime source shrinks by 25 lines / 573 bytes. The main
entry bundle remains 50,596 minified bytes / 16,900 gzip; rich-inline shrinks
54,778 → 54,527 minified bytes and 18,001 → 17,924 gzip. Methods are unchanged
from the boundary measurement below; exact counts are in `rich-source-v6-size`.

Foreground paired timing uses independent baseline/current modules, two warmup
blocks and eight alternating ABBA/BAAB blocks. Both browsers stayed visible and
focused at DPR 2. Caches clear once per 200-list preparation batch; hot range and
statistics samples repeat 80/200 times. Materialization warms every width outside
timing, then repeats twenty times. The mixed-font workload includes empty items,
ZWSP and atomic pills, at zero letter spacing.

| Incremental rich operation | Chrome current/boundary | Safari current/boundary |
| --- | ---: | ---: |
| Preparation | 0.859× | 0.924× |
| Statistics | 0.940× | 1.038× |
| Range walking | 1.036× | 1.063× |
| Materialization | 1.005× | 1.000× |

These are median within-block ratios. Line totals are identical; retaining ZWSP
adds twenty fragments per 200-list pass (roughly 2–3%). The small range overhead
is not an exact zero-cost claim, and this probe does not establish signed-spacing
throughput. The source hashes, all blocks and work counts are in `rich-source-perf`.
Both canonical snapshots contain all measurement sections and are medians of
three full runs. Both dashboards were regenerated afterward.

Final checks pass 171 tests / 1,004 assertions, TypeScript, lint, dead-code
checks, emitted package JS/TS consumers and the demo site build. Benchmark
collection also now rejects missing measurement sections: a deliberately wrong
page is rejected before snapshot output, and both correct browser snapshots
must contain all sections. Flat #210/#211, arbitrary styled-inline shaping and
general SHY accuracy remain outside this accepted change.

## Boundary-policy validation

This section records the boundary-only production revision `5af1ba8` and its
subsequent test promotion `9f00a4f`; rich-inline was unchanged at that revision.

The reviewed implementation keeps ordinary boundaries and emergency permission
in analysis and preserves source neighbors through punctuation compaction.
Gecko’s additional tailoring is restricted to the observed ASCII boundary domain.
Measurement retains main’s producer model and observes each coarse analyzed run
before constructing its CJK units. The only shared-helper cleanup moves the
identical grapheme segmenters under analysis; `clearCache()` still resets
segmentation, metric and line-text caches.

The boundary revision requires independent native and API checks for the three selected
issue groups. Existing maintained requirements remain intact. #210 keeps its
observations and passing-baseline protection; that revision does not claim an
absolute #210 pass.

The final full comparison against pinned main `12097db6` passed all six
browser/direction legs at DPR 2. Each passing native metric is preserved
independently, including research metrics. There are zero lost passes, failed
required checks, execution errors, new API/rich failures or failures without an
observed baseline across 656,336 browser/input observations:

| Browser | Full LTR / RTL | Gained native metrics | Lost native metrics |
| --- | ---: | ---: | ---: |
| Chrome | 147,691 / 71,008 | 3,260 | 0 |
| Safari | 147,994 / 70,974 | 3,254 | 0 |
| Firefox | 147,657 / 71,012 | 4,836 | 0 |

Gains count separate metric events, not fully correct cases or an overall
accuracy score. Main's existing failures remain visible. The nine numeric
environment profiles also have zero new failures and unchanged TAB behavior.
Raw observations, frozen sources, manifests and `PRESERVATION-AUDIT.json` are in
`/private/tmp/pretext-focused-results-20260905/break-policy-review-full-v3/`.
Its suite hash is
`cef27c841c9655694478f896d4035ee2555174d5a0fbf535eaf4d79174143ebc`.
Accuracy, letter-spacing and all three corpus snapshots come from this run.

A fresh reported-case comparison also preserves all original and follow-up
worktree successes within the three selected issue groups, across 139 LTR inputs
per browser. The new symbol handling gains 18 metrics over original in
Chrome/Safari and 22 in Firefox, plus 16 over follow-up in Firefox. Every loss
against those worktrees belongs to unresolved #210/#211; this does not establish
overall replacement of either worktree. No RTL inputs match this family filter.
The grouped evidence is
`/private/tmp/pretext-focused-results-20260905/OLD-REPORTED-COMPARISON.json`.

Full validation rejected broader emoji overflow eligibility, Gecko box-width
quantization as a text-fit model, wider Unicode-affix tailoring, and generic
opener rules overriding the existing CJK-leading mixed-run policy. Their raw
failures remain in `break-policy-review-full` and `break-policy-review-full-v2`
under `/private/tmp/pretext-focused-results-20260905/`. The affected Firefox
brace family passes after restoring CJK precedence. Ordinary now includes the
exact emoji, ASCII-opener and CJK-prefix failures with nearby controls; full
retains every original input.

The subsequent source-view fixture promotion from test-only commit `9624e9d`
adds twenty semantic inputs and provenance for three retained inputs. Ordinary
and full share these same cases. A fresh replay of the source-view family in all
three browsers selects 25 inputs per browser after merged provenance: every
observed boundary-branch result is identical to main, with zero required, API,
rich or execution failures. This is a focused follow-up to the full run above;
it does not claim that run already contained these twenty new inputs. Reports
are in `boundary-new-source-view-controls` in the same external results directory.
The independent test-only branch also passed its complete ordinary run with
33,187 predictions/assessments identical to main. The added observations do not
establish a correct #210 implementation.

Foreground Chrome and Safari benchmark snapshots were refreshed against a fresh
`89234cd` checkout, whose production source is main's. Separate page runs showed
substantial common drift, including the unchanged DOM controls; reversing the
Chrome order reversed the preparation result. A throwaway same-page comparison
therefore interleaved independent baseline/current modules in eight ABBA/BAAB
blocks after two warmup blocks. Both sources clear their own caches before cold
preparation. The final probe repeats hot resize 200 times and Arabic rich
operations 120 times per sample to reduce timer granularity.

| Paired operation | Chrome current/base | Safari current/base |
| --- | ---: | ---: |
| Cold 500-text preparation | 1.006× | 0.958× |
| Hot 500-text resize | 1.015× | 1.012× |
| Arabic preparation | 1.012× | 1.002× |
| Arabic resize | 1.025× | 1.012× |
| Arabic rich statistics | 0.990× | 1.000× |
| Arabic rich ranges | 1.017× | 1.000× |
| Arabic rich materialization | 0.892× | 1.017× |

These are median within-block ratios, not ratios of independently chosen best
times. The first paired Chrome probe measured 1.073× cold preparation and
1.029× Arabic preparation; it used only 12 rich-operation repeats and is retained
too. The repeated samples support modest possible preparation overhead, with no
material resize or long-form regression in this check. They do not establish a
speedup or exact zero cost. The canonical snapshots remain medians of three full
page runs, not these supplemental probes. Raw reports and the probe source are
under `break-policy-paired/`; the separate page reports use the
`break-policy-benchmark-` prefix in the same external results directory.

Runtime TypeScript grows from 5,552 to 5,664 lines and 158,573 to 165,149 bytes
(nine files, excluding tests and test data). Identically minified browser ESM
bundles grow by 2,110 bytes per entry point: the main entry is 48,486 → 50,596
bytes, or 16,163 → 16,900 bytes gzip; rich-inline is 52,668 → 54,778 bytes, or
17,267 → 18,001 bytes gzip. These are separate entry bundles, not a combined
application payload. Exact commands and counts are in `break-policy-size/`.

Final verification passes 165 tests / 959 assertions, TypeScript, lint and
dead-code checks, package emit, tarball JS/TS consumer smoke tests, and the demo
site build. Both dashboards were regenerated. That production source and then-current suite files
match the full run's recorded hashes. Main's line walker and rich-inline source
remain unchanged. All changes remain on the review branch; this validation does
not establish that the entire older worktree is dominated or that #210 is fixed.

The sections below record the earlier test-consolidation validation at
`89234cd`; those counts and timings describe that test-only revision, not the
boundary-policy implementation.

## One set of inputs and assertions

Ordinary runs all maintained accuracy, corpus, whitespace, keep-all, symbol,
spacing and discretionary cases, plus explicit counterexamples and nearby
controls. Full adds the broad exploratory matrices using the same definitions
and assertions. Their shared numeric companion checks public API agreement and
prohibits Canvas calls after preparation across nine environment profiles.

The retained recipes reproduce all 209,138 historical fixed-width public inputs,
including their settings, exact width values, origins and families. An exhaustive
before/after input comparison found no additions, omissions or changed settings.
Ordinary retains all 122 nominated evidence records. Of the 270 directed
browser/candidate comparisons in the frozen earlier captures, 249 have native
losses; ordinary retains an exact witness for every one. It does not retain every
historical loss row. Input imports
from nine older experiment cohorts also do not reproduce their original document
language/font-loading protocol; see INVENTORY for that distinction.

Maintained cases preserve their original content widths, preparation route,
normalization, languages, browser scope, Range/span extractor and tolerances.
Fixture fonts and installed fonts now have explicit, separate browser contexts.
Each direction/context starts in a fresh document before Canvas preparation.
This prevents controlled fonts from overriding installed fallbacks and preserves
generic-font resolution, which can retain the document's initial language.
Native element language and preparation locale remain separate inputs.

Required maintained metrics need an absolute observed pass. Canonical accuracy
still checks height with a tolerance below 1px. Corpus still records rounded
height differences and does not require every width to match. Elsewhere, the gate
preserves observed successes against pinned main and any requested references.
Height, line count/boundaries, source placement, whitespace, widths, selected
hyphens and API contracts remain separate; improvements cannot cancel losses.
Errors from any source fail the run. Unobserved and inapplicable checks are not
passes. API agreement establishes consistency, not browser correctness.

Public contracts retain valid copied continuations, variable widths, visible and
preserved source coverage, rich item coordinates, callback ownership, atomic
pills and signed SPACE gaps. They do not invent ownership requirements for
collapsed SPACE, inactive SHY/ZWSP or pre-wrap newlines between rendering ranges.
Preserved whitespace, joiners and combining marks cannot disappear. Interrupted
contract groups discard partial passes while retaining their counterexamples.

## Migration parity and full validation

The original main checkers and the consolidated runner agree:

| Maintained observation | Chrome | Safari | Firefox |
| --- | ---: | ---: | ---: |
| Accuracy inputs and exact native/predicted heights | 7,680 / 7,680 | 7,680 / 7,680 | 7,680 / 7,680 |
| Compact cases, including their selected line diagnostics | 53 / 53 | 53 / 53 | 11 / 11 |
| Corpus width statuses | 1,098 / 1,098 | 1,098 / 1,098 | New coverage |
| Saved corpus mismatch measurements | 55 / 55 | 13 / 13 | New coverage |

Firefox accuracy was compared with an archived original checker launched headed
at DPR 2. Its earlier headless DPR 1 capture differed on 28 emoji rows, shifting
native and predicted heights together without changing pass status. Matching the
environment removes those numeric differences. Old corpus captures did not save
absolute geometry for successful widths, so that parity claim is status-only.
There was no old Firefox corpus capture to compare.

The consolidation’s ordinary and full comparisons of pinned main `12097db6`
with checkout `89234cd` completed at DPR 2, with identical results, zero new regressions, zero
failed required checks and zero execution errors. The full runs cover 656,285
browser/input observations:

| Browser | Ordinary LTR / RTL | Full LTR / RTL |
| --- | ---: | ---: |
| Chrome | 10,262 / 813 | 147,674 / 71,008 |
| Safari | 10,228 / 779 | 147,977 / 70,974 |
| Firefox | 10,228 / 817 | 147,640 / 71,012 |

This is a regression-gate pass, not universal native correctness. Main's existing
failures remain visible. For example, Firefox case `wrap-5123bf2f598e26a1`
(`a\u00adb\ufffe`, pre-wrap) disagrees across batch/statistics/streaming APIs;
`wrap-d100ee2cf3c97c9a` (`a\u3000\u2060b`, width 8) loses the final visible `b`.
Chrome case `wrap-dfa8b337a210cbe1` (`a\u00ad\tb`, Amiri, pre-wrap) retains its
API disagreement too. These remain counterexamples in ordinary.

Accuracy, spacing and all three corpus snapshots now come from those same run
rows. The writer validates completeness before emitting totals and mismatches;
it does not launch another browser sweep. Corpus mismatch widths and heights
retain the legacy outer-box padding of 80px, with `contentWidth` explicit.
Firefox's fresh corpus capture has 136 mismatching widths; the dashboard labels
its numeric results separately from historical Chrome/Safari investigation notes.

## Test cost and removed machinery

The pre-trim reference is consolidation commit `a56d0f9`. The final change removes
eight old checker scripts, the duplicate discretionary page, probe batching,
repeated contract implementations and duplicate known-main indexes. Detailed
corpus, probe and font investigations remain available. The accuracy page reads
snapshots. One runner owns scheduling, collection, comparison and snapshot output.

In the scoped maintained-check/shared-suite code, including whole retained
accuracy/corpus/probe pages and corpus-status, code falls from 8,333 to 7,040 lines
across 31 to 24 files. This excludes unchanged shared transports and detailed
investigation scripts. The same scope is 5,907 lines on original main, so the
consolidated suite adds 1,133 lines relative to main while covering the expanded
contracts and retained experiments.

Retained JSON falls from 4,261,040 to 1,635,525 bytes (61.6% smaller), with exact
finite recipes replacing repeated strings and widths. All suite data, including
the removed duplicate indexes, falls from 7,607,274 to 1,789,977 bytes (76.5%
smaller). The 1,916,477 bytes of controlled fonts/licenses remain unchanged.

Consecutive widths share a preparation only while public preparation inputs are
equal. Every width still gets its observations and public checks. Numeric
coverage is 49 preparations and 196 width trials per source/profile, down from
126 preparations and 756 trials; all nine profiles and the complete 80-row TAB
compatibility probe remain.

Measured wall times include process startup, source freezing, numeric tests and
browser collection for the suite commands. Units and checks use five repetitions;
Chrome browser commands use three; Safari/Firefox use one each. Medians are shown.
There were no competing browser checkers. Environment: macOS 26.5.2, Bun 1.4.0,
headed DPR 2 browsers; exact user agents are in each report.

| Command | Pre-trim | Final |
| --- | ---: | ---: |
| Full Chrome | 133.92s | 94.66s |
| Full Safari | 233.90s | 122.54s |
| Full Firefox | 138.80s | 84.67s |
| `bun test` | 0.842s | 1.556s |
| `bun run check` | 2.722s | 2.408s |

Full browser time decreases by 29%, 48% and 39%. Ordinary takes 41.51s in Chrome,
44.47s in Safari and 33.86s in Firefox. It is larger than the old fast selection
(~11,000 versus ~4,700 cases/browser), and slower than its 13.58/15.52/14.96s.
Ordinary now includes the complete maintained grids, not just a smoke selection.
The original main's separate Chrome maintained commands totaled about 26s, and
Safari's about 87s; neither included the expanded experiment/API contracts.
Firefox previously ran only accuracy and discretionary checks, so its old 5.81s
workflow is not comparable to the new corpus and experiment coverage.

Unit time increased because the inventory tests expand and verify retained
recipes and ordinary/full assertion identity. Final `bun test` passes 157 tests
with 898 assertions. Type/lint/unused checks, tarball JS/TS consumer checks, the
public demo build and the accuracy-page bundle all pass. Packaging used a
task-local npm cache because the sandbox cannot write the user's default cache.
These are test-tool timings, not wrapping-engine benchmarks.

## Candidate comparison

The nine retained sources were freshly compared as-is against main on ordinary
in all three browsers. This does not rebase old heads onto main or establish a
full-inventory pass. Every source completed without execution errors.

| Name | Frozen source |
| --- | --- |
| `original` | Original wrapping worktree, `5961d083`. |
| `followup` | Follow-up wrapping worktree, `8e48e1ce`. |
| `targeted` | Targeted policy v5 based on follow-up. |
| `narrow` | Main-based family integration v7: restricted whole-source observations and Safari precision. |
| `v14` | Earlier bounded composition, retained as a comparison reference. |
| `v16` | Later spacing/context composition with Gecko dictionary-boundary changes. |
| `shy` | Chrome/Safari SHY source v3 with copied-result metadata correction. |
| `gecko` | Separate Gecko SHY-selection prototype with that metadata correction. |
| `rich` | Main-based rich-inline item-coordinate, callback-ownership and SPACE-gap worktree. |

The table counts unique supported inputs losing at least one passing native
metric versus main, combining LTR and RTL. A case can lose several metrics; these
are case counts, not summed metric events or an overall accuracy score.

| Candidate | Chrome lost cases | Safari lost cases | Firefox lost cases |
| --- | ---: | ---: | ---: |
| `original` | 23 | 10 | 49 |
| `followup` | 27 | 22 | 66 |
| `targeted` | 43 | 33 | 115 |
| `narrow` | 0 | 0 | 0 |
| `v14` | 43 | 9 | 280 |
| `v16` | 75 | 46 | 108 |
| `shy` | 176 | 250 | 108 |
| `gecko` | 176 | 250 | 108 |
| `rich` | 0 | 0 | 0 |

Only `narrow` and `rich` preserve all observed main successes and pass required
and numeric checks in ordinary. Neither preserves all original/follow-up
successes, so neither replaces the old wrapping fixes. No candidate introduces
an API/global-rich failure on a check that passed on main. Existing failures and
losses against the old references remain recorded separately.

`narrow` fixes 2/2/4 supported native cases in Chrome/Safari/Firefox and two
Firefox API cases. `rich` leaves native results unchanged and reduces global rich
contract failures from 82/66/58 to 11/11/7; its source differs from main only in
`rich-inline.ts`. Both still lose 155/208/217 native passing cases relative to
follow-up. Main has 18/14/13 failing per-case API inputs in this selection;
`narrow` retains 18/14/11 and `rich` retains all of them. The four broader heads
have zero observed per-case API/global-rich failures, alongside their native
losses above. Consistency improvements do not establish native correctness.

The original head fails 10 required checks across five discretionary cases in
each browser. It lacks the later terminal-SHY fix `582fcb2`, present in main and
follow-up; these head-level losses do not show that an isolated cherry-pick onto
main would cause them. `v14` fails three required Firefox accuracy cases. Required
failures of preserved references remain recorded but do not fail the other
candidates' gate by themselves. All synthetic
API/no-Canvas contracts pass, but `v16`, `shy` and `gecko` each change retained TAB
behavior in all six unverified profiles (`crios`, `crios-desktop`, `fxios`,
`edgios`, `unknown`, `none`) relative to main and both old references.

No complete wrapping candidate is established as a mergeable replacement. The
small main-based and rich-inline candidates are useful separate leads; they still
need full coverage, implementation review and foreground runtime benchmarks
before adoption. No issue/PR closure or complete rich-Markdown claim follows from
these captures.

## Reproduction and limits

Local audit artifacts are under
`/private/tmp/pretext-trim-timing-20260905/`. Formal current-versus-main reports use
`after-{browser}-{ordinary|full}-1`; Chrome also has repetitions 2 and 3. Before and
after wall-time records are in `before.ndjson` and `after.ndjson`; only `after-`
labels belong to the final timing series. Each run freezes source files, harness,
inputs and browser environments, and preserves full raw rows.

The ordinary/full timing harness hash is
`1d5bb41e1f0fb8fbfadadf2c8e3d5a46cd894041a5855001b3a69e86c9594ca6`.
The final candidate run is `candidates-final`, hash
`8c879738438dbb23cc1a76e1b11e623afe3430a9e7b8c37a7992128b14dda330`.
The only harness differences are rejection of invalid preserve selections and
the snapshot writer's outer-box height presentation. Inputs, observers and
assertions are identical. Snapshot values were separately checked against every
formal accuracy/corpus row; invalid preserve selection was explicitly exercised.

Ambiguous rectangles and unsupported paint/width observations remain
unobserved. Verified font loading does not identify each glyph's selected
fallback face. Direction-conflict inputs remain research observations while
public API checks still apply. HarfBuzz, custom font loading in production,
exhaustive substring producers and runtime DOM measurement remain outside the
current adoption scope. The suite records evidence within these boundaries; it
does not promise universal browser equivalence.
