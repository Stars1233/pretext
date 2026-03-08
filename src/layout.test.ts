import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'

// Keep the permanent suite small and durable. These tests exercise the shipped
// prepare/layout exports with a deterministic fake canvas backend. For narrow
// browser-specific investigations, prefer throwaway probes and browser checkers
// over mirroring the full implementation here.

const FONT = '16px Test Sans'
const LINE_HEIGHT = 19

type LayoutModule = typeof import('./layout.ts')

let prepare: LayoutModule['prepare']
let prepareWithSegments: LayoutModule['prepareWithSegments']
let layout: LayoutModule['layout']
let layoutWithLines: LayoutModule['layoutWithLines']
let clearCache: LayoutModule['clearCache']

const emojiPresentationRe = /\p{Emoji_Presentation}/u
const punctuationRe = /[.,!?;:%)\]}'"”’»›…—-]/u

function parseFontSize(font: string): number {
  const match = font.match(/(\d+(?:\.\d+)?)\s*px/)
  return match ? Number.parseFloat(match[1]!) : 16
}

function isWideCharacter(ch: string): boolean {
  const code = ch.codePointAt(0)!
  return (
    (code >= 0x4E00 && code <= 0x9FFF) ||
    (code >= 0x3400 && code <= 0x4DBF) ||
    (code >= 0x3000 && code <= 0x303F) ||
    (code >= 0x3040 && code <= 0x309F) ||
    (code >= 0x30A0 && code <= 0x30FF) ||
    (code >= 0xAC00 && code <= 0xD7AF) ||
    (code >= 0xFF00 && code <= 0xFFEF)
  )
}

function measureWidth(text: string, font: string): number {
  const fontSize = parseFontSize(font)
  let width = 0

  for (const ch of text) {
    if (ch === ' ') {
      width += fontSize * 0.33
    } else if (ch === '\t') {
      width += fontSize * 1.32
    } else if (emojiPresentationRe.test(ch) || ch === '\uFE0F') {
      width += fontSize
    } else if (isWideCharacter(ch)) {
      width += fontSize
    } else if (punctuationRe.test(ch)) {
      width += fontSize * 0.4
    } else {
      width += fontSize * 0.6
    }
  }

  return width
}

class TestCanvasRenderingContext2D {
  font = ''

  measureText(text: string): { width: number } {
    return { width: measureWidth(text, this.font) }
  }
}

class TestOffscreenCanvas {
  constructor(_width: number, _height: number) {}

  getContext(_kind: string): TestCanvasRenderingContext2D {
    return new TestCanvasRenderingContext2D()
  }
}

beforeAll(async () => {
  Reflect.set(globalThis, 'OffscreenCanvas', TestOffscreenCanvas)
  const mod = await import('./layout.ts')
  ;({ prepare, prepareWithSegments, layout, layoutWithLines, clearCache } = mod)
})

beforeEach(() => {
  clearCache()
})

describe('prepare invariants', () => {
  test('whitespace-only input stays empty', () => {
    const prepared = prepare('  \t\n  ', FONT)
    expect(prepared.widths).toEqual([])
    expect(layout(prepared, 200, LINE_HEIGHT)).toEqual({ lineCount: 0, height: 0 })
  })

  test('collapses ordinary whitespace runs and trims the edges', () => {
    const prepared = prepareWithSegments('  Hello\t \n  World  ', FONT)
    expect(prepared.segments).toEqual(['Hello', ' ', 'World'])
  })

  test('keeps closing punctuation attached to the preceding word', () => {
    const prepared = prepareWithSegments('hello.', FONT)
    expect(prepared.segments).toEqual(['hello.'])
  })

  test('keeps opening quotes attached to the following word', () => {
    const prepared = prepareWithSegments('“Whenever', FONT)
    expect(prepared.segments).toEqual(['“Whenever'])
  })

  test('keeps apostrophe-led elisions attached to the following word', () => {
    const prepared = prepareWithSegments('“Take ’em downstairs', FONT)
    expect(prepared.segments).toEqual(['“Take', ' ', '’em', ' ', 'downstairs'])
  })

  test('keeps stacked opening quotes attached to the following word', () => {
    const prepared = prepareWithSegments('invented, “‘George B. Wilson', FONT)
    expect(prepared.segments).toEqual(['invented,', ' ', '“‘George', ' ', 'B.', ' ', 'Wilson'])
  })

  test('keeps em dashes breakable', () => {
    const prepared = prepareWithSegments('universe—so', FONT)
    expect(prepared.segments).toEqual(['universe', '—', 'so'])
  })

  test('applies CJK and Hangul punctuation attachment rules', () => {
    expect(prepareWithSegments('中文，测试。', FONT).segments).toEqual(['中', '文，', '测', '试。'])
    expect(prepareWithSegments('테스트입니다.', FONT).segments.at(-1)).toBe('다.')
  })

  test('prepare and prepareWithSegments agree on numeric data', () => {
    const plain = prepare('Alpha beta gamma', FONT)
    const rich = prepareWithSegments('Alpha beta gamma', FONT)
    expect(rich.widths).toEqual(plain.widths)
    expect(rich.isSpace).toEqual(plain.isSpace)
    expect(rich.breakableWidths).toEqual(plain.breakableWidths)
    expect(Array.from(rich.segLevels ?? [])).toEqual(Array.from(plain.segLevels ?? []))
  })
})

describe('layout invariants', () => {
  test('line count grows monotonically as width shrinks', () => {
    const prepared = prepare('The quick brown fox jumps over the lazy dog', FONT)
    let previous = 0

    for (const width of [320, 200, 140, 90]) {
      const { lineCount } = layout(prepared, width, LINE_HEIGHT)
      expect(lineCount).toBeGreaterThanOrEqual(previous)
      previous = lineCount
    }
  })

  test('trailing whitespace hangs past the line edge', () => {
    const prepared = prepareWithSegments('Hello ', FONT)
    const widthOfHello = prepared.widths[0]!

    expect(layout(prepared, widthOfHello, LINE_HEIGHT).lineCount).toBe(1)

    const withLines = layoutWithLines(prepared, widthOfHello, LINE_HEIGHT)
    expect(withLines.lineCount).toBe(1)
    expect(withLines.lines).toEqual([{ text: 'Hello', width: widthOfHello }])
  })

  test('breaks long words at grapheme boundaries and keeps both layout APIs aligned', () => {
    const prepared = prepareWithSegments('Superlongword', FONT)
    const graphemeWidths = prepared.breakableWidths[0]!
    const maxWidth = graphemeWidths[0]! + graphemeWidths[1]! + graphemeWidths[2]! + 0.1

    const plain = layout(prepared, maxWidth, LINE_HEIGHT)
    const rich = layoutWithLines(prepared, maxWidth, LINE_HEIGHT)

    expect(plain.lineCount).toBeGreaterThan(1)
    expect(rich.lineCount).toBe(plain.lineCount)
    expect(rich.height).toBe(plain.height)
    expect(rich.lines.map(line => line.text).join('')).toBe('Superlongword')
  })

  test('mixed-direction text is a stable smoke test', () => {
    const prepared = prepareWithSegments('According to محمد الأحمد, the results improved.', FONT)
    const result = layoutWithLines(prepared, 120, LINE_HEIGHT)

    expect(result.lineCount).toBeGreaterThanOrEqual(1)
    expect(result.height).toBe(result.lineCount * LINE_HEIGHT)
    expect(result.lines.map(line => line.text).join('')).toBe('According to محمد الأحمد, the results improved.')
  })
})
