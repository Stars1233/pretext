// Text measurement for browser environments using canvas measureText.
//
// Problem: DOM-based text measurement (getBoundingClientRect, offsetHeight)
// forces synchronous layout reflow. When components independently measure text,
// each measurement triggers a reflow of the entire document. This creates
// read/write interleaving that can cost 30ms+ per frame for 500 text blocks.
//
// Solution: two-phase measurement centered around canvas measureText.
//   prepare(text, font) — segments text via Intl.Segmenter, measures each word
//     via canvas, caches widths, and does one cached DOM calibration read per
//     font when emoji correction is needed. Call once when text first appears.
//   layout(prepared, maxWidth, lineHeight) — walks cached word widths with pure
//     arithmetic to count lines and compute height. Call on every resize.
//     ~0.0002ms per text.
//
// i18n: Intl.Segmenter handles CJK (per-character breaking), Thai, Arabic, etc.
//   Bidi: Unicode Bidirectional Algorithm for mixed LTR/RTL text.
//   Punctuation merging: "better." measured as one unit (matches CSS behavior).
//   Trailing whitespace: hangs past line edge without triggering breaks (CSS behavior).
//   overflow-wrap: pre-measured grapheme widths enable character-level word breaking.
//
// Emoji correction: Chrome/Firefox canvas measures emoji wider than DOM at font
//   sizes <24px on macOS (Apple Color Emoji). The inflation is constant per emoji
//   grapheme at a given size, font-independent. Auto-detected by comparing canvas
//   vs actual DOM emoji width (one cached DOM read per font). Safari canvas and
//   DOM agree (both wider than fontSize), so correction = 0 there.
//
// Limitations:
//   - system-ui font: canvas resolves to different optical variants than DOM on macOS.
//     Use named fonts (Helvetica, Inter, etc.) for guaranteed accuracy.
//     See RESEARCH.md "Discovery: system-ui font resolution mismatch".
//
// Based on Sebastian Markbage's text-layout research (github.com/chenglou/text-layout).

const canvas = typeof OffscreenCanvas !== 'undefined'
  ? new OffscreenCanvas(1, 1)
  : document.createElement('canvas')
const ctx = canvas.getContext('2d')!

// Word width cache: font → Map<segment, width>.
// Persists across prepare() calls. Common words ("the", "a", etc.) are measured
// once and shared across all text blocks. Survives resize since font doesn't change.
// No eviction: grows monotonically per font. Typical single-font feed ≈ few KB.
// Call clearCache() to reclaim if needed (e.g. font change, long session).

const wordCaches = new Map<string, Map<string, number>>()

function getWordCache(font: string): Map<string, number> {
  let cache = wordCaches.get(font)
  if (!cache) {
    cache = new Map()
    wordCaches.set(font, cache)
  }
  return cache
}

function measureSegment(seg: string, cache: Map<string, number>): number {
  let w = cache.get(seg)
  if (w === undefined) {
    w = ctx.measureText(seg).width
    cache.set(seg, w)
  }
  return w
}

type EngineProfile = {
  lineFitEpsilon: number
  carryCJKAfterClosingQuote: boolean
}

function getEngineProfile(): EngineProfile {
  if (typeof navigator === 'undefined') {
    return {
      lineFitEpsilon: 0.005,
      carryCJKAfterClosingQuote: false,
    }
  }

  const ua = navigator.userAgent
  const vendor = navigator.vendor
  const isSafari =
    vendor === 'Apple Computer, Inc.' &&
    ua.includes('Safari/') &&
    !ua.includes('Chrome/') &&
    !ua.includes('Chromium/') &&
    !ua.includes('CriOS/') &&
    !ua.includes('FxiOS/') &&
    !ua.includes('EdgiOS/')
  const isChromium =
    ua.includes('Chrome/') ||
    ua.includes('Chromium/') ||
    ua.includes('CriOS/') ||
    ua.includes('Edg/')

  return {
    // WebKit is slightly more permissive than Chromium/Gecko at the line edge.
    lineFitEpsilon: isSafari ? 1 / 64 : 0.005,
    // Chromium tends to keep Hangul that follows a closing quote cluster on the
    // next line, e.g. `어.”라고`, even when the shorter `어.”` would fit.
    carryCJKAfterClosingQuote: isChromium,
  }
}

const engineProfile = getEngineProfile()
const lineFitEpsilon = engineProfile.lineFitEpsilon
const arabicScriptRe = /\p{Script=Arabic}/u

function parseFontSize(font: string): number {
  const m = font.match(/(\d+(?:\.\d+)?)\s*px/)
  return m ? parseFloat(m[1]!) : 16
}

const collapsibleWhitespaceRunRe = /[ \t\n\r\f]+/g
const needsWhitespaceNormalizationRe = /[\t\n\r\f]| {2,}|^ | $/

function normalizeWhitespaceNormal(text: string): string {
  if (!needsWhitespaceNormalizationRe.test(text)) return text

  let normalized = text.replace(collapsibleWhitespaceRunRe, ' ')
  if (normalized.charCodeAt(0) === 0x20) {
    normalized = normalized.slice(1)
  }
  if (normalized.length > 0 && normalized.charCodeAt(normalized.length - 1) === 0x20) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}

// Emoji correction: canvas measureText inflates emoji widths on Chrome/Firefox
// at font sizes <24px on macOS. The inflation is per-emoji-grapheme, constant
// across all emoji types (simple, ZWJ, flags, skin tones, keycaps) and all font
// families. Auto-detected by comparing canvas vs DOM emoji width (one cached
// DOM read per font). Safari canvas and DOM agree, so correction = 0.

const emojiPresentationRe = /\p{Emoji_Presentation}/u
// Shared segmenters: hoisted to module level to avoid per-prepare() construction.
// Intl.Segmenter construction loads ICU data internally — expensive to repeat.
// Captures the default locale at module load time. If locale support is needed
// in the future, expose a function to reinitialize these with a new locale.
const sharedWordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
const sharedGraphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function isEmojiGrapheme(g: string): boolean {
  return emojiPresentationRe.test(g) || g.includes('\uFE0F')
}

const emojiCorrectionCache = new Map<string, number>()

function getEmojiCorrection(font: string, fontSize: number): number {
  let correction = emojiCorrectionCache.get(font)
  if (correction !== undefined) return correction

  ctx.font = font
  const canvasW = ctx.measureText('\u{1F600}').width
  correction = 0
  if (canvasW > fontSize + 0.5) {
    const span = document.createElement('span')
    span.style.font = font
    span.style.display = 'inline-block'
    span.style.visibility = 'hidden'
    span.style.position = 'absolute'
    span.textContent = '\u{1F600}'
    document.body.appendChild(span)
    const domW = span.getBoundingClientRect().width
    document.body.removeChild(span)
    if (canvasW - domW > 0.5) {
      correction = canvasW - domW
    }
  }
  emojiCorrectionCache.set(font, correction)
  return correction
}

function countEmojiGraphemes(text: string): number {
  let count = 0
  for (const g of sharedGraphemeSegmenter.segment(text)) {
    if (isEmojiGrapheme(g.segment)) count++
  }
  return count
}

function containsArabicScript(text: string): boolean {
  return arabicScriptRe.test(text)
}

// CJK characters don't use spaces between words. Intl.Segmenter with
// granularity 'word' groups them into multi-character words, but CSS allows
// line breaks between any CJK characters. We detect CJK segments and split
// them into individual graphemes so each character is a valid break point.

function isCJK(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if ((c >= 0x4E00 && c <= 0x9FFF) ||     // CJK Unified
        (c >= 0x3400 && c <= 0x4DBF) ||     // CJK Extension A
        (c >= 0x20000 && c <= 0x2A6DF) ||   // CJK Extension B
        (c >= 0x2A700 && c <= 0x2B73F) ||   // CJK Extension C
        (c >= 0x2B740 && c <= 0x2B81F) ||   // CJK Extension D
        (c >= 0x2B820 && c <= 0x2CEAF) ||   // CJK Extension E-F
        (c >= 0x3000 && c <= 0x303F) ||     // CJK Punctuation
        (c >= 0x3040 && c <= 0x309F) ||     // Hiragana
        (c >= 0x30A0 && c <= 0x30FF) ||     // Katakana
        (c >= 0xAC00 && c <= 0xD7AF) ||     // Hangul
        (c >= 0xFF00 && c <= 0xFFEF)) {     // Fullwidth
      return true
    }
  }
  return false
}

// Kinsoku shori (禁則処理): CJK line-breaking rules.
// Line-start prohibition: these characters cannot start a new line.
// To prevent this, they are merged with the preceding grapheme during
// CJK splitting, keeping them together as one unit.
const kinsokuStart = new Set([
  // Fullwidth punctuation
  '\uFF0C', // ，
  '\uFF0E', // ．
  '\uFF01', // ！
  '\uFF1A', // ：
  '\uFF1B', // ；
  '\uFF1F', // ？
  // CJK punctuation
  '\u3001', // 、
  '\u3002', // 。
  '\u30FB', // ・
  // Closing brackets
  '\uFF09', // ）
  '\u3015', // 〕
  '\u3009', // 〉
  '\u300B', // 》
  '\u300D', // 」
  '\u300F', // 』
  '\u3011', // 】
  '\u3017', // 〗
  '\u3019', // 〙
  '\u301B', // 〛
  // Prolonged sound mark, iteration marks
  '\u30FC', // ー
  '\u3005', // 々
  '\u303B', // 〻
])

// Line-end prohibition: these characters should stay with the following text.
// To prevent line starts with opening punctuation, they are merged with the
// following grapheme in CJK splitting, and with the following word in general
// merging.
const kinsokuEnd = new Set([
  // ASCII/Latin
  '"',
  '(', '[', '{',
  // Curly quotes / guillemets
  '“', '‘', '«', '‹',
  // CJK fullwidth
  '\uFF08', // （
  '\u3014', // 〔
  '\u3008', // 〈
  '\u300A', // 《
  '\u300C', // 「
  '\u300E', // 『
  '\u3010', // 【
  '\u3016', // 〖
  '\u3018', // 〘
  '\u301A', // 〚
])

// Non-word leading glue that should stay with the following segment in
// non-CJK text. This covers elisions like ’em.
const forwardStickyGlue = new Set([
  "'", '’',
])

// Non-space punctuation that should stay with the preceding segment in
// non-CJK text. Keep dash punctuation out of this set so lines may still break
// before an em dash or hyphenated continuation, matching browser behavior more
// closely on English prose.
const leftStickyPunctuation = new Set([
  '.', ',', '!', '?', ':', ';',
  '\u060C', // ،
  '\u061B', // ؛
  '\u061F', // ؟
  '\u0964', // ।
  '\u0965', // ॥
  ')', ']', '}',
  '%',
  '"',
  '”', '’', '»', '›',
  '…',
])

const arabicNoSpaceTrailingPunctuation = new Set([
  ':',
  '.',
  '\u060C', // ،
  '\u061B', // ؛
])

const combiningMarkRe = /\p{M}/u

const closingQuoteChars = new Set([
  '”', '’', '»', '›',
  '\u300D', // 」
  '\u300F', // 』
  '\u3011', // 】
  '\u300B', // 》
  '\u3009', // 〉
  '\u3015', // 〕
  '\uFF09', // ）
])

function isLeftStickyPunctuationSegment(segment: string): boolean {
  let sawPunctuation = false
  for (const ch of segment) {
    if (leftStickyPunctuation.has(ch)) {
      sawPunctuation = true
      continue
    }
    if (sawPunctuation && combiningMarkRe.test(ch)) continue
    return false
  }
  return sawPunctuation
}

function isCJKLineStartProhibitedSegment(segment: string): boolean {
  for (const ch of segment) {
    if (!kinsokuStart.has(ch) && !leftStickyPunctuation.has(ch)) return false
  }
  return segment.length > 0
}

function isForwardStickyClusterSegment(segment: string): boolean {
  for (const ch of segment) {
    if (!kinsokuEnd.has(ch) && !forwardStickyGlue.has(ch) && !combiningMarkRe.test(ch)) return false
  }
  return segment.length > 0
}

function isRepeatedSingleCharRun(segment: string, ch: string): boolean {
  if (segment.length === 0) return false
  for (const part of segment) {
    if (part !== ch) return false
  }
  return true
}

function endsWithArabicNoSpacePunctuation(segment: string): boolean {
  if (!containsArabicScript(segment) || segment.length === 0) return false
  return arabicNoSpaceTrailingPunctuation.has(segment[segment.length - 1]!)
}

function splitLeadingSpaceAndMarks(segment: string): { space: string, marks: string } | null {
  if (segment.length < 2 || segment[0] !== ' ') return null
  const marks = segment.slice(1)
  if (/^\p{M}+$/u.test(marks)) {
    return { space: ' ', marks }
  }
  return null
}

function endsWithClosingQuote(text: string): boolean {
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i]!
    if (closingQuoteChars.has(ch)) return true
    if (!leftStickyPunctuation.has(ch)) return false
  }
  return false
}

// Unicode Bidirectional Algorithm (UAX #9), forked from pdf.js via Sebastian's
// text-layout. Classifies characters into bidi types, computes embedding levels,
// and reorders segments within each line for correct visual display of mixed
// LTR/RTL text. Only needed for paragraphs containing RTL characters; pure LTR
// text fast-paths with null levels (zero overhead).

type BidiType = 'L' | 'R' | 'AL' | 'AN' | 'EN' | 'ES' | 'ET' | 'CS' |
                'ON' | 'BN' | 'B' | 'S' | 'WS' | 'NSM'

const baseTypes: BidiType[] = [
  'BN','BN','BN','BN','BN','BN','BN','BN','BN','S','B','S','WS',
  'B','BN','BN','BN','BN','BN','BN','BN','BN','BN','BN','BN','BN',
  'BN','BN','B','B','B','S','WS','ON','ON','ET','ET','ET','ON',
  'ON','ON','ON','ON','ON','CS','ON','CS','ON','EN','EN','EN',
  'EN','EN','EN','EN','EN','EN','EN','ON','ON','ON','ON','ON',
  'ON','ON','L','L','L','L','L','L','L','L','L','L','L','L','L',
  'L','L','L','L','L','L','L','L','L','L','L','L','L','ON','ON',
  'ON','ON','ON','ON','L','L','L','L','L','L','L','L','L','L',
  'L','L','L','L','L','L','L','L','L','L','L','L','L','L','L',
  'L','ON','ON','ON','ON','BN','BN','BN','BN','BN','BN','B','BN',
  'BN','BN','BN','BN','BN','BN','BN','BN','BN','BN','BN','BN',
  'BN','BN','BN','BN','BN','BN','BN','BN','BN','BN','BN','BN',
  'BN','CS','ON','ET','ET','ET','ET','ON','ON','ON','ON','L','ON',
  'ON','ON','ON','ON','ET','ET','EN','EN','ON','L','ON','ON','ON',
  'EN','L','ON','ON','ON','ON','ON','L','L','L','L','L','L','L',
  'L','L','L','L','L','L','L','L','L','L','L','L','L','L','L',
  'L','ON','L','L','L','L','L','L','L','L','L','L','L','L','L',
  'L','L','L','L','L','L','L','L','L','L','L','L','L','L','L',
  'L','L','L','ON','L','L','L','L','L','L','L','L'
]

const arabicTypes: BidiType[] = [
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'CS','AL','ON','ON','NSM','NSM','NSM','NSM','NSM','NSM','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','NSM','NSM','NSM','NSM','NSM','NSM','NSM',
  'NSM','NSM','NSM','NSM','NSM','NSM','NSM','AL','AL','AL','AL',
  'AL','AL','AL','AN','AN','AN','AN','AN','AN','AN','AN','AN',
  'AN','ET','AN','AN','AL','AL','AL','NSM','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','NSM','NSM','NSM','NSM','NSM','NSM','NSM','NSM','NSM','NSM',
  'NSM','NSM','NSM','NSM','NSM','NSM','NSM','NSM','NSM','ON','NSM',
  'NSM','NSM','NSM','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL'
]

function classifyChar(charCode: number): BidiType {
  if (charCode <= 0x00ff) return baseTypes[charCode]!
  if (0x0590 <= charCode && charCode <= 0x05f4) return 'R'
  if (0x0600 <= charCode && charCode <= 0x06ff) return arabicTypes[charCode & 0xff]!
  if (0x0700 <= charCode && charCode <= 0x08AC) return 'AL'
  return 'L'
}

function computeBidiLevels(str: string): Int8Array | null {
  const len = str.length
  if (len === 0) return null

  // eslint-disable-next-line unicorn/no-new-array
  const types: BidiType[] = new Array(len)
  let numBidi = 0

  for (let i = 0; i < len; i++) {
    const t = classifyChar(str.charCodeAt(i))
    if (t === 'R' || t === 'AL' || t === 'AN') numBidi++
    types[i] = t
  }

  if (numBidi === 0) return null

  const startLevel = (len / numBidi) < 0.3 ? 0 : 1
  const levels = new Int8Array(len)
  for (let i = 0; i < len; i++) levels[i] = startLevel

  const e: BidiType = (startLevel & 1) ? 'R' : 'L'
  const sor = e

  // W1-W7
  let lastType: BidiType = sor
  for (let i = 0; i < len; i++) { if (types[i] === 'NSM') types[i] = lastType; else lastType = types[i]! }
  lastType = sor
  for (let i = 0; i < len; i++) { const t = types[i]!; if (t === 'EN') types[i] = lastType === 'AL' ? 'AN' : 'EN'; else if (t === 'R' || t === 'L' || t === 'AL') lastType = t }
  for (let i = 0; i < len; i++) { if (types[i] === 'AL') types[i] = 'R' }
  for (let i = 1; i < len - 1; i++) { if (types[i] === 'ES' && types[i-1] === 'EN' && types[i+1] === 'EN') types[i] = 'EN'; if (types[i] === 'CS' && (types[i-1] === 'EN' || types[i-1] === 'AN') && types[i+1] === types[i-1]) types[i] = types[i-1]! }
  for (let i = 0; i < len; i++) { if (types[i] === 'EN') { let j; for (j = i-1; j >= 0 && types[j] === 'ET'; j--) types[j] = 'EN'; for (j = i+1; j < len && types[j] === 'ET'; j++) types[j] = 'EN' } }
  for (let i = 0; i < len; i++) { const t = types[i]!; if (t === 'WS' || t === 'ES' || t === 'ET' || t === 'CS') types[i] = 'ON' }
  lastType = sor
  for (let i = 0; i < len; i++) { const t = types[i]!; if (t === 'EN') types[i] = lastType === 'L' ? 'L' : 'EN'; else if (t === 'R' || t === 'L') lastType = t }

  // N1-N2
  for (let i = 0; i < len; i++) {
    if (types[i] === 'ON') {
      let end = i + 1
      while (end < len && types[end] === 'ON') end++
      const before: BidiType = i > 0 ? types[i-1]! : sor
      const after: BidiType = end < len ? types[end]! : sor
      const bDir: BidiType = before !== 'L' ? 'R' : 'L'
      const aDir: BidiType = after !== 'L' ? 'R' : 'L'
      if (bDir === aDir) { for (let j = i; j < end; j++) types[j] = bDir }
      i = end - 1
    }
  }
  for (let i = 0; i < len; i++) { if (types[i] === 'ON') types[i] = e }

  // I1-I2
  for (let i = 0; i < len; i++) {
    const t = types[i]!
    if ((levels[i]! & 1) === 0) {
      if (t === 'R') levels[i]!++
      else if (t === 'AN' || t === 'EN') levels[i]! += 2
    } else {
      if (t === 'L' || t === 'AN' || t === 'EN') levels[i]!++
    }
  }

  return levels
}

type MergedSegmentation = {
  len: number
  texts: string[]
  isWordLike: boolean[]
  kinds: SegmentBreakKind[]
  starts: number[]
}

type TextAnalysis = { normalized: string } & MergedSegmentation

export type SegmentBreakKind = 'text' | 'space' | 'glue' | 'zero-width-break'

type SegmentationPiece = {
  text: string
  isWordLike: boolean
  kind: SegmentBreakKind
  start: number
}

function classifySegmentBreakChar(ch: string): SegmentBreakKind {
  if (ch === ' ') return 'space'
  if (ch === '\u00A0' || ch === '\u202F' || ch === '\u2060' || ch === '\uFEFF') {
    return 'glue'
  }
  if (ch === '\u200B') return 'zero-width-break'
  return 'text'
}

function splitSegmentByBreakKind(segment: string, isWordLike: boolean, start: number): SegmentationPiece[] {
  const pieces: SegmentationPiece[] = []
  let currentKind: SegmentBreakKind | null = null
  let currentText = ''
  let currentStart = start
  let currentWordLike = false
  let offset = 0

  for (const ch of segment) {
    const kind = classifySegmentBreakChar(ch)
    const wordLike = kind === 'text' && isWordLike

    if (currentKind !== null && kind === currentKind && wordLike === currentWordLike) {
      currentText += ch
      offset += ch.length
      continue
    }

    if (currentKind !== null) {
      pieces.push({
        text: currentText,
        isWordLike: currentWordLike,
        kind: currentKind,
        start: currentStart,
      })
    }

    currentKind = kind
    currentText = ch
    currentStart = start + offset
    currentWordLike = wordLike
    offset += ch.length
  }

  if (currentKind !== null) {
    pieces.push({
      text: currentText,
      isWordLike: currentWordLike,
      kind: currentKind,
      start: currentStart,
    })
  }

  return pieces
}

function isCollapsibleSpaceKind(kind: SegmentBreakKind): boolean {
  return kind === 'space'
}

function mergeGlueConnectedTextRuns(segmentation: MergedSegmentation): MergedSegmentation {
  const texts: string[] = []
  const isWordLike: boolean[] = []
  const kinds: SegmentBreakKind[] = []
  const starts: number[] = []

  let read = 0
  while (read < segmentation.len) {
    let text = segmentation.texts[read]!
    let wordLike = segmentation.isWordLike[read]!
    let kind = segmentation.kinds[read]!
    let start = segmentation.starts[read]!

    if (kind === 'glue') {
      let glueText = text
      const glueStart = start
      read++
      while (read < segmentation.len && segmentation.kinds[read] === 'glue') {
        glueText += segmentation.texts[read]!
        read++
      }

      if (read < segmentation.len && segmentation.kinds[read] === 'text') {
        text = glueText + segmentation.texts[read]!
        wordLike = segmentation.isWordLike[read]!
        kind = 'text'
        start = glueStart
        read++
      } else {
        texts.push(glueText)
        isWordLike.push(false)
        kinds.push('glue')
        starts.push(glueStart)
        continue
      }
    } else {
      read++
    }

    if (kind === 'text') {
      while (read < segmentation.len && segmentation.kinds[read] === 'glue') {
        let glueText = ''
        while (read < segmentation.len && segmentation.kinds[read] === 'glue') {
          glueText += segmentation.texts[read]!
          read++
        }

        if (read < segmentation.len && segmentation.kinds[read] === 'text') {
          text += glueText + segmentation.texts[read]!
          wordLike = wordLike || segmentation.isWordLike[read]!
          read++
          continue
        }

        text += glueText
      }
    }

    texts.push(text)
    isWordLike.push(wordLike)
    kinds.push(kind)
    starts.push(start)
  }

  return {
    len: texts.length,
    texts,
    isWordLike,
    kinds,
    starts,
  }
}

function buildMergedSegmentation(normalized: string): MergedSegmentation {
  let mergedLen = 0
  const mergedTexts: string[] = []
  const mergedWordLike: boolean[] = []
  const mergedKinds: SegmentBreakKind[] = []
  const mergedStarts: number[] = []

  for (const s of sharedWordSegmenter.segment(normalized)) {
    for (const piece of splitSegmentByBreakKind(s.segment, s.isWordLike ?? false, s.index)) {
      const isText = piece.kind === 'text'

      if (
        engineProfile.carryCJKAfterClosingQuote &&
        isText &&
        mergedLen > 0 &&
        mergedKinds[mergedLen - 1] === 'text' &&
        isCJK(piece.text) &&
        isCJK(mergedTexts[mergedLen - 1]!) &&
        endsWithClosingQuote(mergedTexts[mergedLen - 1]!)
      ) {
        mergedTexts[mergedLen - 1] += piece.text
        mergedWordLike[mergedLen - 1] = mergedWordLike[mergedLen - 1]! || piece.isWordLike
      } else if (
        isText &&
        mergedLen > 0 &&
        mergedKinds[mergedLen - 1] === 'text' &&
        piece.isWordLike &&
        containsArabicScript(piece.text) &&
        endsWithArabicNoSpacePunctuation(mergedTexts[mergedLen - 1]!)
      ) {
        mergedTexts[mergedLen - 1] += piece.text
        mergedWordLike[mergedLen - 1] = true
      } else if (
        isText &&
        !piece.isWordLike &&
        mergedLen > 0 &&
        mergedKinds[mergedLen - 1] === 'text' &&
        piece.text.length === 1 &&
        piece.text !== '-' &&
        piece.text !== '—' &&
        isRepeatedSingleCharRun(mergedTexts[mergedLen - 1]!, piece.text)
      ) {
        mergedTexts[mergedLen - 1] += piece.text
      } else if (
        isText &&
        !piece.isWordLike &&
        mergedLen > 0 &&
        mergedKinds[mergedLen - 1] === 'text' &&
        (
          isLeftStickyPunctuationSegment(piece.text) ||
          (isCJKLineStartProhibitedSegment(piece.text) && isCJK(mergedTexts[mergedLen - 1]!)) ||
          (piece.text === '-' && mergedWordLike[mergedLen - 1]!)
        )
      ) {
        mergedTexts[mergedLen - 1] += piece.text
      } else {
        mergedTexts[mergedLen] = piece.text
        mergedWordLike[mergedLen] = piece.isWordLike
        mergedKinds[mergedLen] = piece.kind
        mergedStarts[mergedLen] = piece.start
        mergedLen++
      }
    }
  }

  for (let i = mergedLen - 2; i >= 0; i--) {
    if (mergedKinds[i] === 'text' && !mergedWordLike[i]! && isForwardStickyClusterSegment(mergedTexts[i]!)) {
      let j = i + 1
      while (j < mergedLen && mergedTexts[j] === '') j++
      if (j < mergedLen && mergedKinds[j] === 'text') {
        mergedTexts[j] = mergedTexts[i]! + mergedTexts[j]!
        mergedStarts[j] = mergedStarts[i]!
        mergedTexts[i] = ''
      }
    }
  }

  let compactLen = 0
  for (let read = 0; read < mergedLen; read++) {
    const text = mergedTexts[read]!
    if (text.length === 0) continue
    if (compactLen !== read) {
      mergedTexts[compactLen] = text
      mergedWordLike[compactLen] = mergedWordLike[read]!
      mergedKinds[compactLen] = mergedKinds[read]!
      mergedStarts[compactLen] = mergedStarts[read]!
    }
    compactLen++
  }

  mergedTexts.length = compactLen
  mergedWordLike.length = compactLen
  mergedKinds.length = compactLen
  mergedStarts.length = compactLen

  const compacted = mergeGlueConnectedTextRuns({
    len: compactLen,
    texts: mergedTexts,
    isWordLike: mergedWordLike,
    kinds: mergedKinds,
    starts: mergedStarts,
  })

  for (let i = 0; i < compacted.len - 1; i++) {
    const split = splitLeadingSpaceAndMarks(compacted.texts[i]!)
    if (split === null) continue
    if (compacted.kinds[i] !== 'space' || compacted.kinds[i + 1] !== 'text' || !containsArabicScript(compacted.texts[i + 1]!)) continue

    compacted.texts[i] = split.space
    compacted.isWordLike[i] = false
    compacted.kinds[i] = 'space'
    compacted.texts[i + 1] = split.marks + compacted.texts[i + 1]!
    compacted.starts[i + 1] = compacted.starts[i]! + split.space.length
  }

  return compacted
}

function computeSegmentLevels(normalized: string, segStarts: number[]): Int8Array | null {
  const bidiLevels = computeBidiLevels(normalized)
  if (bidiLevels === null) return null

  const segLevels = new Int8Array(segStarts.length)
  for (let i = 0; i < segStarts.length; i++) {
    segLevels[i] = bidiLevels[segStarts[i]!]!
  }
  return segLevels
}

// prepare() is split into a pure text-analysis phase and a measurement phase.
function analyzeText(text: string): TextAnalysis {
  const normalized = normalizeWhitespaceNormal(text)
  if (normalized.length === 0) {
    return {
      normalized,
      len: 0,
      texts: [],
      isWordLike: [],
      kinds: [],
      starts: [],
    }
  }
  return { normalized, ...buildMergedSegmentation(normalized) }
}

// --- Public types ---

export type PreparedText = {
  widths: number[] // Segment widths, e.g. [42.5, 4.4, 37.2]
  kinds: SegmentBreakKind[] // Break behavior per segment, e.g. ['text', 'space', 'text']
  segLevels: Int8Array | null // Bidi embedding level per segment, or null for pure LTR text
  breakableWidths: (number[] | null)[] // Grapheme widths for overflow-wrap segments, else null
}

export type PreparedTextWithSegments = PreparedText & {
  segments: string[] // Segment text aligned with the parallel arrays, e.g. ['hello', ' ', 'world']
}

export type LayoutCursor = {
  segmentIndex: number // Segment index in `segments`
  graphemeIndex: number // Grapheme index within that segment; `0` at segment boundaries
}

export type LayoutResult = {
  lineCount: number // Number of wrapped lines, e.g. 3
  height: number // Total block height, e.g. lineCount * lineHeight = 57
}

export type LayoutLine = {
  text: string // Full text content of this line, e.g. 'hello world'
  width: number // Measured width of this line, e.g. 87.5
  start: LayoutCursor // Inclusive start cursor in prepared segments/graphemes
  end: LayoutCursor // Exclusive end cursor in prepared segments/graphemes
}

export type LayoutLinesResult = LayoutResult & {
  lines: LayoutLine[] // Per-line text/width pairs for custom rendering
}

// --- Public API ---

function createEmptyPrepared(includeSegments: boolean): PreparedText | PreparedTextWithSegments {
  if (includeSegments) {
    return { widths: [], kinds: [], segLevels: null, breakableWidths: [], segments: [] }
  }
  return { widths: [], kinds: [], segLevels: null, breakableWidths: [] }
}

function measureAnalysis(
  analysis: TextAnalysis,
  font: string,
  includeSegments: boolean,
): PreparedText | PreparedTextWithSegments {
  ctx.font = font
  const cache = getWordCache(font)
  const fontSize = parseFontSize(font)
  const emojiCorrection = getEmojiCorrection(font, fontSize)

  if (analysis.len === 0) return createEmptyPrepared(includeSegments)

  const widths: number[] = []
  const kinds: SegmentBreakKind[] = []
  const segStarts: number[] = []
  const breakableWidths: (number[] | null)[] = []
  const segments = includeSegments ? [] as string[] : null

  function pushMeasuredSegment(
    text: string,
    width: number,
    kind: SegmentBreakKind,
    start: number,
    breakable: number[] | null,
  ): void {
    widths.push(width)
    kinds.push(kind)
    segStarts.push(start)
    breakableWidths.push(breakable)
    if (segments !== null) segments.push(text)
  }

  for (let mi = 0; mi < analysis.len; mi++) {
    const segText = analysis.texts[mi]!
    const segWordLike = analysis.isWordLike[mi]!
    const segKind = analysis.kinds[mi]!
    const segStart = analysis.starts[mi]!

    if (segKind === 'text' && isCJK(segText)) {
      let unitText = ''
      let unitStart = 0

      for (const gs of sharedGraphemeSegmenter.segment(segText)) {
        const grapheme = gs.segment

        if (unitText.length === 0) {
          unitText = grapheme
          unitStart = gs.index
          continue
        }

        if (
          kinsokuEnd.has(unitText) ||
          kinsokuStart.has(grapheme) ||
          leftStickyPunctuation.has(grapheme) ||
          (engineProfile.carryCJKAfterClosingQuote &&
            isCJK(grapheme) &&
            endsWithClosingQuote(unitText))
        ) {
          unitText += grapheme
          continue
        }

        let w = measureSegment(unitText, cache)
        if (emojiCorrection > 0 && isEmojiGrapheme(unitText)) {
          w -= emojiCorrection
        }
        pushMeasuredSegment(unitText, w, 'text', segStart + unitStart, null)

        unitText = grapheme
        unitStart = gs.index
      }

      if (unitText.length > 0) {
        let w = measureSegment(unitText, cache)
        if (emojiCorrection > 0 && isEmojiGrapheme(unitText)) {
          w -= emojiCorrection
        }
        pushMeasuredSegment(unitText, w, 'text', segStart + unitStart, null)
      }
      continue
    }

    let w = measureSegment(segText, cache)
    if (emojiCorrection > 0 && emojiPresentationRe.test(segText)) {
      w -= countEmojiGraphemes(segText) * emojiCorrection
    }

    if (segWordLike && segText.length > 1) {
      let gCount = 0
      let gWidths: number[] | null = null
      for (const gs of sharedGraphemeSegmenter.segment(segText)) {
        if (gCount === 0) gWidths = []
        let gw = measureSegment(gs.segment, cache)
        if (emojiCorrection > 0 && isEmojiGrapheme(gs.segment)) {
          gw -= emojiCorrection
        }
        gWidths![gCount] = gw
        gCount++
      }
      pushMeasuredSegment(segText, w, segKind, segStart, gCount > 1 ? gWidths : null)
    } else {
      pushMeasuredSegment(segText, w, segKind, segStart, null)
    }
  }

  const segLevels = computeSegmentLevels(analysis.normalized, segStarts)
  if (segments !== null) {
    return { widths, kinds, segLevels, breakableWidths, segments }
  }
  return { widths, kinds, segLevels, breakableWidths }
}

function prepareInternal(text: string, font: string, includeSegments: boolean): PreparedText | PreparedTextWithSegments {
  const analysis = analyzeText(text)
  return measureAnalysis(analysis, font, includeSegments)
}

// Prepare text for layout. Segments the text, measures each segment via canvas,
// and stores the widths for fast relayout at any width. Call once per text block
// (e.g. when a comment first appears). The result is width-independent — the
// same PreparedText can be laid out at any maxWidth and lineHeight via layout().
//
// Steps:
//   1. Normalize collapsible whitespace (CSS white-space: normal behavior)
//   2. Segment via Intl.Segmenter (handles CJK, Thai, etc.)
//   3. Merge punctuation into preceding word ("better." as one unit)
//   4. Split CJK words into individual graphemes (per-character line breaks)
//   5. Measure each segment via canvas measureText, cache by (segment, font)
//   6. Pre-measure graphemes of long words (for overflow-wrap: break-word)
//   7. Correct emoji canvas inflation (auto-detected per font size)
//   8. Compute bidi embedding levels for mixed-direction text
export function prepare(text: string, font: string): PreparedText {
  return prepareInternal(text, font, false) as PreparedText
}

// Rich variant used by callers that need enough information to render the
// laid-out lines themselves.
export function prepareWithSegments(text: string, font: string): PreparedTextWithSegments {
  return prepareInternal(text, font, true) as PreparedTextWithSegments
}

type InternalLayoutLine = {
  startSegmentIndex: number
  startGraphemeIndex: number
  endSegmentIndex: number
  endGraphemeIndex: number
  width: number
}

function countPreparedLines(prepared: PreparedText, maxWidth: number): number {
  const { widths, kinds, breakableWidths } = prepared
  if (widths.length === 0) return 0

  let lineCount = 0
  let lineW = 0
  let hasContent = false

  for (let i = 0; i < widths.length; i++) {
    const w = widths[i]!

    if (!hasContent) {
      if (w > maxWidth && breakableWidths[i] !== null) {
        const gWidths = breakableWidths[i]!
        lineW = 0
        for (let g = 0; g < gWidths.length; g++) {
          const gw = gWidths[g]!
          if (lineW > 0 && lineW + gw > maxWidth + lineFitEpsilon) {
            lineCount++
            lineW = gw
          } else {
            if (lineW === 0) lineCount++
            lineW += gw
          }
        }
      } else {
        lineW = w
        lineCount++
      }
      hasContent = true
      continue
    }

    const newW = lineW + w

    if (newW > maxWidth + lineFitEpsilon) {
      if (isCollapsibleSpaceKind(kinds[i]!)) continue

      if (w > maxWidth && breakableWidths[i] !== null) {
        const gWidths = breakableWidths[i]!
        lineW = 0
        for (let g = 0; g < gWidths.length; g++) {
          const gw = gWidths[g]!
          if (lineW > 0 && lineW + gw > maxWidth + lineFitEpsilon) {
            lineCount++
            lineW = gw
          } else {
            if (lineW === 0) lineCount++
            lineW += gw
          }
        }
      } else {
        lineCount++
        lineW = w
      }
    } else {
      lineW = newW
    }
  }

  if (!hasContent) {
    lineCount++
  }

  return lineCount
}

function walkPreparedLines(
  prepared: PreparedText,
  maxWidth: number,
  onLine?: (line: InternalLayoutLine) => void,
): number {
  const { widths, kinds, breakableWidths } = prepared
  if (widths.length === 0) return 0

  let lineCount = 0
  let lineW = 0
  let hasContent = false
  let lineStartSegmentIndex = 0
  let lineStartGraphemeIndex = 0
  let lineEndSegmentIndex = 0
  let lineEndGraphemeIndex = 0

  function emitCurrentLine(): void {
    lineCount++
    onLine?.({
      startSegmentIndex: lineStartSegmentIndex,
      startGraphemeIndex: lineStartGraphemeIndex,
      endSegmentIndex: lineEndSegmentIndex,
      endGraphemeIndex: lineEndGraphemeIndex,
      width: lineW,
    })
    lineW = 0
    hasContent = false
  }

  function startLineAtSegment(segmentIndex: number, width: number): void {
    hasContent = true
    lineStartSegmentIndex = segmentIndex
    lineStartGraphemeIndex = 0
    lineEndSegmentIndex = segmentIndex + 1
    lineEndGraphemeIndex = 0
    lineW = width
  }

  function startLineAtGrapheme(segmentIndex: number, graphemeIndex: number, width: number): void {
    hasContent = true
    lineStartSegmentIndex = segmentIndex
    lineStartGraphemeIndex = graphemeIndex
    lineEndSegmentIndex = segmentIndex
    lineEndGraphemeIndex = graphemeIndex + 1
    lineW = width
  }

  function appendWholeSegment(segmentIndex: number, width: number): void {
    if (!hasContent) {
      startLineAtSegment(segmentIndex, width)
      return
    }
    lineW += width
    lineEndSegmentIndex = segmentIndex + 1
    lineEndGraphemeIndex = 0
  }

  function appendBreakableSegment(segmentIndex: number): void {
    const gWidths = breakableWidths[segmentIndex]!
    for (let g = 0; g < gWidths.length; g++) {
      const gw = gWidths[g]!

      if (!hasContent) {
        startLineAtGrapheme(segmentIndex, g, gw)
        continue
      }

      if (lineW + gw > maxWidth + lineFitEpsilon) {
        emitCurrentLine()
        startLineAtGrapheme(segmentIndex, g, gw)
      } else {
        lineW += gw
        lineEndSegmentIndex = segmentIndex
        lineEndGraphemeIndex = g + 1
      }
    }

    if (hasContent && lineEndSegmentIndex === segmentIndex && lineEndGraphemeIndex === gWidths.length) {
      lineEndSegmentIndex = segmentIndex + 1
      lineEndGraphemeIndex = 0
    }
  }

  for (let i = 0; i < widths.length; i++) {
    const w = widths[i]!

    if (!hasContent) {
      if (w > maxWidth && breakableWidths[i] !== null) {
        appendBreakableSegment(i)
      } else {
        startLineAtSegment(i, w)
      }
      continue
    }

    const newW = lineW + w

    if (newW > maxWidth + lineFitEpsilon) {
      if (isCollapsibleSpaceKind(kinds[i]!)) continue

      if (w > maxWidth && breakableWidths[i] !== null) {
        emitCurrentLine()
        appendBreakableSegment(i)
      } else {
        emitCurrentLine()
        startLineAtSegment(i, w)
      }
    } else {
      appendWholeSegment(i, w)
    }
  }

  if (hasContent) {
    emitCurrentLine()
  }

  return lineCount
}

// Layout prepared text at a given max width and caller-provided lineHeight.
// Pure arithmetic on cached widths — no canvas calls, no DOM reads, no string
// operations, no allocations.
// ~0.0002ms per text block. Call on every resize.
//
// Line breaking rules (matching CSS white-space: normal + overflow-wrap: break-word):
//   - Break before any non-space segment that would overflow the line
//   - Trailing whitespace hangs past the line edge (doesn't trigger breaks)
//   - Segments wider than maxWidth are broken at grapheme boundaries
export function layout(prepared: PreparedText, maxWidth: number, lineHeight: number): LayoutResult {
  // Keep the resize hot path specialized. `layoutWithLines()` shares the same
  // break semantics but also tracks line ranges; the extra bookkeeping is too
  // expensive to pay on every hot-path `layout()` call.
  const lineCount = countPreparedLines(prepared, maxWidth)
  return { lineCount, height: lineCount * lineHeight }
}

function getSegmentGraphemes(
  segmentIndex: number,
  segments: string[],
  cache: Map<number, string[]>,
): string[] {
  let graphemes = cache.get(segmentIndex)
  if (graphemes !== undefined) return graphemes

  graphemes = []
  for (const gs of sharedGraphemeSegmenter.segment(segments[segmentIndex]!)) {
    graphemes.push(gs.segment)
  }
  cache.set(segmentIndex, graphemes)
  return graphemes
}

function buildLineTextFromRange(
  segments: string[],
  cache: Map<number, string[]>,
  startSegmentIndex: number,
  startGraphemeIndex: number,
  endSegmentIndex: number,
  endGraphemeIndex: number,
): string {
  let text = ''

  for (let i = startSegmentIndex; i < endSegmentIndex; i++) {
    if (i === startSegmentIndex && startGraphemeIndex > 0) {
      text += getSegmentGraphemes(i, segments, cache).slice(startGraphemeIndex).join('')
    } else {
      text += segments[i]!
    }
  }

  if (endGraphemeIndex > 0) {
    text += getSegmentGraphemes(endSegmentIndex, segments, cache).slice(
      startSegmentIndex === endSegmentIndex ? startGraphemeIndex : 0,
      endGraphemeIndex,
    ).join('')
  }

  return text
}

// Rich layout API for callers that want the actual line contents and widths.
// Caller still supplies lineHeight at layout time. Mirrors layout()'s break
// decisions, but keeps extra per-line bookkeeping so it should stay off the
// resize hot path.
export function layoutWithLines(prepared: PreparedTextWithSegments, maxWidth: number, lineHeight: number): LayoutLinesResult {
  const lines: LayoutLine[] = []
  if (prepared.widths.length === 0) return { lineCount: 0, height: 0, lines }

  const graphemeCache = new Map<number, string[]>()
  const lineCount = walkPreparedLines(prepared, maxWidth, line => {
    lines.push({
      text: buildLineTextFromRange(
        prepared.segments,
        graphemeCache,
        line.startSegmentIndex,
        line.startGraphemeIndex,
        line.endSegmentIndex,
        line.endGraphemeIndex,
      ),
      width: line.width,
      start: {
        segmentIndex: line.startSegmentIndex,
        graphemeIndex: line.startGraphemeIndex,
      },
      end: {
        segmentIndex: line.endSegmentIndex,
        graphemeIndex: line.endGraphemeIndex,
      },
    })
  })

  return { lineCount, height: lineCount * lineHeight, lines }
}

export function clearCache(): void {
  wordCaches.clear()
  emojiCorrectionCache.clear()
}
