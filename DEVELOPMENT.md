## Development Setup

Install once:

```sh
bun install
```

### Day-To-Day

- `bun start` — stable local page server at <http://localhost:3000>
- `bun run start:windows` — Windows-friendly fallback without automatic port cleanup
- `bun run check` — typecheck, lint, and dead-code scan (`knip`)
- `bun test` — small durable invariant suite, including approximate bidi paragraph independence and normal/pre-wrap normalization boundaries

### Packaging And Release

- `bun run build:package` — emit `dist/` for the published ESM package
- `bun run package-smoke-test` — pack the tarball and verify temporary JS + TS consumers
- `bun run site:build` — build the static demo site into `site/`
- `bun run generate:bidi-data` — refresh the checked-in simplified Unicode bidi ranges

`prepack` also rebuilds `dist/` through plain `tsc`, so source imports need `.js` specifiers that remain valid in the emitted files.

### Browser Accuracy And Benchmarking

- `bun run accuracy-check` — Chrome browser sweep
- `bun run accuracy-check:safari`
- `bun run accuracy-check:firefox`
- `bun run accuracy-snapshot` — refresh `accuracy/chrome.json`
- `bun run accuracy-snapshot:safari`
- `bun run accuracy-snapshot:firefox`
- `bun run benchmark-check` — Chrome benchmark snapshot; default is the median of 3 full page runs, use `--runs=1` for a quick local check
- `bun run benchmark-check:safari`
- `bun run pre-wrap-check` — small batched browser check for `{ whiteSpace: 'pre-wrap' }`
- `bun run keep-all-check` — small batched browser check for `{ wordBreak: 'keep-all' }`, including mixed-script text without spaces
- `bun run discretionary-check` — compact soft-hyphen width/text oracle plus recorded browser-dependent narrow cases; accepts `--browser=safari` or `--browser=firefox`
- `bun run symbol-check` — small batched Chrome + Safari check for symbol runs inside long words
- `bun run justification-check` — demo line geometry and source continuity at reported widths; use `--browser=safari` or `--full` for all slider widths
- `bun run letter-spacing-check` — small batched Chrome + Safari check for `{ letterSpacing }`
- `bun run letter-spacing-snapshot` — refresh `accuracy/letter-spacing.json` from the Chrome + Safari `{ letterSpacing }` check
- `bun run probe-check` — smaller browser diagnostic
- `bun run probe-check:safari`

The compact `pre-wrap-check`, `keep-all-check`, and `symbol-check` scripts share one runner. They keep their own case sets and line-comparison policy. Use `--output=/tmp/oracle.json` to save the report, including browser user agent, device pixel ratio and page visibility.

For portable Chrome correctness checks, use `bun run keep-all-check --transport=playwright --browser=chrome`. This launches installed Chrome in an isolated headed browser with its native viewport; it does not require AppleScript or a Unix shell. Install Chrome normally first; the adapter uses `playwright-core` without downloading another browser. Automation locks use the platform's temporary directory. The page server runs the current Bun executable directly, and includes demo pages as well as diagnostics. Safari continues to use the native macOS path; Playwright WebKit is not treated as Safari. This transport is for correctness checks only; benchmark scripts retain foreground native automation. Check the recorded DPR and real target fonts when validating platform-specific font issues.

When a probe finds a first-break mismatch, the report includes a short trace. `sN:gM` identifies a segment and grapheme; `[ours]` and `[browser]` identify the competing break positions. Safari `Range` extraction can be wrong around preserved whitespace and URL queries even when the rendered height is correct, so compare `--method=span` before changing the engine.

### Corpus Tooling

- `bun run corpus-check` — diagnose one corpus at one or a few widths
- `bun run corpus-check:safari`
- `bun run corpus-sweep` — maintained Chrome `step=10` corpus width sweep
- `bun run corpus-sweep:safari` — maintained Safari `step=10` corpus width sweep
- `bun run corpus-font-matrix` — same corpus under alternate fonts
- `bun run corpus-font-matrix:safari`
- `bun run corpus-taxonomy` — group corpus mismatches by likely cause
- `bun run corpus-status` — rebuild `corpora/dashboard.json`
- `bun run corpus-status:refresh` — refresh Chrome and Safari `step=10` sweeps, then the corpus dashboard

### Status Dashboards

- `bun run status-dashboard` — rebuild `status/dashboard.json`

## Useful Pages

- `/demos/index` — index of the public demos
- `/accuracy` — browser sweep and per-line diagnostics
- `/benchmark` — performance comparisons
- `/corpus` — long-form corpus diagnostics

## Current Dashboards And Snapshots

Use these for the current checked-in results:

- [status/dashboard.json](status/dashboard.json) — machine-readable main dashboard
- [accuracy/chrome.json](accuracy/chrome.json), [accuracy/safari.json](accuracy/safari.json), [accuracy/firefox.json](accuracy/firefox.json) — raw browser accuracy rows
- [accuracy/letter-spacing.json](accuracy/letter-spacing.json) — results from the small Chrome + Safari `{ letterSpacing }` check
- [benchmarks/chrome.json](benchmarks/chrome.json), [benchmarks/safari.json](benchmarks/safari.json) — raw benchmark snapshots
- [corpora/dashboard.json](corpora/dashboard.json) — machine-readable corpus dashboard
- [corpora/chrome-step10.json](corpora/chrome-step10.json), [corpora/safari-step10.json](corpora/safari-step10.json) — checked-in browser `step=10` corpus sweep snapshots

[PLATFORM_BUGS.md](PLATFORM_BUGS.md) lists current browser and OS issues and their workarounds. [RESEARCH.md](RESEARCH.md) keeps durable findings and rejected approaches; it is not a source for current counts or issue status.

## Deep Profiling

For one-off performance and memory work, start with `bun start` and an isolated, foreground Chrome using a throwaway profile. Reproduce the issue on [pages/benchmark.ts](pages/benchmark.ts), or on a smaller dedicated page when the benchmark is too broad.

- Use the benchmark for throughput regressions.
- Use a CPU profile or performance trace for hotspots.
- Use heap sampling for allocation churn.
- Diff forced-GC heap snapshots for retained memory.

Bun/Node microbenchmarks are useful for quick experiments, but browser behavior needs browser measurements.
