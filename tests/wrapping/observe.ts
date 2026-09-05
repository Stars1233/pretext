import { normalizeSource, type Prediction, type PredictionLine } from './contracts.ts'
import type {
  Assessment, BrowserKind, MetricResult, NativeObservation, NativePoint, NativeRect, WrappingCase,
} from './types.ts'

const RECT_EPSILON = 0.00001
const HEIGHT_TOLERANCE = 0.02
const WIDTH_TOLERANCE = 0.05
const ASCII_SPACE = /^[ \t\n\r\f]+$/
const INVISIBLE = /^[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Control}]+$/u
const WHITE_SPACE = /^\p{White_Space}+$/u
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

// The compact mode oracles deliberately use both extraction methods. Span
// boundaries are an intervention, so keep this observation separate from the
// unmodified paragraph's height and scalar rectangles. Units come from source
// graphemes, never a candidate's private prepared representation.
function extractNativeLines(element: HTMLElement, input: WrappingCase): NonNullable<NativeObservation['extractedLines']> {
  const text = normalizeSource(input.text, input.whiteSpace)
  const units = Array.from(graphemeSegmenter.segment(text))
  const lines: NonNullable<NativeObservation['extractedLines']> = []
  element.textContent = text
  const tops: Array<number | null> = []
  switch (input.lineMethod) {
    case 'span': {
      const spans = units.map(unit => {
        const span = document.createElement('span')
        span.textContent = unit.segment
        return span
      })
      element.replaceChildren(...spans)
      for (const span of spans) {
        const rect = span.getBoundingClientRect()
        tops.push(rect.width > 0 || rect.height > 0 ? rect.top : null)
      }
      break
    }
    case 'range': {
      const node = element.firstChild
      if (node === null) return lines
      const range = document.createRange()
      for (const unit of units) {
        range.setStart(node, unit.index)
        range.setEnd(node, unit.index + unit.segment.length)
        const rects = range.getClientRects()
        tops.push(rects.length === 0 ? null : rects[0]!.top)
      }
      break
    }
    case undefined: throw new Error('A line extraction method is required.')
  }
  let start = 0
  let end = 0
  let lastTop: number | null = null
  const push = (): void => {
    if (end > start) lines.push({ start, end: start + text.slice(start, end).trimEnd().length })
  }
  for (let index = 0; index < units.length; index++) {
    const unit = units[index]!
    const top: number | null = tops[index] ?? lastTop
    if (top !== null && lastTop !== null && top > lastTop + 0.5) {
      push()
      start = unit.index
    }
    end = unit.index + unit.segment.length
    if (top !== null) lastTop = top
  }
  push()
  return lines
}

// One unmodified text node is the oracle. Wrapping every letter in a span
// changes contextual shaping and dictionary breaks in the text under test.
export function observeNative(input: WrappingCase): NativeObservation {
  const text = input.nativeSource === 'normalized' ? normalizeSource(input.text, input.whiteSpace) : input.text
  const element = document.createElement('div')
  Object.assign(element.style, {
    position: 'absolute', left: '0', top: '0', margin: '0', padding: '0', border: '0',
    font: input.font, lineHeight: `${input.lineHeight}px`, width: `${input.width}px`,
    letterSpacing: `${input.letterSpacing}px`, whiteSpace: input.whiteSpace,
    wordBreak: input.wordBreak, overflowWrap: 'break-word', lineBreak: 'auto',
    direction: input.direction, tabSize: '8',
    hyphens: 'manual',
  })
  if (input.lang !== undefined) element.lang = input.lang
  const node = document.createTextNode(text)
  element.append(node)
  document.body.append(element)
  try {
    const origin = element.getBoundingClientRect()
    const points: NativePoint[] = []
    const lineRects: NativeRect[] = []
    if (input.detail !== 'height') {
      const range = document.createRange()
      const relative = (rect: DOMRect): NativeRect => ({
        x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height,
      })
      let start = 0
      for (const scalar of text) {
        const end = start + scalar.length
        range.setStart(node, start)
        range.setEnd(node, end)
        points.push({ start, end, text: scalar, rects: Array.from(range.getClientRects(), relative) })
        start = end
      }
      range.selectNodeContents(node)
      lineRects.push(...Array.from(range.getClientRects(), relative))
    }
    let richHeight: number | undefined
    if (input.nativeItems === true) {
      if (input.parts === undefined || input.parts.join('') !== text || input.whiteSpace !== 'normal' || input.wordBreak !== 'normal') {
        throw new Error('Native inline-item height requires matching source parts in normal whitespace and word-break modes.')
      }
      element.replaceChildren(...input.parts.map(part => {
        const span = document.createElement('span')
        span.textContent = part
        return span
      }))
      richHeight = element.getBoundingClientRect().height
    }
    const extractedLines = input.lineMethod === undefined ? undefined : extractNativeLines(element, input)
    let usedLineHeight = input.lineHeight
    if (!Number.isInteger(input.lineHeight)) {
      // Safari can use integral line boxes despite retaining a fractional
      // computed CSS line-height. Observe the strut independently of wrapping.
      element.style.whiteSpace = 'pre'
      element.style.width = 'max-content'
      element.textContent = 'x\nx'
      usedLineHeight = element.getBoundingClientRect().height / 2
    }
    const count = origin.height / usedLineHeight
    return {
      height: origin.height, lineCount: Math.abs(count - Math.round(count)) < 0.000001 ? Math.round(count) : count, points, lineRects,
      ...(usedLineHeight === input.lineHeight ? {} : { usedLineHeight }),
      ...(extractedLines === undefined ? {} : { extractedLines }),
      ...(richHeight === undefined ? {} : { richHeight }),
    }
  } finally {
    element.remove()
  }
}

type SourceSpan = { rawStart: number; rawEnd: number; start: number; end: number }

// Map the documented whitespace transformation, not a candidate's private
// segmentation. Every observed raw scalar retains its normalized source view.
function sourceSpans(input: WrappingCase): SourceSpan[] {
  const spans: SourceSpan[] = []
  let normalizedOffset = 0
  for (let rawStart = 0; rawStart < input.text.length;) {
    const char = input.text[rawStart]!
    let rawEnd = rawStart + 1
    if (input.whiteSpace === 'normal' && ASCII_SPACE.test(char)) {
      for (; rawEnd < input.text.length && ASCII_SPACE.test(input.text[rawEnd]!); rawEnd++) { /* whitespace run */ }
      if (rawStart !== 0 && rawEnd !== input.text.length) {
        spans.push({ rawStart, rawEnd, start: normalizedOffset, end: normalizedOffset + 1 })
        normalizedOffset++
      }
    } else {
      if (input.whiteSpace === 'pre-wrap' && char === '\r' && input.text[rawEnd] === '\n') rawEnd++
      spans.push({ rawStart, rawEnd, start: normalizedOffset, end: normalizedOffset + 1 })
      normalizedOffset++
    }
    rawStart = rawEnd
  }
  return spans
}

function rectLine(rect: NativeRect, input: WrappingCase, native: NativeObservation): number | null {
  const line = Math.floor((rect.y + rect.height / 2) / (native.usedLineHeight ?? input.lineHeight))
  return line >= 0 && line < Math.round(native.lineCount) ? line : null
}

function pointLine(point: NativePoint, input: WrappingCase, native: NativeObservation): number | null {
  let line: number | null = null
  for (const rect of point.rects) {
    if (rect.width <= RECT_EPSILON || rect.height <= RECT_EPSILON) continue
    const next = rectLine(rect, input, native)
    if (next === null || (line !== null && line !== next)) return null
    line = next
  }
  return line
}

function compareSource(
  input: WrappingCase, native: NativeObservation, lines: PredictionLine[], spans: SourceSpan[], whitespace: boolean,
): MetricResult {
  let applicable = 0
  let observed = 0
  let ambiguous = 0
  let spanIndex = 0
  for (const point of native.points) {
    if (whitespace ? !WHITE_SPACE.test(point.text) : INVISIBLE.test(point.text)) continue
    // Collapsed ASCII whitespace has no unique raw ownership. Pre-wrap hard
    // breaks also do not paint a width-bearing source rectangle.
    if (whitespace && (input.whiteSpace === 'normal' && ASCII_SPACE.test(point.text) || /[\r\n\f]/.test(point.text))) continue
    applicable++
    const expected = pointLine(point, input, native)
    if (expected === null) { ambiguous++; continue }
    for (; spanIndex < spans.length && spans[spanIndex]!.rawEnd <= point.start; spanIndex++) { /* monotonic source view */ }
    const start = spans[spanIndex]
    let endIndex = spanIndex
    for (; endIndex < spans.length && spans[endIndex]!.rawEnd < point.end; endIndex++) { /* astral scalar */ }
    const end = spans[endIndex]
    if (start === undefined || end === undefined || start.rawStart > point.start || end.rawEnd < point.end) {
      return { status: 'fail', detail: `No normalized source view for raw [${point.start}, ${point.end}).` }
    }
    const actual = lines.findIndex(line => line.sourceStart <= start.start && line.sourceEnd >= end.end)
    if (actual !== expected) {
      return { status: 'fail', detail: `Raw [${point.start}, ${point.end}) ${JSON.stringify(point.text)} belongs to line ${expected}; prediction assigns ${actual}.` }
    }
    observed++
  }
  if (applicable === 0) return { status: 'not-applicable', reason: whitespace ? 'No preserved width-bearing whitespace.' : 'No visible source scalars.' }
  if (ambiguous > 0) return { status: 'unobserved', reason: `${observed}/${applicable} source scalars agree; ${ambiguous} have zero or ambiguous native rectangles.` }
  return { status: 'pass' }
}

function compareWidths(input: WrappingCase, native: NativeObservation, lines: PredictionLine[]): MetricResult {
  if (lines.some(line => !Number.isFinite(line.width))) return { status: 'fail', detail: 'Predicted line width is not finite.' }
  if (input.text.length === 0) return { status: 'not-applicable', reason: 'Empty text has no inline width.' }
  // A DOM rectangle encloses overlaps and hanging whitespace. It is not a
  // general advance-width oracle for those layouts or a glyph ink extractor.
  if (input.discretionary === undefined && (input.letterSpacing < 0 || input.whiteSpace === 'pre-wrap' || /\u00ad|\u200b|\u200c|\u200d|\u2060|\ufeff/u.test(input.text))) {
    return { status: 'unobserved', reason: 'Range extents do not independently determine advances with overlap, preserved whitespace, or shaping controls.' }
  }
  // The eight maintained discretionary cases have separately verified whole-
  // line Range geometry, including terminal SHY and signed spacing. Their
  // original tighter tolerance is part of that explicit observation protocol.
  const tolerance = input.discretionary === undefined ? WIDTH_TOLERANCE : 0.025
  const bounds: Array<{ left: number; right: number } | undefined> = Array.from({ length: Math.round(native.lineCount) })
  for (const rect of native.lineRects) {
    if (rect.width <= RECT_EPSILON || rect.height <= RECT_EPSILON) continue
    const index = rectLine(rect, input, native)
    if (index === null) return { status: 'unobserved', reason: 'A native line rectangle lies outside the block line grid.' }
    const previous = bounds[index]
    bounds[index] = previous === undefined
      ? { left: rect.x, right: rect.x + rect.width }
      : { left: Math.min(previous.left, rect.x), right: Math.max(previous.right, rect.x + rect.width) }
  }
  if (bounds.some(bound => bound === undefined)) return { status: 'unobserved', reason: 'Native Range did not expose every line width.' }
  if (lines.length !== bounds.length) return { status: 'fail', detail: `Cannot match ${lines.length} predicted line widths to ${bounds.length} native lines.` }
  for (let i = 0; i < bounds.length; i++) {
    const bound = bounds[i]!
    const expected = bound.right - bound.left
    if (Math.abs(lines[i]!.width - expected) > tolerance) {
      return { status: 'fail', detail: `Line ${i} width ${lines[i]!.width} differs from native Range extent ${expected}.` }
    }
  }
  return { status: 'pass' }
}

function compareHyphens(input: WrappingCase, native: NativeObservation, lines: PredictionLine[]): MetricResult {
  if (input.discretionary !== undefined) {
    const expected = input.discretionary.expectedText
    const actual = lines.map(line => line.text)
    return actual.length === expected.length && actual.every((text, index) => text === expected[index])
      ? { status: 'pass' }
      : { status: 'fail', detail: `Discretionary line text ${JSON.stringify(actual)} differs from the maintained contract ${JSON.stringify(expected)}.` }
  }
  if (!input.text.includes('\u00ad')) return { status: 'not-applicable', reason: 'No soft hyphen.' }
  // This is the deliberately restricted oracle from the retained paint audit.
  // Safari can expose a positive SHY Range even when no hyphen was selected.
  // Arbitrary joining/control contexts need a separate observation method.
  if (input.text !== 'a\u00adb' || input.letterSpacing < 0) {
    return { status: 'unobserved', reason: 'SHY selection oracle is verified only for a SHY b with nonnegative spacing; raw rectangles remain available.' }
  }
  const a = native.points.find(point => point.text === 'a')!
  const b = native.points.find(point => point.text === 'b')!
  const shy = native.points.find(point => point.text === '\u00ad')!
  const aLine = pointLine(a, input, native)
  const bLine = pointLine(b, input, native)
  if (aLine === null || bLine === null) return { status: 'unobserved', reason: 'The SHY control letters have ambiguous native rectangles.' }
  const nativeLines: number[] = []
  if (aLine !== bLine) {
    for (const rect of shy.rects) {
      if (rect.width <= RECT_EPSILON || rect.height <= RECT_EPSILON) continue
      const line = rectLine(rect, input, native)
      if (line === null) return { status: 'unobserved', reason: 'Selected SHY rectangle is outside the native line grid.' }
      const whole = native.lineRects.filter(other => rectLine(other, input, native) === line)
      const contained = whole.some(other => other.x <= rect.x + WIDTH_TOLERANCE && other.x + other.width >= rect.x + rect.width - WIDTH_TOLERANCE)
      if (!contained) return { status: 'unobserved', reason: 'Positive SHY rectangle is not corroborated by the full native line extent.' }
      const letterRects = [...a.rects, ...b.rects].filter(other => other.width > RECT_EPSILON && rectLine(other, input, native) === line)
      if (letterRects.some(other => other.x <= rect.x + WIDTH_TOLERANCE && other.x + other.width >= rect.x + rect.width - WIDTH_TOLERANCE)) {
        return { status: 'unobserved', reason: 'Positive SHY rectangle adds no extent beyond ordinary-letter geometry; selection cannot be inferred.' }
      }
      if (!nativeLines.includes(line)) nativeLines.push(line)
    }
    // A missing SHY rectangle is only decisive if whole-line geometry contains
    // no unexplained advance. Otherwise zero-width extraction is inconclusive.
    if (nativeLines.length === 0) {
      for (const whole of native.lineRects) {
        if (whole.width <= RECT_EPSILON) continue
        const line = rectLine(whole, input, native)
        const letters = [...a.rects, ...b.rects].filter(rect => rect.width > RECT_EPSILON && rectLine(rect, input, native) === line)
        if (!letters.some(rect => Math.abs(rect.x - whole.x) <= WIDTH_TOLERANCE && Math.abs(rect.width - whole.width) <= WIDTH_TOLERANCE)) {
          return { status: 'unobserved', reason: 'Whole-line advance is unexplained by visible letters, but SHY geometry is absent.' }
        }
      }
    }
  }
  const predictedLines: number[] = []
  for (let i = 0; i < lines.length; i++) {
    for (const char of lines[i]!.text) if (char === '-' || char === '\u2010') predictedLines.push(i)
  }
  if (nativeLines.length !== predictedLines.length || nativeLines.some((line, i) => line !== predictedLines[i])) {
    return { status: 'fail', detail: `Selected hyphens occur on native lines [${nativeLines.join(', ')}], predicted [${predictedLines.join(', ')}]. This checks selection location, not glyph shape.` }
  }
  return { status: 'pass' }
}

export function predictionGeometry(input: WrappingCase, prediction: Prediction): { height: number; lineCount: number } {
  let height = prediction.height
  if (prediction.detail === 'full') {
    switch (input.heightSource) {
      case 'layout': height = prediction.countedHeight; break
      case 'lines': height = prediction.lines.length * input.lineHeight; break
      case undefined: break
    }
  }
  const lineCount = prediction.detail === 'full' && (input.lineMethod !== undefined || input.heightSource === 'lines')
    ? prediction.lines.length : prediction.lineCount
  return { height, lineCount }
}

export function assess(
  input: WrappingCase, native: NativeObservation, prediction: Prediction, browser: BrowserKind,
): Assessment {
  const { height: predictedHeight, lineCount: predictedLineCount } = predictionGeometry(input, prediction)
  const usedLineHeight = native.usedLineHeight ?? input.lineHeight
  const nativeScaleHeight = predictedHeight / input.lineHeight * usedLineHeight
  const difference = nativeScaleHeight - native.height
  let heightMatches = Math.abs(difference) <= HEIGHT_TOLERANCE
  switch (input.heightMode) {
    case 'exact': heightMatches = difference === 0; break
    case 'accuracy': heightMatches = Math.abs(difference) < 1; break
    case 'corpus': heightMatches = Math.round(difference) === 0; break
    case undefined: break
  }
  const height: MetricResult = heightMatches
    ? { status: 'pass' }
    : { status: 'fail', detail: `Predicted height ${predictedHeight}; native ${native.height}.${usedLineHeight === input.lineHeight ? '' : ` Native line boxes use ${usedLineHeight}px; equivalent predicted height ${nativeScaleHeight}.`}` }
  const expectedLineCount = native.extractedLines?.length ?? native.lineCount
  const lineCount: MetricResult = input.lineMethod !== undefined && native.extractedLines === undefined
    ? { status: 'unobserved', reason: `The selected ${input.lineMethod} line extraction is absent.` }
    : predictedLineCount === expectedLineCount
      ? { status: 'pass' }
      : { status: 'fail', detail: `Predicted ${predictedLineCount} lines; native ${input.lineMethod ?? 'block'} observation has ${expectedLineCount}.` }
  const unextracted: MetricResult = { status: 'unobserved', reason: 'No source line-boundary extraction was selected.' }
  let richHeight: MetricResult = { status: 'not-applicable', reason: 'No native inline-item protocol was selected.' }
  if (input.nativeItems === true) {
    richHeight = native.richHeight === undefined || prediction.detail !== 'full' || prediction.richLineCount === undefined
      ? { status: 'unobserved', reason: 'Native inline-item height or completed rich prediction is absent.' }
      : Math.abs(prediction.richLineCount * usedLineHeight - native.richHeight) <= HEIGHT_TOLERANCE
        ? { status: 'pass' }
        : { status: 'fail', detail: `Rich prediction has ${prediction.richLineCount} lines; native inline-item height is ${native.richHeight}.` }
  }
  if (prediction.detail === 'height') {
    const unobserved: MetricResult = { status: 'unobserved', reason: 'This maintained case is scheduled for height observation only.' }
    return { height, lineCount, breaks: unextracted, source: unobserved, whitespace: unobserved, widths: unobserved, hyphen: input.text.includes('\u00ad') ? unobserved : { status: 'not-applicable', reason: 'No soft hyphen.' }, api: unobserved, richHeight }
  }
  const observedInput = input.nativeSource === 'normalized' ? { ...input, text: normalizeSource(input.text, input.whiteSpace) } : input
  const spans = sourceSpans(observedInput)
  const normalizationCorrect = normalizeSource(input.text, input.whiteSpace) === prediction.normalized
  const source = normalizationCorrect
    ? compareSource(observedInput, native, prediction.lines, spans, false)
    : { status: 'fail' as const, detail: 'Prepared segments do not preserve the documented normalized source.' }
  // Safari can give an incorrect line for hanging pre-wrap spaces. Keep the
  // raw rectangles, but do not promote this known extractor limitation to a
  // product failure (or silently call it a pass).
  const whitespace = browser === 'safari' && input.whiteSpace === 'pre-wrap' && /[ \t]/.test(input.text)
    ? { status: 'unobserved' as const, reason: 'Safari pre-wrap whitespace Range ownership requires an independent span cross-check.' }
    : compareSource(observedInput, native, prediction.lines, spans, true)
  let breaks: MetricResult = unextracted
  if (native.extractedLines !== undefined) {
    breaks = { status: 'pass' }
    for (let index = 0; index < Math.max(prediction.lines.length, native.extractedLines.length); index++) {
      const actual = prediction.lines[index]
      const expected = native.extractedLines[index]
      const end = actual === undefined ? -1 : actual.sourceStart + prediction.normalized.slice(actual.sourceStart, actual.sourceEnd).trimEnd().length
      if (actual === undefined || expected === undefined || actual.sourceStart !== expected.start || end !== expected.end) {
        breaks = { status: 'fail', detail: `Line ${index}: predicted source [${actual?.sourceStart ?? -1}, ${end}), native ${input.lineMethod} [${expected?.start ?? -1}, ${expected?.end ?? -1}).` }
        break
      }
    }
  }
  return {
    height, lineCount, breaks, source, whitespace, richHeight,
    widths: compareWidths(input, native, prediction.lines),
    hyphen: compareHyphens(input, native, prediction.lines),
    api: prediction.contracts.length === 0 ? { status: 'pass' } : { status: 'fail', detail: prediction.contracts.map(failure => `${failure.contract}: ${failure.detail}`).join('; ') },
  }
}
