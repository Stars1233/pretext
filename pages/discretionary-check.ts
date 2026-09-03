import { prepareWithSegments, layoutWithLines } from '../src/layout.ts'
import { buildNavigationPhaseHash } from '../shared/navigation-state.ts'

type CheckCase = {
  label: string
  text: string
  width: number
  whiteSpace?: 'normal' | 'pre-wrap'
  letterSpacing?: number
  expectedText?: string[] // Omit for documented browser-dependent cases.
}
const cases: CheckCase[] = [
  { label: 'trailing', text: 'abc\u00AD', width: 100, expectedText: ['abc'] },
  { label: 'trailing positive spacing', text: 'abc\u00AD', width: 100, letterSpacing: 2, expectedText: ['abc'] },
  { label: 'trailing negative spacing', text: 'abc\u00AD', width: 100, letterSpacing: -1, expectedText: ['abc'] },
  { label: 'trailing pre-wrap', text: 'abc\u00AD', width: 100, whiteSpace: 'pre-wrap', expectedText: ['abc'] },
  { label: 'trailing repeated', text: 'abc\u00AD\u00AD', width: 100, expectedText: ['abc'] },
  { label: 'unchosen internal', text: 'abc\u00ADdef', width: 100, expectedText: ['abcdef'] },
  { label: 'forced hard break', text: 'abc\u00AD\nx', width: 100, whiteSpace: 'pre-wrap', expectedText: ['abc', 'x'] },
  { label: 'chosen fitting break', text: 'ab\u00ADcdef', width: 24, expectedText: ['ab-', 'cd', 'ef'] },
  { label: 'pending below hyphen fit', text: 'ab\u00ADcdef', width: 20 },
  { label: 'pending narrow prefix', text: 'ab\u00ADcdef', width: 12 },
  { label: 'trailing emergency', text: 'abc\u00AD', width: 12 },
]
const params = new URLSearchParams(location.search)
const requestId = params.get('requestId') ?? undefined
const font = '16px Arial'
const lineHeight = 24
await document.fonts.load(font)
await document.fonts.ready
location.hash = buildNavigationPhaseHash('measuring', requestId)
const results = []
let failed = 0
for (const testCase of cases) {
  const whiteSpace = testCase.whiteSpace ?? 'normal'
  const letterSpacing = testCase.letterSpacing ?? 0
  const element = document.createElement('div')
  Object.assign(element.style, { position: 'absolute', left: '0', top: '0', visibility: 'hidden', width: `${testCase.width}px`,
    font, lineHeight: `${lineHeight}px`, letterSpacing: `${letterSpacing}px`, whiteSpace, wordBreak: 'normal', overflowWrap: 'break-word', hyphens: 'manual' })
  element.textContent = testCase.text
  document.body.appendChild(element)
  const node = element.firstChild!
  const range = document.createRange()
  range.selectNodeContents(node)
  const rects = [...range.getClientRects()].map(rect => ({ left: rect.left, top: rect.top, width: rect.width }))
  // Chromium returns a separate rectangle for a chosen hyphen. Union by line
  // top; character-sized SHY ranges are unreliable in Safari, even unchosen.
  const lines: Array<{ top: number; left: number; right: number }> = []
  for (const rect of rects) {
    const line = lines.find(value => Math.abs(value.top - rect.top) < 0.5)
    if (line === undefined) lines.push({ top: rect.top, left: rect.left, right: rect.left + rect.width })
    else { line.left = Math.min(line.left, rect.left); line.right = Math.max(line.right, rect.left + rect.width) }
  }
  const browserWidths = lines.map(line => line.right - line.left)
  const prepared = prepareWithSegments(testCase.text, font, { whiteSpace, letterSpacing })
  const ours = layoutWithLines(prepared, testCase.width, lineHeight).lines.map(line => ({ text: line.text, width: line.width, start: line.start, end: line.end }))
  const browserLineCount = element.getBoundingClientRect().height / lineHeight
  const exact = ours.length === browserLineCount && ours.length === browserWidths.length &&
    ours.every((line, index) => Math.abs(line.width - browserWidths[index]!) <= 0.025)
  const checked = testCase.expectedText !== undefined
  const pass = exact && (!checked || JSON.stringify(ours.map(line => line.text)) === JSON.stringify(testCase.expectedText))
  if (checked && !pass) failed++
  results.push({ ...testCase, whiteSpace, letterSpacing, checked, exact, pass, browserLineCount, browserWidths, rects, ours })
  element.remove()
}
const report = { status: 'ready', requestId, userAgent: navigator.userAgent, dpr: devicePixelRatio, failed, results }
document.getElementById('result')!.textContent = JSON.stringify(report, null, 2)
const endpoint = params.get('reportEndpoint')
if (endpoint !== null) {
  location.hash = buildNavigationPhaseHash('posting', requestId)
  await fetch(endpoint, { method: 'POST', body: JSON.stringify(report) })
}
