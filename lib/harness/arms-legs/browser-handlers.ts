// browser-handlers.ts — wires Puppeteer into the dispatch registry.
//
// Import for side effects only:
//   import '@/lib/harness/arms-legs/browser-handlers'
//
// Each handler launches a fresh headless browser, performs one operation,
// and closes the browser — stateless and safe for serverless.
//
// Security:
//   - Only HTTPS URLs allowed (no file://, http://, javascript:).
//   - Private-range IP hosts are blocked (SSRF guard).
//   - browser.evaluate is intentionally NOT implemented — arbitrary JS
//     execution from an agent-controlled string is an RCE vector.
//
// Requires Chromium to be reachable. On Vercel serverless, set
// PUPPETEER_EXECUTABLE_PATH to a bundled Chromium binary
// (e.g. via @sparticuz/chromium).

import puppeteer from 'puppeteer'
import type { Page } from 'puppeteer'
import { registerHandler } from './dispatch'

// ── Constants ─────────────────────────────────────────────────────────────────

const LAUNCH_TIMEOUT_MS = 15_000
const NAV_TIMEOUT_MS = 15_000
const MAX_HTML_BYTES = 64 * 1024

// ── Payload / result types ────────────────────────────────────────────────────

export interface BrowserNavigatePayload {
  url: string
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2'
}

export interface BrowserNavigateResult {
  title: string
  url: string
  html: string
}

export interface BrowserScreenshotPayload {
  url: string
  selector?: string
}

export interface BrowserScreenshotResult {
  base64: string
}

export interface BrowserClickPayload {
  url: string
  selector: string
}

export interface BrowserClickResult {
  clicked: true
}

export interface BrowserFillPayload {
  url: string
  selector: string
  value: string
}

export interface BrowserFillResult {
  filled: true
}

// ── URL guard (SSRF protection) ───────────────────────────────────────────────
// Blocks non-HTTPS schemes and private IP ranges.

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./, // AWS metadata
  /^::1$/,
  /^0\.0\.0\.0$/,
]

export function assertSafeUrl(rawUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`browser: invalid URL: ${rawUrl}`)
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`browser: only HTTPS URLs allowed, got: ${parsed.protocol}`)
  }
  const host = parsed.hostname
  if (PRIVATE_HOST_PATTERNS.some((re) => re.test(host))) {
    throw new Error(`browser: private/loopback host not allowed: ${host}`)
  }
}

// ── Browser lifecycle helper ──────────────────────────────────────────────────

async function withPage<T>(
  url: string,
  waitUntil: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2' = 'domcontentloaded',
  fn: (page: Page) => Promise<T>
): Promise<T> {
  assertSafeUrl(url)
  const browser = await puppeteer.launch({
    headless: true,
    timeout: LAUNCH_TIMEOUT_MS,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  try {
    const page = await browser.newPage()
    await page.goto(url, { waitUntil, timeout: NAV_TIMEOUT_MS })
    return await fn(page)
  } finally {
    await browser.close()
  }
}

// ── Handler registrations ─────────────────────────────────────────────────────

registerHandler<BrowserNavigatePayload, BrowserNavigateResult>(
  'browser.navigate',
  async (payload) => {
    return withPage(payload.url, payload.waitUntil, async (page) => {
      const title = await page.title()
      const url = page.url()
      const rawHtml = await page.content()
      const html = rawHtml.length > MAX_HTML_BYTES ? rawHtml.slice(0, MAX_HTML_BYTES) : rawHtml
      return { title, url, html }
    })
  }
)

registerHandler<BrowserScreenshotPayload, BrowserScreenshotResult>(
  'browser.screenshot',
  async (payload) => {
    return withPage(payload.url, 'load', async (page) => {
      let base64: string
      if (payload.selector) {
        const element = await page.$(payload.selector)
        if (!element) throw new Error(`selector not found: ${payload.selector}`)
        base64 = (await element.screenshot({ encoding: 'base64' })) as string
      } else {
        base64 = (await page.screenshot({ encoding: 'base64' })) as string
      }
      return { base64 }
    })
  }
)

registerHandler<BrowserClickPayload, BrowserClickResult>('browser.click', async (payload) => {
  return withPage(payload.url, 'domcontentloaded', async (page) => {
    await page.click(payload.selector)
    return { clicked: true as const }
  })
})

registerHandler<BrowserFillPayload, BrowserFillResult>('browser.fill', async (payload) => {
  return withPage(payload.url, 'domcontentloaded', async (page) => {
    await page.focus(payload.selector)
    await page.type(payload.selector, payload.value)
    return { filled: true as const }
  })
})
