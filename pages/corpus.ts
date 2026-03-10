import {
  layout,
  layoutWithLines,
  prepareWithSegments,
  type PreparedTextWithSegments,
} from '../src/layout.ts'
import sourcesData from '../corpora/sources.json' with { type: 'json' }
import arAlBukhala from '../corpora/ar-al-bukhala.txt' with { type: 'text' }
import arRisalatAlGhufranPart1 from '../corpora/ar-risalat-al-ghufran-part-1.txt' with { type: 'text' }
import heMasaotBinyaminMetudela from '../corpora/he-masaot-binyamin-metudela.txt' with { type: 'text' }
import hiEidgah from '../corpora/hi-eidgah.txt' with { type: 'text' }
import koUnsuJohEunNal from '../corpora/ko-unsu-joh-eun-nal.txt' with { type: 'text' }
import thNithanVetalStory1 from '../corpora/th-nithan-vetal-story-1.txt' with { type: 'text' }

type CorpusMeta = {
  id: string
  language: string
  direction?: 'ltr' | 'rtl'
  title: string
  output: string
  font_family?: string
  font_size_px?: number
  line_height_px?: number
  default_width?: number
  min_width?: number
  max_width?: number
}

type CorpusReport = {
  status: 'ready' | 'error'
  requestId?: string
  environment?: EnvironmentFingerprint
  corpusId?: string
  title?: string
  language?: string
  direction?: string
  width?: number
  contentWidth?: number
  font?: string
  lineHeight?: number
  predictedHeight?: number
  actualHeight?: number
  diffPx?: number
  predictedLineCount?: number
  browserLineCount?: number
  browserLineMethod?: 'span-probe' | 'range'
  probeHeight?: number
  normalizedHeight?: number
  mismatchCount?: number
  firstMismatch?: CorpusLineMismatch | null
  firstBreakMismatch?: CorpusBreakMismatch | null
  maxLineWidthDrift?: number
  maxDriftLine?: {
    line: number
    drift: number
    text: string
    sumWidth: number
    fullWidth: number
    domWidth: number
    pairAdjustedWidth: number
    segments: Array<{
      text: string
      width: number
      domWidth: number
      isSpace: boolean
    }>
  } | null
  message?: string
}

type CorpusLineMismatch = {
  line: number
  ours: string
  browser: string
}

type CorpusBreakMismatch = {
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
  oursSegments: Array<{
    text: string
    width: number
    domWidth: number
    isSpace: boolean
  }>
}

type DiagnosticLine = {
  text: string
  renderedText: string
  contentText: string
  start: number
  end: number
  contentEnd: number
  fullWidth: number
  rawFullWidth: number
  sumWidth?: number
  domWidth?: number
  rawDomWidth?: number
}

type DiagnosticUnit = {
  text: string
  start: number
  end: number
}

type EnvironmentFingerprint = {
  userAgent: string
  devicePixelRatio: number
  viewport: {
    innerWidth: number
    innerHeight: number
    outerWidth: number
    outerHeight: number
    visualViewportScale: number | null
  }
  screen: {
    width: number
    height: number
    availWidth: number
    availHeight: number
    colorDepth: number
    pixelDepth: number
  }
}

declare global {
  interface Window {
    __CORPUS_READY__?: boolean
    __CORPUS_REPORT__?: CorpusReport
    __CORPUS_DEBUG__?: {
      corpusId: string
      font: string
      lineHeight: number
      padding: number
      direction: string
      width: number
      contentWidth: number
      getNormalizedText: () => string
      layoutWithLines: (width: number) => ReturnType<typeof layoutWithLines>
    }
  }
}

const book = document.getElementById('book')!
const slider = document.getElementById('slider') as HTMLInputElement
const valLabel = document.getElementById('val')!
const stats = document.getElementById('stats')!
const select = document.getElementById('corpus') as HTMLSelectElement

const PADDING = 40

const params = new URLSearchParams(location.search)
const requestId = params.get('requestId') ?? undefined
const requestedCorpusId = params.get('id')
const requestedWidth = Number.parseInt(params.get('width') ?? '', 10)
const diagnosticMode = params.get('diagnostic') ?? 'light'

const reportEl = document.createElement('pre')
reportEl.id = 'corpus-report'
reportEl.hidden = true
reportEl.dataset['ready'] = '0'
document.body.appendChild(reportEl)

const diagnosticCanvas = document.createElement('canvas')
const diagnosticCtx = diagnosticCanvas.getContext('2d')!
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

const lineProbeDiv = document.createElement('div')
lineProbeDiv.style.position = 'absolute'
lineProbeDiv.style.top = '-99999px'
lineProbeDiv.style.left = '-99999px'
lineProbeDiv.style.visibility = 'hidden'
lineProbeDiv.style.pointerEvents = 'none'
lineProbeDiv.style.boxSizing = 'border-box'
lineProbeDiv.style.whiteSpace = 'normal'
lineProbeDiv.style.wordWrap = 'break-word'
lineProbeDiv.style.overflowWrap = 'break-word'
lineProbeDiv.style.padding = `${PADDING}px`
document.body.appendChild(lineProbeDiv)

const diagnosticGraphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
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

let corpusList: CorpusMeta[] = []
let currentMeta: CorpusMeta | null = null
let currentText = ''
let currentPrepared: PreparedTextWithSegments | null = null

function withRequestId<T extends CorpusReport>(report: T): CorpusReport {
  return requestId === undefined ? report : { ...report, requestId }
}

function getEnvironmentFingerprint(): EnvironmentFingerprint {
  return {
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      visualViewportScale: window.visualViewport?.scale ?? null,
    },
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      availWidth: window.screen.availWidth,
      availHeight: window.screen.availHeight,
      colorDepth: window.screen.colorDepth,
      pixelDepth: window.screen.pixelDepth,
    },
  }
}

function publishNavigationReport(report: CorpusReport): void {
  const encoded = encodeURIComponent(JSON.stringify(report))
  history.replaceState(null, '', `${location.pathname}${location.search}#report=${encoded}`)
}

function buildFont(meta: CorpusMeta): string {
  const size = meta.font_size_px ?? 18
  const family = meta.font_family ?? 'serif'
  return `${size}px ${family}`
}

function getLineHeight(meta: CorpusMeta): number {
  return meta.line_height_px ?? Math.round((meta.font_size_px ?? 18) * 1.6)
}

function getDirection(meta: CorpusMeta): 'ltr' | 'rtl' {
  return meta.direction === 'rtl' ? 'rtl' : 'ltr'
}

function estimateBrowserLineCount(actualHeight: number, lineHeight: number): number {
  const contentHeight = Math.max(0, actualHeight - PADDING * 2)
  return Math.max(0, Math.round(contentHeight / lineHeight))
}

function measureFullTextWidth(text: string, font: string): number {
  diagnosticCtx.font = font
  return diagnosticCtx.measureText(text).width
}

function formatBreakContext(text: string, breakOffset: number, radius = 32): string {
  const start = Math.max(0, breakOffset - radius)
  const end = Math.min(text.length, breakOffset + radius)
  return `${start > 0 ? '…' : ''}${text.slice(start, breakOffset)}|${text.slice(breakOffset, end)}${end < text.length ? '…' : ''}`
}

function getLineContent(text: string, end: number): { text: string, end: number } {
  const trimmed = text.trimEnd()
  return {
    text: trimmed,
    end: end - (text.length - trimmed.length),
  }
}

function getDiagnosticUnits(prepared: PreparedTextWithSegments): DiagnosticUnit[] {
  const units: DiagnosticUnit[] = []
  let offset = 0

  for (let i = 0; i < prepared.segments.length; i++) {
    const text = prepared.segments[i]!
    if (prepared.breakableWidths[i] !== null) {
      let localOffset = 0
      for (const g of diagnosticGraphemeSegmenter.segment(text)) {
        const start = offset + localOffset
        localOffset += g.segment.length
        units.push({ text: g.segment, start, end: offset + localOffset })
      }
    } else {
      units.push({ text, start: offset, end: offset + text.length })
    }
    offset += text.length
  }

  return units
}

function pushDiagnosticLine(
  lines: DiagnosticLine[],
  text: string,
  start: number | null,
  end: number,
  normalizedText: string,
  font: string,
  direction: string,
): void {
  if (text.length === 0 || start === null) return
  const content = getLineContent(text, end)
  lines.push({
    text,
    renderedText: text,
    contentText: content.text,
    start,
    end,
    contentEnd: content.end,
    fullWidth: measureFullTextWidth(content.text, font),
    rawFullWidth: measureFullTextWidth(normalizedText.slice(start, end), font),
    domWidth: measureDomTextWidth(content.text, font, direction),
    rawDomWidth: measureDomTextWidth(normalizedText.slice(start, end), font, direction),
  })
}

function getBrowserLinesFromSpans(
  prepared: PreparedTextWithSegments,
  div: HTMLDivElement,
  normalizedText: string,
  font: string,
): { lines: DiagnosticLine[], height: number } {
  const units = getDiagnosticUnits(prepared)
  const browserLines: DiagnosticLine[] = []
  const spans: HTMLSpanElement[] = []
  let currentLine = ''
  let currentStart: number | null = null
  let currentEnd = 0
  let lastTop: number | null = null

  div.textContent = ''
  for (const unit of units) {
    const span = document.createElement('span')
    span.textContent = unit.text
    div.appendChild(span)
    spans.push(span)
  }

  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!
    const span = spans[i]!
    const rect = span.getBoundingClientRect()
    const rectTop: number | null = rect.width > 0 || rect.height > 0 ? rect.top : lastTop

    if (rectTop !== null && lastTop !== null && rectTop > lastTop + 0.5) {
      pushDiagnosticLine(browserLines, currentLine, currentStart, currentEnd, normalizedText, font, div.dir || 'ltr')
      currentLine = unit.text
      currentStart = unit.start
      currentEnd = unit.end
    } else {
      if (currentStart === null) currentStart = unit.start
      currentLine += unit.text
      currentEnd = unit.end
    }

    if (rectTop !== null) lastTop = rectTop
  }

  pushDiagnosticLine(browserLines, currentLine, currentStart, currentEnd, normalizedText, font, div.dir || 'ltr')
  const height = div.getBoundingClientRect().height
  div.textContent = ''
  return { lines: browserLines, height }
}

function getBrowserLinesFromRange(
  prepared: PreparedTextWithSegments,
  div: HTMLDivElement,
  normalizedText: string,
  font: string,
): { lines: DiagnosticLine[], height: number } {
  const textNode = div.firstChild
  const browserLines: DiagnosticLine[] = []
  if (!(textNode instanceof Text)) {
    return { lines: browserLines, height: div.getBoundingClientRect().height }
  }

  const units = getDiagnosticUnits(prepared)
  const range = document.createRange()
  let currentLine = ''
  let currentStart: number | null = null
  let currentEnd = 0
  let lastTop: number | null = null

  for (const unit of units) {
    range.setStart(textNode, unit.start)
    range.setEnd(textNode, unit.end)
    const rects = range.getClientRects()
    const rectTop: number | null = rects.length > 0 ? rects[0]!.top : lastTop

    if (rectTop !== null && lastTop !== null && rectTop > lastTop + 0.5) {
      pushDiagnosticLine(browserLines, currentLine, currentStart, currentEnd, normalizedText, font, div.dir || 'ltr')
      currentLine = unit.text
      currentStart = unit.start
      currentEnd = unit.end
    } else {
      if (currentStart === null) currentStart = unit.start
      currentLine += unit.text
      currentEnd = unit.end
    }

    if (rectTop !== null) lastTop = rectTop
  }

  pushDiagnosticLine(browserLines, currentLine, currentStart, currentEnd, normalizedText, font, div.dir || 'ltr')
  return { lines: browserLines, height: div.getBoundingClientRect().height }
}

function measureDomTextWidth(text: string, font: string, direction: string): number {
  const span = document.createElement('span')
  span.style.position = 'absolute'
  span.style.visibility = 'hidden'
  span.style.whiteSpace = 'pre'
  span.style.font = font
  span.style.direction = direction
  span.style.unicodeBidi = 'plaintext'
  span.textContent = text
  document.body.appendChild(span)
  const width = span.getBoundingClientRect().width
  document.body.removeChild(span)
  return width
}

function getOurLines(
  prepared: PreparedTextWithSegments,
  normalizedText: string,
  maxWidth: number,
  font: string,
): DiagnosticLine[] {
  const lines: DiagnosticLine[] = []
  const { widths, kinds, breakableWidths, segments } = prepared
  if (widths.length === 0) return lines

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
    lines.push({
      text: logicalText,
      renderedText: lineRenderedText,
      contentText: content.text,
      start: lineStart,
      end: lineEnd,
      contentEnd: content.end,
      sumWidth: measurePreparedSlice(prepared, lineStart, content.end, font),
      fullWidth: measureFullTextWidth(content.text, font),
      rawFullWidth: measureFullTextWidth(normalizedText.slice(lineStart, lineEnd), font),
    })

    hasContent = false
    lineRenderedText = ''
    lineW = 0
    lineStart = lineEnd
    lineContentEnd = lineEnd
  }

  function appendToCurrentLine(text: string, width: number, start: number, end: number): void {
    if (!hasContent) {
      lineStart = start
      hasContent = true
    }
    lineRenderedText += text
    lineW += width
    lineEnd = end
    lineContentEnd = end
  }

  function layoutBreakableSegment(segIndex: number, segStart: number): void {
    const graphemeWidths = breakableWidths[segIndex]!
    let graphemeIndex = 0
    let localOffset = 0

    for (const grapheme of diagnosticGraphemeSegmenter.segment(segments[segIndex]!)) {
      const gw = graphemeWidths[graphemeIndex]!
      const gStart = segStart + localOffset
      localOffset += grapheme.segment.length
      const gEnd = segStart + localOffset

      if (hasContent && lineW + gw > maxWidth + diagnosticLineFitEpsilon) {
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
      if (w > maxWidth && breakableWidths[i] !== null) {
        layoutBreakableSegment(i, segStart)
      } else {
        appendToCurrentLine(segText, w, segStart, segEnd)
        offset = segEnd
      }
      continue
    }

    const newW = lineW + w
    if (newW > maxWidth + diagnosticLineFitEpsilon) {
      if (kinds[i] === 'space') {
        lineEnd = segEnd
        offset = segEnd
        continue
      }

      if (w > maxWidth && breakableWidths[i] !== null) {
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
  return lines
}

function measurePreparedSlice(
  prepared: PreparedTextWithSegments,
  start: number,
  end: number,
  font: string,
): number {
  let total = 0
  let offset = 0

  for (let i = 0; i < prepared.segments.length; i++) {
    const text = prepared.segments[i]!
    const nextOffset = offset + text.length
    if (nextOffset <= start) {
      offset = nextOffset
      continue
    }
    if (offset >= end) {
      break
    }

    const overlapStart = Math.max(start, offset)
    const overlapEnd = Math.min(end, nextOffset)
    if (overlapStart >= overlapEnd) {
      offset = nextOffset
      continue
    }

    const localStart = overlapStart - offset
    const localEnd = overlapEnd - offset
    if (localStart === 0 && localEnd === text.length) {
      total += prepared.widths[i]!
      offset = nextOffset
      continue
    }

    const graphemeWidths = prepared.breakableWidths[i]
    if (graphemeWidths !== null && graphemeWidths !== undefined) {
      let graphemeOffset = 0
      let graphemeIndex = 0
      for (const g of diagnosticGraphemeSegmenter.segment(text)) {
        const nextGraphemeOffset = graphemeOffset + g.segment.length
        if (nextGraphemeOffset > localStart && graphemeOffset < localEnd) {
          total += graphemeWidths[graphemeIndex]!
        }
        graphemeOffset = nextGraphemeOffset
        graphemeIndex++
      }
    } else {
      total += measureFullTextWidth(text.slice(localStart, localEnd), font)
    }

    offset = nextOffset
  }

  return total
}

function getLineSegments(
  prepared: PreparedTextWithSegments,
  start: number,
  end: number,
  font: string,
  direction: string,
): Array<{ text: string, width: number, domWidth: number, isSpace: boolean }> {
  const segments: Array<{ text: string, width: number, domWidth: number, isSpace: boolean }> = []
  let offset = 0
  for (let i = 0; i < prepared.segments.length; i++) {
    const text = prepared.segments[i]!
    const nextOffset = offset + text.length
    if (nextOffset > start && offset < end) {
      segments.push({
        text,
        width: prepared.widths[i]!,
        domWidth: measureDomTextWidth(text, font, direction),
        isSpace: prepared.kinds[i] === 'space',
      })
    }
    if (offset >= end) break
    offset = nextOffset
  }
  return segments
}

function measurePairAdjustedWidth(
  segments: Array<{ text: string, width: number, domWidth: number, isSpace: boolean }>,
  font: string,
  direction: string,
): number {
  let total = 0
  for (const segment of segments) {
    total += segment.domWidth
  }
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1]!
    const next = segments[i]!
    total += measureDomTextWidth(prev.text + next.text, font, direction) - prev.domWidth - next.domWidth
  }
  return total
}

function classifyBreakMismatch(
  contentWidth: number,
  ours: DiagnosticLine | undefined,
  browser: DiagnosticLine | undefined,
): string {
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
  prepared: PreparedTextWithSegments,
  normalizedText: string,
  contentWidth: number,
  ourLines: DiagnosticLine[],
  browserLines: DiagnosticLine[],
  font: string,
  direction: string,
): CorpusBreakMismatch | null {
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
        oursDomWidth: ours ? measureDomTextWidth(ours.contentText, font, direction) : 0,
        oursFullWidth: ours?.fullWidth ?? 0,
        browserDomWidth: browser?.domWidth ?? 0,
        browserFullWidth: browser?.fullWidth ?? 0,
        oursSegments: ours ? getLineSegments(prepared, ours.start, ours.end, font, direction) : [],
      }
    }
  }
  return null
}

function setReport(report: CorpusReport): void {
  reportEl.textContent = JSON.stringify(report)
  reportEl.dataset['ready'] = '1'
  window.__CORPUS_REPORT__ = report
  window.__CORPUS_READY__ = true
  publishNavigationReport(report)
}

function setError(message: string): void {
  stats.textContent = `Error: ${message}`
  setReport(withRequestId({ status: 'error', message }))
}

function updateTitle(meta: CorpusMeta): void {
  document.title = `Pretext — ${meta.title}`
  document.documentElement.lang = meta.language
  document.documentElement.dir = getDirection(meta)
}

function configureControls(meta: CorpusMeta): void {
  slider.min = String(meta.min_width ?? 300)
  slider.max = String(meta.max_width ?? 900)
}

function getInitialWidth(meta: CorpusMeta): number {
  const min = meta.min_width ?? 300
  const max = meta.max_width ?? 900
  const fallback = meta.default_width ?? 600
  const width = Number.isFinite(requestedWidth) ? requestedWidth : fallback
  return Math.max(min, Math.min(max, width))
}

function buildReadyReport(
  meta: CorpusMeta,
  width: number,
  font: string,
  lineHeight: number,
  predictedHeight: number,
  actualHeight: number,
  predictedLineCount: number,
): CorpusReport {
  return withRequestId({
    status: 'ready',
    environment: getEnvironmentFingerprint(),
    corpusId: meta.id,
    title: meta.title,
    language: meta.language,
    direction: getDirection(meta),
    width,
    contentWidth: width - PADDING * 2,
    font,
    lineHeight,
    predictedHeight,
    actualHeight,
    diffPx: predictedHeight - actualHeight,
    predictedLineCount,
    browserLineCount: estimateBrowserLineCount(actualHeight, lineHeight),
  })
}

function addDiagnostics(
  report: CorpusReport,
  prepared: PreparedTextWithSegments,
  font: string,
  lineHeight: number,
  contentWidth: number,
  normalizedText: string,
  direction: string,
): CorpusReport {
  if (diagnosticMode !== 'full' || report.status !== 'ready') {
    return report
  }

  const ourLines = getOurLines(prepared, normalizedText, contentWidth, font)
  const probeResult = getBrowserLinesFromSpans(prepared, lineProbeDiv, normalizedText, font)
  const probeHeight = probeResult.height
  const normalizedHeight = diagnosticDiv.getBoundingClientRect().height
  const probeReliable =
    direction !== 'rtl' &&
    Math.abs(probeHeight - normalizedHeight) <= Math.max(1, lineHeight / 2)
  const browserResult = probeReliable
    ? probeResult
    : getBrowserLinesFromRange(prepared, diagnosticDiv, normalizedText, font)
  const browserLines = browserResult.lines

  let mismatchCount = 0
  let firstMismatch: CorpusLineMismatch | null = null
  let maxLineWidthDrift = 0
  let maxDriftLine: NonNullable<CorpusReport['maxDriftLine']> | null = null
  const maxLines = Math.max(ourLines.length, browserLines.length)

  for (let i = 0; i < maxLines; i++) {
    const ours = ourLines[i]
    const browser = browserLines[i]
    const oursText = ours?.contentText ?? ''
    const browserText = browser?.contentText ?? ''
    if (oursText !== browserText) {
      mismatchCount++
      if (firstMismatch === null) {
        firstMismatch = { line: i + 1, ours: oursText, browser: browserText }
      }
    }
    if (ours !== undefined) {
      const drift = (ours.sumWidth ?? ours.fullWidth) - ours.fullWidth
      if (Math.abs(drift) > Math.abs(maxLineWidthDrift)) {
        maxLineWidthDrift = drift
        const segments = getLineSegments(prepared, ours.start, ours.end, font, direction)
        maxDriftLine = {
          line: i + 1,
          drift,
          text: ours.contentText,
          sumWidth: ours.sumWidth ?? ours.fullWidth,
          fullWidth: ours.fullWidth,
          domWidth: measureDomTextWidth(ours.contentText, font, direction),
          pairAdjustedWidth: measurePairAdjustedWidth(segments, font, direction),
          segments,
        }
      }
    }
  }

  return {
    ...report,
    predictedLineCount: ourLines.length,
    browserLineCount: browserLines.length,
    browserLineMethod: probeReliable ? 'span-probe' : 'range',
    probeHeight,
    normalizedHeight,
    mismatchCount,
    firstMismatch,
    firstBreakMismatch: getFirstBreakMismatch(prepared, normalizedText, contentWidth, ourLines, browserLines, font, direction),
    maxLineWidthDrift,
    maxDriftLine,
  }
}

function updateStats(report: CorpusReport, msPretext: number, msDOM: number): void {
  if (report.status !== 'ready') return
  const diff = report.diffPx ?? 0
  const diffText = diff === 0 ? 'exact' : `${diff > 0 ? '+' : ''}${Math.round(diff)}px`
  stats.textContent =
    `${report.title} | Pretext: ${msPretext.toFixed(2)}ms (${Math.round(report.predictedHeight ?? 0)}px)` +
    ` | DOM: ${msDOM.toFixed(1)}ms (${Math.round(report.actualHeight ?? 0)}px)` +
    ` | Diff: ${diffText}` +
    ` | Lines: ${report.predictedLineCount ?? 0}/${report.browserLineCount ?? 0}` +
    ` | ${currentText.length.toLocaleString()} chars`
}

function setWidth(width: number): void {
  if (currentMeta === null || currentPrepared === null) {
    return
  }

  const font = buildFont(currentMeta)
  const lineHeight = getLineHeight(currentMeta)
  const direction = getDirection(currentMeta)
  const contentWidth = width - PADDING * 2
  const prepared = currentPrepared
  const normalizedText = prepared.segments.join('')

  slider.value = String(width)
  valLabel.textContent = `${width}px`

  const t0p = performance.now()
  const predicted = layout(prepared, contentWidth, lineHeight)
  const msPretext = performance.now() - t0p

  const t0d = performance.now()
  book.style.width = `${width}px`
  diagnosticDiv.style.width = `${width}px`
  lineProbeDiv.style.width = `${width}px`
  const actualHeight = book.getBoundingClientRect().height
  const msDOM = performance.now() - t0d

  const predictedHeight = predicted.height + PADDING * 2
  let report = buildReadyReport(
    currentMeta,
    width,
    font,
    lineHeight,
    predictedHeight,
    actualHeight,
    predicted.lineCount,
  )
  report = addDiagnostics(report, prepared, font, lineHeight, contentWidth, normalizedText, direction)

  window.__CORPUS_DEBUG__ = {
    corpusId: currentMeta.id,
    font,
    lineHeight,
    padding: PADDING,
    direction,
    width,
    contentWidth,
    getNormalizedText: () => normalizedText,
    layoutWithLines: nextWidth => layoutWithLines(prepared, nextWidth - PADDING * 2, lineHeight),
  }

  updateStats(report, msPretext, msDOM)
  setReport(report)
}

function populateSelect(selectedId: string): void {
  select.textContent = ''
  for (const meta of corpusList) {
    const option = document.createElement('option')
    option.value = meta.id
    option.textContent = `${meta.language} — ${meta.title}`
    option.selected = meta.id === selectedId
    select.appendChild(option)
  }
}

async function loadSources(): Promise<CorpusMeta[]> {
  return sourcesData as CorpusMeta[]
}

async function loadText(meta: CorpusMeta): Promise<string> {
  switch (meta.id) {
    case 'ar-al-bukhala':
      return arAlBukhala
    case 'ar-risalat-al-ghufran-part-1':
      return arRisalatAlGhufranPart1
    case 'he-masaot-binyamin-metudela':
      return heMasaotBinyaminMetudela
    case 'hi-eidgah':
      return hiEidgah
    case 'ko-unsu-joh-eun-nal':
      return koUnsuJohEunNal
    case 'th-nithan-vetal-story-1':
      return thNithanVetalStory1
    default:
      throw new Error(`No bundled text import for corpus ${meta.id}`)
  }
}

async function loadCorpus(meta: CorpusMeta): Promise<void> {
  currentMeta = meta
  currentText = await loadText(meta)

  updateTitle(meta)
  configureControls(meta)
  populateSelect(meta.id)

  const font = buildFont(meta)
  const lineHeight = getLineHeight(meta)
  const direction = getDirection(meta)

  book.textContent = currentText
  book.lang = meta.language
  book.dir = direction
  book.style.font = font
  book.style.lineHeight = `${lineHeight}px`
  book.style.padding = `${PADDING}px`
  diagnosticDiv.style.font = font
  diagnosticDiv.style.lineHeight = `${lineHeight}px`
  diagnosticDiv.style.padding = `${PADDING}px`
  diagnosticDiv.lang = meta.language
  diagnosticDiv.dir = direction
  lineProbeDiv.style.font = font
  lineProbeDiv.style.lineHeight = `${lineHeight}px`
  lineProbeDiv.style.padding = `${PADDING}px`
  lineProbeDiv.lang = meta.language
  lineProbeDiv.dir = direction

  if ('fonts' in document) {
    await document.fonts.ready
  }

  currentPrepared = prepareWithSegments(currentText, font)
  diagnosticDiv.textContent = currentPrepared.segments.join('')
  setWidth(getInitialWidth(meta))
}

function navigateToCorpus(id: string): void {
  const nextParams = new URLSearchParams(location.search)
  nextParams.set('id', id)
  nextParams.delete('width')
  nextParams.delete('requestId')
  nextParams.delete('report')
  nextParams.delete('diagnostic')
  location.search = nextParams.toString()
}

slider.addEventListener('input', () => {
  setWidth(Number.parseInt(slider.value, 10))
})

select.addEventListener('change', () => {
  navigateToCorpus(select.value)
})

window.__CORPUS_READY__ = false
window.__CORPUS_REPORT__ = withRequestId({ status: 'error', message: 'Pending initial layout' })
reportEl.textContent = ''
stats.textContent = 'Loading...'
history.replaceState(null, '', `${location.pathname}${location.search}`)

async function init(): Promise<void> {
  try {
    corpusList = await loadSources()
    if (corpusList.length === 0) {
      throw new Error('No corpora found')
    }

    const selected = corpusList.find(meta => meta.id === requestedCorpusId) ?? corpusList[0]!
    await loadCorpus(selected)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setError(message)
  }
}

void init()
