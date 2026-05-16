/**
 * lib/harness/safety/v2/e2e/puppeteer-factory.ts
 *
 * Real Puppeteer BrowserFactory for the Safety Agent E2E runner.
 *
 * Implements the Browser/BrowserPage interfaces from types.ts using puppeteer.
 * Tests should inject the fake factory from e2e-runner.test.ts instead of
 * importing this module (this file pulls in the puppeteer dependency).
 *
 * Cookie injection: newPage() accepts opts.cookie as either:
 *   (a) A JSON array string of puppeteer CookieParam objects — parsed and
 *       injected via page.setCookie() before navigation. This is the format
 *       written by scripts/safety/seed-e2e-cookie.mjs.
 *   (b) A raw Cookie header value string — injected via setExtraHTTPHeaders.
 *       Fallback for legacy stored values.
 *
 * The factory passes --no-sandbox because it runs in Vercel/CI environments
 * where the user namespace sandbox is unavailable. Acceptable tradeoff for a
 * controlled harness runner that only visits known URLs.
 *
 * Spec: docs/leverage-targets.md#safety-agent-0--done (sub-phase D)
 * Closes: F-N13 — Puppeteer E2E blocked by auth gate (no signed-in session)
 */

import puppeteer, { type CookieParam, type Page } from 'puppeteer'
import type { Browser, BrowserFactory, BrowserPage } from './types'

// F18: lib/harness/safety/v2/e2e/puppeteer-factory

function parseCookieOption(raw: string): { mode: 'params'; params: CookieParam[] } | { mode: 'header'; value: string } {
  const trimmed = raw.trim()
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { mode: 'params', params: parsed as CookieParam[] }
      }
    } catch {
      // Fall through to header mode
    }
  }
  return { mode: 'header', value: raw }
}

function wrapPage(page: Page): BrowserPage {
  const consoleErrors: string[] = []

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text().slice(0, 200))
    }
  })

  return {
    async goto(url: string) {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      if (!response) return null
      return { status: response.status() }
    },

    async bodyText() {
      return page.evaluate(() => document.body?.innerText ?? '')
    },

    async hasSelector(selector: string) {
      const el = await page.$(selector)
      return el !== null
    },

    consoleErrors() {
      return consoleErrors.slice()
    },

    async screenshotPng() {
      const data = await page.screenshot({ encoding: 'base64' })
      return `data:image/png;base64,${data}`
    },
  }
}

/**
 * Create a BrowserFactory backed by headless Puppeteer.
 * The returned factory launches one browser per call. The browser is shared
 * across all pages in that run and closed when browser.close() is called by
 * the runner's finally block.
 */
export function createPuppeteerBrowserFactory(): BrowserFactory {
  return async (): Promise<Browser> => {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })

    return {
      async newPage(opts?: { cookie?: string }) {
        const page = await browser.newPage()

        if (opts?.cookie) {
          const parsed = parseCookieOption(opts.cookie)
          if (parsed.mode === 'params') {
            await page.setCookie(...parsed.params)
          } else {
            await page.setExtraHTTPHeaders({ Cookie: parsed.value })
          }
        }

        return wrapPage(page)
      },

      async close() {
        await browser.close()
      },
    }
  }
}
