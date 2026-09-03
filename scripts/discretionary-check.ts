import { type ChildProcess } from 'node:child_process'
import {
  acquireBrowserAutomationLock, createBrowserSession, ensurePageServer, getAvailablePort,
  loadPostedReport, type BrowserKind, type BrowserSession,
} from './browser-automation.ts'
import { startPostedReportServer } from './report-server.ts'

type CheckReport = {
  status: 'ready'
  requestId: string
  dpr: number
  failed: number
  results: Array<{ label: string; checked: boolean; exact: boolean; pass: boolean; browserWidths: number[]; ours: Array<{ text: string; width: number }> }>
}
const browserFlag = process.argv.find(arg => arg.startsWith('--browser='))?.slice(10) ?? 'chrome'
if (browserFlag !== 'chrome' && browserFlag !== 'safari' && browserFlag !== 'firefox') throw new Error('Expected --browser=chrome, safari, or firefox')
const browser: BrowserKind = browserFlag
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9)
const lock = await acquireBrowserAutomationLock(browser)
let session: BrowserSession | null = null
let serverProcess: ChildProcess | null = null
try {
  session = createBrowserSession(browser, { foreground: false })
  const server = await ensurePageServer(await getAvailablePort(), '/discretionary-check', process.cwd())
  serverProcess = server.process
  const requestId = `${browser}-${Date.now()}`
  const reportServer = await startPostedReportServer<CheckReport>(requestId)
  try {
    const url = new URL('/discretionary-check', server.baseUrl)
    url.searchParams.set('requestId', requestId)
    url.searchParams.set('reportEndpoint', reportServer.endpoint)
    const report = await loadPostedReport(session, url.href, () => reportServer.waitForReport(null), requestId, browser, 60000)
    if (output !== undefined) await Bun.write(output, JSON.stringify(report, null, 2) + '\n')
    const checked = report.results.filter(result => result.checked).length
    console.log(`${browser}: ${checked - report.failed}/${checked} exact checked cases (DPR ${report.dpr})`)
    for (const row of report.results) {
      if (!row.checked || !row.pass) console.log(JSON.stringify({ ...row, kind: row.checked ? 'failure' : 'browser-dependent characterization' }))
    }
    if (report.failed > 0) process.exitCode = 1
  } finally {
    reportServer.close()
  }
} finally {
  try {
    session?.close()
  } finally {
    serverProcess?.kill()
    lock.release()
  }
}
