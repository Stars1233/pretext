import {
  layout,
  prepareWithSegments,
  type PreparedTextWithSegments,
} from '../src/layout.ts'

type ProbeLine = {
  text: string
  renderedText: string
  contentText: string
  start: number
  end: number
  contentEnd: number
  fullWidth: number
  domWidth: number
  sumWidth?: number
}

type ProbeBreakMismatch = {
  line: number
  oursStart: number
  browserStart: number
  oursEnd: number
  browserEnd: number
  oursText: string
  browserText: string
  oursRenderedText: string
  browserRenderedText: string
  oursContext: string
  browserContext: string
  deltaText: string
  reasonGuess: string
  oursSumWidth: number
  oursDomWidth: number
  oursFullWidth: number
  browserDomWidth: number
  browserFullWidth: number
}

type ProbeReport = {
  status: 'ready' | 'error'
  requestId?: string
  text?: string
  width?: number
  contentWidth?: number
  font?: string
  lineHeight?: number
  direction?: string
  predictedHeight?: number
  actualHeight?: number
  diffPx?: number
  predictedLineCount?: number
  browserLineCount?: number
  firstBreakMismatch?: ProbeBreakMismatch | null
  message?: string
}

declare global {
  interface Window {
    __PROBE_READY__?: boolean
    __PROBE_REPORT__?: ProbeReport
  }
}

const PADDING = 40
const params = new URLSearchParams(location.search)
const requestId = params.get('requestId') ?? undefined
const text = params.get('text') ?? ''
const width = Math.max(100, Number.parseInt(params.get('width') ?? '600', 10))
const font = params.get('font') ?? '18px serif'
const lineHeight = Math.max(1, Number.parseInt(params.get('lineHeight') ?? '32', 10))
const direction = params.get('dir') === 'rtl' ? 'rtl' : 'ltr'
const lang = params.get('lang') ?? (direction === 'rtl' ? 'ar' : 'en')

const stats = document.getElementById('stats')!
const book = document.getElementById('book')!

const reportEl = document.createElement('pre')
reportEl.id = 'probe-report'
reportEl.hidden = true
reportEl.dataset['ready'] = '0'
document.body.appendChild(reportEl)

const diagnosticDiv = document.createElement('div')
diagnosticDiv.style.position = 'absolute'
diagnosticDiv.style.top = '-99999px'
diagnosticDiv.style.left = '-99999px'
diagnosticDiv.style.visibility = 'hidden'
diagnosticDiv.style.pointerEvents = 'none'
diagnosticDiv.style.boxSizing = 'border-box'
diagnosticDiv.style.whiteSpace = 'normal'
diagnosticDiv.style.wordWrap = 'break-word'
diagnosticDiv.style.overflowWrap = 'break-word'
diagnosticDiv.style.padding = `${PADDING}px`
document.body.appendChild(diagnosticDiv)

const diagnosticCanvas = document.createElement('canvas')
const diagnosticCtx = diagnosticCanvas.getContext('2d')!
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const diagnosticLineFitEpsilon = (() => {
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
  return isSafari ? 1 / 64 : 0.005
})()

function withRequestId<T extends ProbeReport>(report: T): ProbeReport {
  return requestId === undefined ? report : { ...report, requestId }
}

function publishReport(report: ProbeReport): void {
  reportEl.textContent = JSON.stringify(report)
  reportEl.dataset['ready'] = '1'
  window.__PROBE_REPORT__ = report
  window.__PROBE_READY__ = true
  history.replaceState(null, '', `${location.pathname}${location.search}#report=${encodeURIComponent(JSON.stringify(report))}`)
}

function setError(message: string): void {
  stats.textContent = `Error: ${message}`
  publishReport(withRequestId({ status: 'error', message }))
}

function measureCanvasText(textToMeasure: string, measuredFont: string): number {
  diagnosticCtx.font = measuredFont
  return diagnosticCtx.measureText(textToMeasure).width
}

function measureDomText(textToMeasure: string, measuredFont: string, dir: string): number {
  const span = document.createElement('span')
  span.style.position = 'absolute'
  span.style.visibility = 'hidden'
  span.style.whiteSpace = 'pre'
  span.style.font = measuredFont
  span.style.direction = dir
  span.style.unicodeBidi = 'plaintext'
  span.textContent = textToMeasure
  document.body.appendChild(span)
  const measured = span.getBoundingClientRect().width
  document.body.removeChild(span)
  return measured
}

function getLineContent(lineText: string, end: number): { text: string, end: number } {
  const trimmed = lineText.trimEnd()
  return {
    text: trimmed,
    end: end - (lineText.length - trimmed.length),
  }
}

function formatBreakContext(fullText: string, breakOffset: number, radius = 24): string {
  const start = Math.max(0, breakOffset - radius)
  const end = Math.min(fullText.length, breakOffset + radius)
  return `${start > 0 ? '…' : ''}${fullText.slice(start, breakOffset)}|${fullText.slice(breakOffset, end)}${end < fullText.length ? '…' : ''}`
}

function getDiagnosticUnits(prepared: PreparedTextWithSegments): Array<{ text: string, start: number, end: number }> {
  const units: Array<{ text: string, start: number, end: number }> = []
  let offset = 0

  for (let i = 0; i < prepared.segments.length; i++) {
    const segment = prepared.segments[i]!
    if (prepared.breakableWidths[i] !== null) {
      let localOffset = 0
      for (const grapheme of graphemeSegmenter.segment(segment)) {
        const start = offset + localOffset
        localOffset += grapheme.segment.length
        units.push({ text: grapheme.segment, start, end: offset + localOffset })
      }
    } else {
      units.push({ text: segment, start: offset, end: offset + segment.length })
    }
    offset += segment.length
  }

  return units
}

function getBrowserLines(prepared: PreparedTextWithSegments, measuredFont: string, dir: string): ProbeLine[] {
  const textNode = diagnosticDiv.firstChild
  const lines: ProbeLine[] = []
  if (!(textNode instanceof Text)) return lines

  const units = getDiagnosticUnits(prepared)
  const range = document.createRange()
  let currentLine = ''
  let currentStart: number | null = null
  let currentEnd = 0
  let lastTop: number | null = null

  function pushLine(): void {
    if (currentStart === null || currentLine.length === 0) return
    const content = getLineContent(currentLine, currentEnd)
    lines.push({
      text: currentLine,
      renderedText: currentLine,
      contentText: content.text,
      start: currentStart,
      end: currentEnd,
      contentEnd: content.end,
      fullWidth: measureCanvasText(content.text, measuredFont),
      domWidth: measureDomText(content.text, measuredFont, dir),
    })
  }

  for (const unit of units) {
    range.setStart(textNode, unit.start)
    range.setEnd(textNode, unit.end)
    const rects = range.getClientRects()
    const top: number | null = rects.length > 0 ? rects[0]!.top : lastTop

    if (top !== null && lastTop !== null && top > lastTop + 0.5) {
      pushLine()
      currentLine = unit.text
      currentStart = unit.start
      currentEnd = unit.end
    } else {
      if (currentStart === null) currentStart = unit.start
      currentLine += unit.text
      currentEnd = unit.end
    }

    if (top !== null) lastTop = top
  }

  pushLine()
  return lines
}

function measurePreparedSlice(
  prepared: PreparedTextWithSegments,
  start: number,
  end: number,
  measuredFont: string,
): number {
  let total = 0
  let offset = 0

  for (let i = 0; i < prepared.segments.length; i++) {
    const segment = prepared.segments[i]!
    const nextOffset = offset + segment.length
    if (nextOffset <= start) {
      offset = nextOffset
      continue
    }
    if (offset >= end) break

    const overlapStart = Math.max(start, offset)
    const overlapEnd = Math.min(end, nextOffset)
    if (overlapStart >= overlapEnd) {
      offset = nextOffset
      continue
    }

    const localStart = overlapStart - offset
    const localEnd = overlapEnd - offset
    if (localStart === 0 && localEnd === segment.length) {
      total += prepared.widths[i]!
    } else {
      total += measureCanvasText(segment.slice(localStart, localEnd), measuredFont)
    }

    offset = nextOffset
  }

  return total
}

function getOurLines(
  prepared: PreparedTextWithSegments,
  normalizedText: string,
  contentWidth: number,
  measuredFont: string,
): ProbeLine[] {
  const result: ProbeLine[] = []
  const { widths, kinds, breakableWidths, segments } = prepared
  if (widths.length === 0) return result

  let offset = 0
  let lineStart = 0
  let lineEnd = 0
  let lineContentEnd = 0
  let lineRenderedText = ''
  let lineW = 0
  let hasContent = false

  function pushCurrentLine(): void {
    if (!hasContent) return
    const content = getLineContent(lineRenderedText, lineContentEnd)
    const logicalText = normalizedText.slice(lineStart, content.end)
    result.push({
      text: logicalText,
      renderedText: lineRenderedText,
      contentText: content.text,
      start: lineStart,
      end: lineEnd,
      contentEnd: content.end,
      fullWidth: measureCanvasText(content.text, measuredFont),
      domWidth: measureDomText(content.text, measuredFont, direction),
      sumWidth: measurePreparedSlice(prepared, lineStart, content.end, measuredFont),
    })
    hasContent = false
    lineRenderedText = ''
    lineW = 0
    lineStart = lineEnd
    lineContentEnd = lineEnd
  }

  function appendToCurrentLine(textPart: string, width: number, start: number, end: number): void {
    if (!hasContent) {
      lineStart = start
      hasContent = true
    }
    lineRenderedText += textPart
    lineW += width
    lineEnd = end
    lineContentEnd = end
  }

  function layoutBreakableSegment(segIndex: number, segStart: number): void {
    const graphemeWidths = breakableWidths[segIndex]!
    let graphemeIndex = 0
    let localOffset = 0

    for (const grapheme of graphemeSegmenter.segment(segments[segIndex]!)) {
      const gw = graphemeWidths[graphemeIndex]!
      const gStart = segStart + localOffset
      localOffset += grapheme.segment.length
      const gEnd = segStart + localOffset

      if (hasContent && lineW + gw > contentWidth + diagnosticLineFitEpsilon) {
        pushCurrentLine()
      }

      appendToCurrentLine(grapheme.segment, gw, gStart, gEnd)
      graphemeIndex++
    }

    offset = segStart + localOffset
  }

  for (let i = 0; i < widths.length; i++) {
    const segStart = offset
    const segText = segments[i]!
    const segEnd = segStart + segText.length
    const w = widths[i]!

    if (!hasContent) {
      if (w > contentWidth && breakableWidths[i] !== null) {
        layoutBreakableSegment(i, segStart)
      } else {
        appendToCurrentLine(segText, w, segStart, segEnd)
        offset = segEnd
      }
      continue
    }

    const newW = lineW + w
    if (newW > contentWidth + diagnosticLineFitEpsilon) {
      if (kinds[i] === 'space') {
        lineEnd = segEnd
        offset = segEnd
        continue
      }

      if (w > contentWidth && breakableWidths[i] !== null) {
        pushCurrentLine()
        layoutBreakableSegment(i, segStart)
      } else {
        pushCurrentLine()
        appendToCurrentLine(segText, w, segStart, segEnd)
        offset = segEnd
      }
      continue
    }

    appendToCurrentLine(segText, w, segStart, segEnd)
    offset = segEnd
  }

  pushCurrentLine()
  return result
}

function classifyBreakMismatch(contentWidth: number, ours: ProbeLine | undefined, browser: ProbeLine | undefined): string {
  if (!ours || !browser) return 'line-count mismatch after an earlier break shift'

  const longer = ours.contentEnd >= browser.contentEnd ? ours : browser
  const longerLabel = longer === ours ? 'ours' : 'browser'
  const overflow = longer.fullWidth - contentWidth
  if (Math.abs(overflow) <= 0.05) {
    return `${longerLabel} keeps text with only ${overflow.toFixed(3)}px overflow`
  }

  const oursDrift = (ours.sumWidth ?? ours.fullWidth) - ours.fullWidth
  if (Math.abs(oursDrift) > 0.05) {
    return `our segment sum drifts from full-string width by ${oursDrift.toFixed(3)}px`
  }

  if (browser.contentEnd > ours.contentEnd && browser.fullWidth <= contentWidth) {
    return 'browser fits the longer line while our break logic cuts earlier'
  }

  return 'different break opportunity around punctuation or shaping context'
}

function getFirstBreakMismatch(
  normalizedText: string,
  contentWidth: number,
  ourLines: ProbeLine[],
  browserLines: ProbeLine[],
): ProbeBreakMismatch | null {
  const maxLines = Math.max(ourLines.length, browserLines.length)
  for (let i = 0; i < maxLines; i++) {
    const ours = ourLines[i]
    const browser = browserLines[i]
    if (!ours || !browser || ours.start !== browser.start || ours.contentEnd !== browser.contentEnd) {
      const oursEnd = ours?.contentEnd ?? ours?.start ?? browser?.start ?? 0
      const browserEnd = browser?.contentEnd ?? browser?.start ?? ours?.start ?? 0
      const minEnd = Math.min(oursEnd, browserEnd)
      const maxEnd = Math.max(oursEnd, browserEnd)

      return {
        line: i + 1,
        oursStart: ours?.start ?? -1,
        browserStart: browser?.start ?? -1,
        oursEnd,
        browserEnd,
        oursText: ours?.contentText ?? '',
        browserText: browser?.contentText ?? '',
        oursRenderedText: ours?.renderedText ?? '',
        browserRenderedText: browser?.renderedText ?? browser?.text ?? '',
        oursContext: formatBreakContext(normalizedText, oursEnd),
        browserContext: formatBreakContext(normalizedText, browserEnd),
        deltaText: normalizedText.slice(minEnd, maxEnd),
        reasonGuess: classifyBreakMismatch(contentWidth, ours, browser),
        oursSumWidth: ours?.sumWidth ?? 0,
        oursDomWidth: ours?.domWidth ?? 0,
        oursFullWidth: ours?.fullWidth ?? 0,
        browserDomWidth: browser?.domWidth ?? 0,
        browserFullWidth: browser?.fullWidth ?? 0,
      }
    }
  }

  return null
}

function init(): void {
  try {
    document.title = 'Pretext — Text Probe'
    document.documentElement.lang = lang
    document.documentElement.dir = direction

    book.textContent = text
    book.lang = lang
    book.dir = direction
    book.style.font = font
    book.style.lineHeight = `${lineHeight}px`
    book.style.padding = `${PADDING}px`
    book.style.width = `${width}px`

    diagnosticDiv.textContent = text
    diagnosticDiv.lang = lang
    diagnosticDiv.dir = direction
    diagnosticDiv.style.font = font
    diagnosticDiv.style.lineHeight = `${lineHeight}px`
    diagnosticDiv.style.padding = `${PADDING}px`
    diagnosticDiv.style.width = `${width}px`

    const prepared = prepareWithSegments(text, font)
    const normalizedText = prepared.segments.join('')
    const contentWidth = width - PADDING * 2
    const predicted = layout(prepared, contentWidth, lineHeight)
    const actualHeight = book.getBoundingClientRect().height
    const ourLines = getOurLines(prepared, normalizedText, contentWidth, font)
    const browserLines = getBrowserLines(prepared, font, direction)

    const report = withRequestId({
      status: 'ready',
      text,
      width,
      contentWidth,
      font,
      lineHeight,
      direction,
      predictedHeight: predicted.height + PADDING * 2,
      actualHeight,
      diffPx: predicted.height + PADDING * 2 - actualHeight,
      predictedLineCount: ourLines.length,
      browserLineCount: browserLines.length,
      firstBreakMismatch: getFirstBreakMismatch(normalizedText, contentWidth, ourLines, browserLines),
    })

    stats.textContent =
      `Width ${width}px | Pretext ${report.predictedLineCount} lines | DOM ${report.browserLineCount} lines | Diff ${report.diffPx}px`
    publishReport(report)
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error))
  }
}

window.__PROBE_READY__ = false
window.__PROBE_REPORT__ = withRequestId({ status: 'error', message: 'Pending initial layout' })
reportEl.textContent = ''
history.replaceState(null, '', `${location.pathname}${location.search}`)
if ('fonts' in document) {
  void document.fonts.ready.then(init)
} else {
  init()
}
