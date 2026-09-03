import { type ChildProcess } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import {
  acquireBrowserAutomationLock,
  ensurePageServer,
  getAvailablePort,
  loadPostedReport,
  type AutomationBrowserKind,
  type BrowserKind,
} from './browser-automation.ts'
import { startPostedReportServer } from './report-server.ts'
import { createOracleSession, type OracleSession, type OracleTransport } from './oracle-session.ts'
import { type ProbeOracleCase } from '../src/test-data.ts'

type ProbeReport = {
  status: 'ready' | 'error'
  requestId?: string
  browserLineMethod?: 'range' | 'span'
  width?: number
  predictedHeight?: number
  actualHeight?: number
  diffPx?: number
  predictedLineCount?: number
  browserLineCount?: number
  firstBreakMismatch?: {
    line: number
    deltaText: string
    reasonGuess: string
    oursText: string
    browserText: string
  } | null
  extractorSensitivity?: string | null
  message?: string
}

type ProbeBatchReport = {
  status: 'ready' | 'error'
  requestId?: string
  results?: Array<{
    label: string
    report: ProbeReport
  }>
  message?: string
  environment?: { userAgent: string, devicePixelRatio: number, visibilityState: string }
}

function parseStringFlag(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find(value => value.startsWith(prefix))
  return arg === undefined ? null : arg.slice(prefix.length)
}

function parseNumberFlag(name: string, fallback: number): number {
  const raw = parseStringFlag(name)
  if (raw === null) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid value for --${name}: ${raw}`)
  return parsed
}

function parseBrowsers(value: string | null, transport: OracleTransport): AutomationBrowserKind[] {
  const defaults: AutomationBrowserKind[] = transport === 'native' ? ['chrome', 'safari'] : ['chrome']
  if (value === null || value.trim().length === 0) return defaults
  const browsers: AutomationBrowserKind[] = []
  for (const part of value.split(',')) {
    const browser = part.trim().toLowerCase()
    switch (browser) {
      case '': break
      case 'chrome':
      case 'safari':
      case 'firefox': browsers.push(browser); break
      default: throw new Error(`Unsupported browser ${browser}`)
    }
  }
  return browsers
}

type OracleSuite = { batch: string, cases: readonly ProbeOracleCase[], compareBreaks: boolean }

function printCaseResult(browser: AutomationBrowserKind, testCase: ProbeOracleCase, report: ProbeReport): void {
  if (report.status === 'error') {
    console.log(`${browser} | ${testCase.label}: error: ${report.message ?? 'unknown error'}`)
    return
  }

  const sensitivity =
    report.extractorSensitivity === null || report.extractorSensitivity === undefined
      ? ''
      : ` | note: ${report.extractorSensitivity}`

  console.log(
    `${browser} | ${testCase.label}: diff ${report.diffPx}px | lines ${report.predictedLineCount}/${report.browserLineCount} | height ${report.predictedHeight}/${report.actualHeight}${sensitivity}`,
  )

  if (report.firstBreakMismatch !== null && report.firstBreakMismatch !== undefined) {
    console.log(
      `  break L${report.firstBreakMismatch.line}: ${report.firstBreakMismatch.reasonGuess} | ` +
      `delta ${JSON.stringify(report.firstBreakMismatch.deltaText)} | ` +
      `ours ${JSON.stringify(report.firstBreakMismatch.oursText)} | ` +
      `browser ${JSON.stringify(report.firstBreakMismatch.browserText)}`,
    )
  }
}

function reportIsExact(report: ProbeReport, compareBreaks: boolean): boolean {
  return (
    report.status === 'ready' &&
    report.diffPx === 0 &&
    report.predictedLineCount === report.browserLineCount &&
    report.predictedHeight === report.actualHeight &&
    (!compareBreaks || report.firstBreakMismatch === null)
  )
}

function caseRunsInBrowser(testCase: ProbeOracleCase, browser: AutomationBrowserKind): boolean {
  return testCase.browsers === undefined || testCase.browsers.includes(browser)
}

async function runBrowser(suite: OracleSuite, browser: AutomationBrowserKind, port: number, timeoutMs: number, transport: OracleTransport): Promise<{ ok: boolean, report: ProbeBatchReport }> {
  const lock = await acquireBrowserAutomationLock(browser)
  const reportBrowser: BrowserKind | null = browser === 'firefox' ? null : browser
  let session: OracleSession | null = null
  let serverProcess: ChildProcess | null = null
  let ok = true

  try {
    if (reportBrowser === null) {
      throw new Error('Firefox is not currently supported for these oracle checks')
    }
    session = await createOracleSession(reportBrowser, transport)

    const pageServer = await ensurePageServer(port, '/probe', process.cwd())
    serverProcess = pageServer.process
    const requestId = `${browser}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const reportServer = await startPostedReportServer<ProbeBatchReport>(requestId)

    try {
      const url =
        `${pageServer.baseUrl}/probe?batch=${encodeURIComponent(suite.batch)}` +
        `&requestId=${encodeURIComponent(requestId)}` +
        `&reportEndpoint=${encodeURIComponent(reportServer.endpoint)}`
      const batchReport = await loadPostedReport(
        session,
        url,
        () => reportServer.waitForReport(null),
        requestId,
        reportBrowser,
        timeoutMs,
      )
      if (batchReport.status === 'error') {
        throw new Error(batchReport.message ?? `${suite.batch} batch failed`)
      }
      console.log(`${browser} | ${transport} | ${JSON.stringify(batchReport.environment)}`)

      const batchResults = batchReport.results ?? []
      for (const testCase of suite.cases) {
        if (!caseRunsInBrowser(testCase, browser)) continue
        const report = batchResults.find(result => result.label === testCase.label)?.report
        if (report === undefined) {
          throw new Error(`Missing ${suite.batch} result for ${testCase.label}`)
        }
        printCaseResult(browser, testCase, report)
        if (!reportIsExact(report, suite.compareBreaks)) ok = false
      }
      return { ok, report: batchReport }
    } finally {
      reportServer.close()
    }
  } finally {
    try {
      await session?.close()
    } finally {
      serverProcess?.kill()
      lock.release()
    }
  }
}

export async function runOracleSuite(suite: OracleSuite): Promise<void> {
  const requestedPort = parseNumberFlag('port', 0)
  const transport = parseStringFlag('transport') ?? 'native'
  if (transport !== 'native' && transport !== 'playwright') throw new Error(`Unsupported oracle transport ${transport}`)
  const browsers = parseBrowsers(parseStringFlag('browser'), transport)
  if (browsers.includes('firefox')) throw new Error('These compact oracle suites currently cover Chrome and Safari.')
  if (transport === 'playwright' && browsers.some(browser => browser !== 'chrome')) {
    throw new Error('The portable oracle transport currently targets installed Chrome. Use --browser=chrome or native Safari automation.')
  }
  const timeoutMs = parseNumberFlag('timeout', 60_000)
  const port = await getAvailablePort(requestedPort === 0 ? null : requestedPort)
  let overallOk = true
  const reports: { browser: BrowserKind, report: ProbeBatchReport }[] = []
  for (const browser of browsers) {
    const result = await runBrowser(suite, browser, port, timeoutMs, transport)
    reports.push({ browser, report: result.report })
    if (!result.ok) overallOk = false
  }
  const output = parseStringFlag('output')
  if (output !== null) writeFileSync(output, JSON.stringify({ suite: suite.batch, transport, reports }, null, 2))
  if (!overallOk) process.exitCode = 1
}
