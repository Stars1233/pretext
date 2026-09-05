import { generateCases } from './cases.ts'
import { samePreparation, type ContractFailure, type Prediction } from './contracts.ts'
import { assess, observeNative } from './observe.ts'
import type { BrowserConfig, BrowserContext, BrowserFailure, BrowserReport, CaseResult, FontFixture, WrappingCase } from './types.ts'

type Variant = {
  name: string
  prepare(input: WrappingCase): (input: WrappingCase) => Prediction
  checkRichContracts(input: { font: string; letterSpacing: number }, includeStructure?: boolean): { failures: ContractFailure[]; passedContracts: string[] }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected configuration object.')
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected configuration string.')
  return value
}

function parseConfig(value: unknown): BrowserConfig {
  const config = object(value)
  const browser = config['browser']
  const schedule = config['schedule']
  const direction = config['direction']
  const family = config['family']
  const caseId = config['caseId']
  const rawContext = object(config['context'])
  let context: BrowserContext
  switch (rawContext['kind']) {
    case 'fixtures': context = { kind: 'fixtures' }; break
    case 'installed': context = { kind: 'installed', lang: string(rawContext['lang']) }; break
    default: throw new Error('Unknown browser context.')
  }
  const fonts = config['fonts']
  if (browser !== 'chrome' && browser !== 'safari' && browser !== 'firefox') throw new Error('Unknown browser.')
  if (schedule !== 'ordinary' && schedule !== 'full') throw new Error('Unknown schedule.')
  if (direction !== 'ltr' && direction !== 'rtl') throw new Error('Unknown direction.')
  if (family !== null && typeof family !== 'string') throw new Error('Unknown family filter.')
  if (caseId !== null && typeof caseId !== 'string') throw new Error('Unknown case filter.')
  if (!Array.isArray(fonts)) throw new Error('Expected font fixtures.')
  const fixtures: FontFixture[] = []
  for (const value of fonts) {
    const font = object(value)
    fixtures.push({ family: string(font['family']), weight: string(font['weight']), url: string(font['url']), sha256: string(font['sha256']) })
  }
  return { requestId: string(config['requestId']), browser, schedule, direction, context, family, caseId, fonts: fixtures }
}

async function post(path: string, data: unknown): Promise<void> {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
  if (!response.ok) throw new Error(`Report transport ${path}: HTTP ${response.status}`)
}

async function loadFonts(fixtures: FontFixture[]): Promise<void> {
  await Promise.all(fixtures.map(async fixture => {
    const response = await fetch(fixture.url)
    if (!response.ok) throw new Error(`Font ${fixture.family}: HTTP ${response.status}`)
    const bytes = await response.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    if (sha256 !== fixture.sha256) throw new Error(`Font bytes changed for ${fixture.family}.`)
    const face = new FontFace(fixture.family, bytes, { weight: fixture.weight })
    await face.load()
    document.fonts.add(face)
  }))
  await document.fonts.ready
}

export async function runBrowser(variants: Variant[]): Promise<void> {
  const progress = document.createElement('pre')
  document.body.append(progress)
  try {
    const response = await fetch('/config')
    if (!response.ok) throw new Error(`Configuration HTTP ${response.status}`)
    const rawConfig: unknown = await response.json()
    const config = parseConfig(rawConfig)
    // The engine profile may inspect document direction during preparation.
    // Each direction therefore runs on a fresh page before any API is called.
    document.documentElement.dir = config.direction
    const fonts = config.context.kind === 'fixtures' ? config.fonts : []
    if (config.context.kind === 'fixtures') document.documentElement.removeAttribute('lang')
    else document.documentElement.lang = config.context.lang
    await loadFonts(fonts)
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('Canvas 2D is unavailable.')
    const generated = generateCases((text, font, letterSpacing) => {
      context.font = font
      context.direction = config.direction
      context.letterSpacing = `${letterSpacing}px`
      return context.measureText(text).width
    }, {
      schedule: config.schedule, browser: config.browser, direction: config.direction,
      ...(config.family === null ? {} : { family: config.family }),
    })
    const selected = config.caseId === null ? generated : generated.filter(input => input.id === config.caseId)
    const browserContext = config.context
    const inputs = selected.filter(input => browserContext.kind === 'fixtures' ? input.context === undefined : input.context?.lang === browserContext.lang)
    const contexts: BrowserReport['contexts'] = []
    for (const input of selected) {
      const context = input.context
      if (context !== undefined && !contexts.some(value => value.lang === context.lang)) contexts.push(context)
    }
    contexts.sort((a, b) => a.lang.localeCompare(b.lang))
    if (selected.length === 0 && config.caseId === null && config.family === null) throw new Error('The selected schedule unexpectedly contains no cases.')
    const richContracts: BrowserReport['richContracts'] = []
    const batch: CaseResult[] = []
    const richContexts: Array<{ font: string; letterSpacing: number; includeStructure: boolean }> = []
    for (const input of config.context.kind === 'fixtures' ? selected : []) {
      if (input.detail === 'height') continue
      if (!richContexts.some(context => context.font === input.font)) richContexts.push({ font: input.font, letterSpacing: 0, includeStructure: true })
      if (!richContexts.some(context => context.font === input.font && context.letterSpacing === input.letterSpacing)) richContexts.push({ font: input.font, letterSpacing: input.letterSpacing, includeStructure: false })
    }
    for (let index = 0; index < inputs.length;) {
      const first = inputs[index]!
      let end = index + 1
      while (end < inputs.length && samePreparation(first, inputs[end]!)) end++
      // Each group owns its prepared handles. A preparation failure belongs to
      // every affected input, while other candidates still observe the group.
      const preparedVariants = variants.map<{ name: string; predict: (input: WrappingCase) => Prediction } | { name: string; error: string }>(variant => {
        try {
          return { name: variant.name, predict: variant.prepare(first) }
        } catch (error) {
          return { name: variant.name, error: error instanceof Error ? error.stack ?? error.message : String(error) }
        }
      })
      for (; index < end; index++) {
        const input = inputs[index]!
        const native = observeNative(input)
        const predictions: CaseResult['predictions'] = []
        for (const variant of preparedVariants) {
          if ('error' in variant) {
            predictions.push({ name: variant.name, error: variant.error })
            continue
          }
          try {
            const prediction = variant.predict(input)
            predictions.push({ name: variant.name, prediction, assessment: assess(input, native, prediction, config.browser) })
          } catch (error) {
            predictions.push({ name: variant.name, error: error instanceof Error ? error.stack ?? error.message : String(error) })
          }
        }
        batch.push({ input, native, predictions })
        if (batch.length === 128 || index === inputs.length - 1) {
          await post('/rows', batch)
          batch.length = 0
          progress.textContent = `${index + 1}/${inputs.length}`
          await post('/progress', { completed: index + 1, total: inputs.length })
          await new Promise<void>(resolve => setTimeout(resolve, 0))
        }
      }
    }
    for (const { font, letterSpacing, includeStructure } of richContexts) {
      for (const variant of variants) richContracts.push({ name: variant.name, font, letterSpacing, ...variant.checkRichContracts({ font, letterSpacing }, includeStructure) })
    }
    const report: BrowserReport = {
      status: 'ready', observerVersion: 1, contexts, rowCount: inputs.length, richContracts,
      environment: {
        context: config.context,
        userAgent: navigator.userAgent, dpr: devicePixelRatio,
        locale: new Intl.Segmenter().resolvedOptions().locale,
        visibility: document.visibilityState, focused: document.hasFocus(), fonts,
      },
    }
    progress.textContent = `Completed ${inputs.length} cases.`
    await post('/report', report)
  } catch (error) {
    const report: BrowserFailure = { status: 'error', message: error instanceof Error ? error.stack ?? error.message : String(error) }
    progress.textContent = report.message
    await post('/report', report)
  }
}
