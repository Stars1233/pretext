import { isDiscretionaryLineEnd } from './line-break.js'
import type { PreparedTextWithSegments } from './layout.js'

let sharedGraphemeSegmenter: Intl.Segmenter | null = null
let sharedLineTextCaches = new WeakMap<PreparedTextWithSegments, Map<number, string[]>>()

function getSharedGraphemeSegmenter(): Intl.Segmenter {
  if (sharedGraphemeSegmenter === null) {
    sharedGraphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  }
  return sharedGraphemeSegmenter
}

function getSegmentGraphemes(
  segmentIndex: number,
  segments: string[],
  cache: Map<number, string[]>,
): string[] {
  let graphemes = cache.get(segmentIndex)
  if (graphemes !== undefined) return graphemes

  graphemes = []
  const graphemeSegmenter = getSharedGraphemeSegmenter()
  for (const gs of graphemeSegmenter.segment(segments[segmentIndex]!)) {
    graphemes.push(gs.segment)
  }
  cache.set(segmentIndex, graphemes)
  return graphemes
}

function appendSegmentGraphemeRange(
  text: string,
  graphemes: string[],
  startGraphemeIndex: number,
  endGraphemeIndex: number,
): string {
  for (let i = startGraphemeIndex; i < endGraphemeIndex; i++) {
    text += graphemes[i]!
  }
  return text
}

export function getLineTextCache(prepared: PreparedTextWithSegments): Map<number, string[]> {
  let cache = sharedLineTextCaches.get(prepared)
  if (cache !== undefined) return cache

  cache = new Map<number, string[]>()
  sharedLineTextCaches.set(prepared, cache)
  return cache
}

export function buildLineTextFromRange(
  prepared: PreparedTextWithSegments,
  cache: Map<number, string[]>,
  startSegmentIndex: number,
  startGraphemeIndex: number,
  endSegmentIndex: number,
  endGraphemeIndex: number,
): string {
  let text = ''
  for (let i = startSegmentIndex; i < endSegmentIndex; i++) {
    if (prepared.kinds[i] === 'soft-hyphen' || prepared.kinds[i] === 'hard-break') continue
    if (i === startSegmentIndex && startGraphemeIndex > 0) {
      const graphemes = getSegmentGraphemes(i, prepared.segments, cache)
      text = appendSegmentGraphemeRange(text, graphemes, startGraphemeIndex, graphemes.length)
    } else {
      text += prepared.segments[i]!
    }
  }

  if (endGraphemeIndex > 0) {
    const graphemes = getSegmentGraphemes(endSegmentIndex, prepared.segments, cache)
    text = appendSegmentGraphemeRange(
      text,
      graphemes,
      startSegmentIndex === endSegmentIndex ? startGraphemeIndex : 0,
      endGraphemeIndex,
    )
  }

  return isDiscretionaryLineEnd(prepared.kinds, endSegmentIndex, endGraphemeIndex) ? text + '-' : text
}

export function clearLineTextCaches(): void {
  sharedGraphemeSegmenter = null
  sharedLineTextCaches = new WeakMap<PreparedTextWithSegments, Map<number, string[]>>()
}
