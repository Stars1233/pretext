# Font context diagnostics

Run `bun run font-probe --browser=chrome --output=/tmp/font-probe.json`, or open `/font-probe` after `bun start`. Safari and Firefox are also accepted. The page uses the same Google Fonts family/weight request as the [#195 reproduction](https://github.com/chenglou/pretext/issues/195), and fails if the requested face is absent. That live URL does not pin a font binary revision. Network/font failures must not become fallback-font evidence.

The retained probes separate facts that a single width comparison hides:

- A whole text run in Canvas and an unwrapped DOM element.
- The sum of separately measured graphemes.
- Each prefix measured as its own text run.
- Each prefix measured with `Range` inside the unchanged complete text node.
- Canvas prefix measurements with one following grapheme of context.
- A detached HTML canvas whose language matches the text element.

The repeated-letter controls also test 48 widths around exact measured thresholds. They retain native source boundaries, Pretext boundaries, independently reshaped prefix boundaries, and a forward-context fit experiment. The latter two are diagnostic models, not alternate public line breakers. The page keeps one native text node; wrapping every grapheme in a span could itself change shaping.

## Shantell Sans

On September 3, 2026, `bold 15px "Shantell Sans"`, 56 `x` characters, a 140px content width and `pre-wrap` reproduced 15/15/15/11 native characters versus 16/16/16/8 in Pretext in Chrome 152 and Firefox 152. Firefox's whole-run DOM and Canvas widths both measured 501.75px; separately measured characters summed to 480.66665px.

Turning on the existing prefix model fixed that one width and passed the canonical 7,680-case Firefox sweep. It did not solve the font's narrow thresholds: in Chrome, the candidate matched only 16/48 bold and 16/48 regular Shantell probes. It was rejected and is not included in the library changes here.

The in-context probe explains the difference. Chrome's first bold `x` measured about 8.586px alone and 8.969px inside the whole DOM run. A Canvas measurement with the following character retained measured about 8.961px. The forward-context experiment matched all 48 recorded thresholds for each of the bold, regular and Arial controls. This is evidence for the fit model, not proof of arbitrary contextual shaping or exact painted line widths. A proper engine change needs to represent those differences explicitly instead of adding a font-name correction.

Safari 26.5.2 is a useful negative control: the same forward-context model matched only 16/48 thresholds for each Shantell face, while reshaping each line prefix matched 42/48. Its Arial control matched 48/48. The extractor ignores Safari's extra zero-width rectangle at a wrap boundary without splitting the native text into spans. The Chrome/Firefox fit result must not become an unconditional browser policy.

## Language context

For `foo-bar日本語` in `18px serif`, `lang=ja`, the Firefox DOM measured 114.867px while the default offscreen canvas measured 106.983px. An HTML canvas with `lang=ja` measured 114.867px. Chrome showed the same class; Times New Roman controls agreed in both browsers.

Safari's language-bound canvas control still measured 106.972px against the DOM's 114.859px. Its named-font control agreed. Matching the element's language attribute alone is therefore not a cross-browser solution.

The [Canvas text-style specification](https://html.spec.whatwg.org/multipage/canvas.html#text-styles) includes language context. Pretext's locale setting selects word segmentation; it does not currently configure Canvas font language. A future measurement-owner API should include that context in the owner's identity and cache lifetime.

These observations do not retest the separate Retina emoji or `system-ui` bugs. The diagnostic records browser and DPR; the repository's default Firefox transport runs at DPR1.
