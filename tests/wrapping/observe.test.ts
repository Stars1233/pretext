import { expect, test } from 'bun:test'
import type { Prediction } from './contracts.ts'
import { assess } from './observe.ts'
import type { NativeObservation, NativePoint, WrappingCase } from './types.ts'

const base: WrappingCase = {
  id: 'observer', family: 'observer', origins: ['observer-unit-test'], text: '',
  font: '16px Arial', width: 100, lineHeight: 48, whiteSpace: 'normal', wordBreak: 'normal',
  letterSpacing: 0, direction: 'ltr', scope: 'supported',
}

function prediction(normalized: string, spans: Array<[string, number, number]>): Extract<Prediction, { detail: 'full' }> {
  return {
    detail: 'full', normalized, height: spans.length * 48, countedHeight: spans.length * 48, lineCount: spans.length, contracts: [], passedContracts: [], diagnostics: [],
    lines: spans.map(([text, sourceStart, sourceEnd]) => ({
      text, sourceStart, sourceEnd, width: 10,
      start: { segmentIndex: sourceStart, graphemeIndex: 0 },
      end: { segmentIndex: sourceEnd, graphemeIndex: 0 },
    })),
  }
}

function point(text: string, start: number, line: number): NativePoint {
  return { text, start, end: start + text.length, rects: [{ x: 0, y: 15 + line * 48, width: 10, height: 17 }] }
}

function native(points: NativePoint[], lineCount: number): NativeObservation {
  return { points, lineCount, height: lineCount * 48, lineRects: [] }
}

test('rich inline height is independently observed and cannot inherit a flat or API pass', () => {
  const input: WrappingCase = { ...base, text: '\u200Bhello', parts: ['\u200B', 'hello'], nativeItems: true }
  const oracle = { ...native([], 2), richHeight: 3 * 48 }
  const flat = prediction(input.text, [['\u200Bhel', 0, 4], ['lo', 4, 6]])
  const wrongRich = assess(input, oracle, { ...flat, richLineCount: 2 }, 'safari')
  expect(wrongRich.height.status).toBe('pass')
  expect(wrongRich.api.status).toBe('pass')
  expect(wrongRich.richHeight.status).toBe('fail')
  expect(assess(input, oracle, { ...flat, richLineCount: 3 }, 'safari').richHeight.status).toBe('pass')
  expect(assess(input, oracle, flat, 'safari').richHeight.status).toBe('unobserved')
  expect(assess(input, native([], 2), { ...flat, richLineCount: 3 }, 'safari').richHeight.status).toBe('unobserved')
  expect(assess(base, oracle, flat, 'safari').richHeight.status).toBe('not-applicable')
})

test('fractional CSS line boxes use an independently observed native advance', () => {
  const input: WrappingCase = { ...base, text: 'abc', lineHeight: 20.96 }
  const oracle: NativeObservation = { height: 60, lineCount: 3, usedLineHeight: 20, lineRects: [], points: [
    { text: 'c', start: 2, end: 3, rects: [{ x: 0, y: 43, width: 10, height: 14 }] },
  ] }
  const predicted = { ...prediction('abc', [['a', 0, 1], ['b', 1, 2], ['c', 2, 3]]), height: 62.88, countedHeight: 62.88 }
  expect(assess(input, oracle, predicted, 'safari').height.status).toBe('pass')
  expect(assess(input, oracle, predicted, 'safari').lineCount.status).toBe('pass')
  expect(assess(input, oracle, predicted, 'safari').source.status).toBe('pass')
  expect(assess(input, oracle, { ...predicted, height: 41.92 }, 'safari').height.status).toBe('fail')
})

test('raw collapsed whitespace and astral scalars retain normalized source coordinates', () => {
  const input = { ...base, text: ' \tab \ncd  ' }
  const oracle = native([point('a', 2, 0), point('b', 3, 0), point('c', 6, 1), point('d', 7, 1)], 2)
  expect(assess(input, oracle, prediction('ab cd', [['ab', 0, 3], ['cd', 3, 5]]), 'chrome').source.status).toBe('pass')
  expect(assess(input, oracle, prediction('abcd', [['ab', 0, 2], ['cd', 2, 4]]), 'chrome').source.status).toBe('fail')
  const astral = { ...base, text: '🙂b' }
  expect(assess(astral, native([point('🙂', 0, 0), point('b', 2, 1)], 2), prediction('🙂b', [['🙂', 0, 2], ['b', 2, 3]]), 'chrome').source.status).toBe('pass')
})

test('ambiguous observations stay unknown, while an observed mismatch is still a failure', () => {
  const input = { ...base, text: 'ab' }
  const ambiguous = point('b', 1, 0)
  ambiguous.rects.push(...point('b', 1, 1).rects)
  const oracle = native([point('a', 0, 0), ambiguous], 2)
  expect(assess(input, oracle, prediction('ab', [['a', 0, 1], ['b', 1, 2]]), 'chrome').source.status).toBe('unobserved')
  expect(assess(input, oracle, prediction('ab', [['', 0, 0], ['ab', 0, 2]]), 'chrome').source.status).toBe('fail')
})

test('normalized native corpus observations retain the raw preparation contract', () => {
  const input: WrappingCase = { ...base, text: '\nab\ncd\n', nativeSource: 'normalized' }
  const oracle = native([point('a', 0, 0), point('b', 1, 0), point('c', 3, 1), point('d', 4, 1)], 2)
  expect(assess(input, oracle, prediction('ab cd', [['ab', 0, 3], ['cd', 3, 5]]), 'chrome').source.status).toBe('pass')
  expect(assess(input, oracle, prediction('abcd', [['ab', 0, 2], ['cd', 2, 4]]), 'chrome').source.status).toBe('fail')
})

test('Safari selected SHY uses corroborating whole-line geometry despite overlapping scalar rectangles', () => {
  // Captured Safari Arial 16, pre-wrap, width 14.233333110809326. Range assigns
  // part of the a advance to SHY; individual rectangles are not glyph boxes.
  const input = { ...base, text: 'a\u00adb', whiteSpace: 'pre-wrap' as const, width: 14.233333110809326 }
  const oracle: NativeObservation = {
    height: 96, lineCount: 2,
    points: [
      { text: 'a', start: 0, end: 1, rects: [{ x: 0, y: 15, width: 5, height: 17 }] },
      { text: '\u00ad', start: 1, end: 2, rects: [{ x: 4, y: 15, width: 10.21875, height: 17 }] },
      { text: 'b', start: 2, end: 3, rects: [{ x: 14, y: 15, width: 0, height: 17 }, { x: 0, y: 63, width: 8.8984375, height: 17 }] },
    ],
    lineRects: [{ x: 0, y: 15, width: 14.2265625, height: 17 }, { x: 0, y: 63, width: 8.8984375, height: 17 }],
  }
  expect(assess(input, oracle, prediction(input.text, [['a-', 0, 2], ['b', 2, 3]]), 'safari').hyphen.status).toBe('pass')
  expect(assess(input, oracle, prediction(input.text, [['a', 0, 1], ['b', 1, 3]]), 'safari').hyphen.status).toBe('fail')
  expect(assess(input, { ...oracle, lineRects: [] }, prediction(input.text, [['a-', 0, 2], ['b', 2, 3]]), 'safari').hyphen.status).toBe('unobserved')
})

test('same-line SHY is hidden; repeated SHY requires a different native selection oracle', () => {
  const input = { ...base, text: 'a\u00adb' }
  const oracle = native([point('a', 0, 0), point('\u00ad', 1, 0), point('b', 2, 0)], 1)
  expect(assess(input, oracle, prediction(input.text, [['ab', 0, 3]]), 'safari').hyphen.status).toBe('pass')
  expect(assess(input, oracle, prediction(input.text, [['a-b', 0, 3]]), 'safari').hyphen.status).toBe('fail')
  expect(assess({ ...input, text: 'a\u00ad\u00adb' }, oracle, prediction('a\u00ad\u00adb', [['ab', 0, 4]]), 'safari').hyphen.status).toBe('unobserved')
})

test('maintained discretionary text and whole-line widths remain independent enforced checks', () => {
  const input: WrappingCase = { ...base, text: 'abc\u00ad', letterSpacing: -1, discretionary: { expectedText: ['abc'] } }
  const oracle = native([point('a', 0, 0), point('b', 1, 0), point('c', 2, 0)], 1)
  oracle.lineRects = [{ x: 0, y: 15, width: 10, height: 17 }]
  const correct = prediction(input.text, [['abc', 0, 4]])
  expect(assess(input, oracle, correct, 'safari').widths.status).toBe('pass')
  expect(assess(input, oracle, correct, 'safari').hyphen.status).toBe('pass')
  const wrongText = prediction(input.text, [['abc-', 0, 4]])
  expect(assess(input, oracle, wrongText, 'safari').hyphen.status).toBe('fail')
  const wrongWidth = { ...oracle, lineRects: [{ x: 0, y: 15, width: 10.03, height: 17 }] }
  expect(assess(input, wrongWidth, correct, 'safari').widths.status).toBe('fail')
  const { discretionary: _checked, ...genericInput } = input
  expect(assess(genericInput, oracle, correct, 'safari').widths.status).toBe('unobserved')
})

test('nonfinite predicted widths cannot pass through a NaN tolerance comparison', () => {
  const input = { ...base, text: 'a' }
  const predicted = prediction('a', [['a', 0, 1]])
  predicted.lines[0]!.width = Number.NaN
  const oracle = native([point('a', 0, 0)], 1)
  oracle.lineRects = [{ x: 0, y: 15, width: 10, height: 17 }]
  expect(assess(input, oracle, predicted, 'chrome').widths.status).toBe('fail')
})

test('maintained height criteria keep their original exact and rounding semantics', () => {
  const input = { ...base, text: 'a' }
  const predicted = prediction('a', [['a', 0, 1]])
  const oracle = { ...native([point('a', 0, 0)], 1), height: predicted.height - 0.75 }
  expect(assess({ ...input, heightMode: 'exact' }, oracle, predicted, 'chrome').height.status).toBe('fail')
  expect(assess({ ...input, heightMode: 'accuracy' }, oracle, predicted, 'chrome').height.status).toBe('pass')
  expect(assess({ ...input, heightMode: 'corpus' }, oracle, predicted, 'chrome').height.status).toBe('fail')
  expect(assess({ ...input, heightMode: 'accuracy' }, { ...oracle, height: predicted.height - 1 }, predicted, 'chrome').height.status).toBe('fail')
})

test('selected line extraction independently checks count and normalized source breaks', () => {
  const input: WrappingCase = { ...base, text: 'ab cd', lineMethod: 'span' }
  const oracle = { ...native([point('a', 0, 0), point('b', 1, 0), point('c', 3, 1), point('d', 4, 1)], 2), extractedLines: [{ start: 0, end: 2 }, { start: 3, end: 5 }] }
  const correct = prediction(input.text, [['ab', 0, 3], ['cd', 3, 5]])
  expect(assess(input, oracle, correct, 'chrome').lineCount.status).toBe('pass')
  expect(assess(input, oracle, correct, 'chrome').breaks.status).toBe('pass')
  const wrong = prediction(input.text, [['a', 0, 1], ['b cd', 1, 5]])
  expect(assess(input, oracle, wrong, 'chrome').lineCount.status).toBe('pass')
  expect(assess(input, oracle, wrong, 'chrome').breaks.status).toBe('fail')
  const countMismatch = { ...oracle, extractedLines: [{ start: 0, end: 5 }] }
  expect(assess(input, countMismatch, correct, 'chrome').height.status).toBe('pass')
  expect(assess(input, countMismatch, correct, 'chrome').lineCount.status).toBe('fail')
  expect(assess(input, native(oracle.points, 2), correct, 'chrome').lineCount.status).toBe('unobserved')
})

test('legacy geometry uses its actual layout height and materialized line count', () => {
  const input: WrappingCase = { ...base, text: 'a', heightMode: 'exact', heightSource: 'layout', lineMethod: 'span' }
  const oracle = { ...native([point('a', 0, 0)], 1), extractedLines: [{ start: 0, end: 1 }] }
  const result = { ...prediction('a', [['a', 0, 1]]), height: 96, lineCount: 2 }
  expect(assess(input, oracle, result, 'chrome').height.status).toBe('pass')
  expect(assess(input, oracle, result, 'chrome').lineCount.status).toBe('pass')
  expect(assess(input, oracle, { ...result, countedHeight: 96 }, 'chrome').height.status).toBe('fail')
  const discretionary = { ...input, heightSource: 'lines' as const, discretionary: { expectedText: ['a'] } }
  expect(assess(discretionary, oracle, { ...result, countedHeight: 96 }, 'chrome').height.status).toBe('pass')
})
