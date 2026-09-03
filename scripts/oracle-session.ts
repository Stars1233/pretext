import { chromium } from 'playwright-core'
import { createBrowserSession, type BrowserKind, type BrowserSession } from './browser-automation.ts'

export type OracleTransport = 'native' | 'playwright'
export type OracleSession = Omit<BrowserSession, 'close'> & { close: () => void | Promise<void> }

export async function createOracleSession(browser: BrowserKind, transport: OracleTransport): Promise<OracleSession> {
  switch (transport) {
    case 'native':
      return createBrowserSession(browser)
    case 'playwright': {
      if (browser !== 'chrome') throw new Error('The portable oracle transport currently targets installed Chrome. Use native automation for Safari.')
      const instance = await chromium.launch({ channel: 'chrome', headless: false })
      try {
        const context = await instance.newContext({ viewport: null })
        const page = await context.newPage()
        return {
          async navigate(url) {
            await page.goto(url, { waitUntil: 'domcontentloaded' })
          },
          readLocationUrl: () => page.url(),
          close: () => instance.close(),
        }
      } catch (error) {
        await instance.close()
        throw error
      }
    }
  }
}
