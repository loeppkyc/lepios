/**
 * Unit tests for lib/harness/safety/v2/e2e/puppeteer-factory.ts
 *
 * Real puppeteer is never invoked — the module is tested by mocking
 * the puppeteer import. Covers:
 *   - Cookie injection in JSON-array mode (page.setCookie)
 *   - Cookie injection in header-fallback mode (setExtraHTTPHeaders)
 *   - No cookie — no extra headers or setCookie calls
 *   - Page wrapper methods: goto, bodyText, hasSelector, consoleErrors, screenshotPng
 *   - Browser close delegates to puppeteer browser.close
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock puppeteer ────────────────────────────────────────────────────────────
// vi.mock is hoisted — use vi.hoisted() so the mock objects exist before the factory runs.

const { mockPage, mockBrowser } = vi.hoisted(() => {
  const mockPage = {
    goto: vi.fn().mockResolvedValue({ status: vi.fn().mockReturnValue(200) }),
    evaluate: vi.fn().mockResolvedValue('body text'),
    $: vi.fn().mockResolvedValue(null),
    setCookie: vi.fn().mockResolvedValue(undefined),
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue('base64data'),
    on: vi.fn(),
  }
  const mockBrowser = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn().mockResolvedValue(undefined),
  }
  return { mockPage, mockBrowser }
})

vi.mock('puppeteer', () => ({
  default: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}))

import { createPuppeteerBrowserFactory } from '@/lib/harness/safety/v2/e2e/puppeteer-factory'
import puppeteer from 'puppeteer'

beforeEach(() => {
  vi.clearAllMocks()
  mockBrowser.newPage.mockResolvedValue(mockPage)
  mockPage.goto.mockResolvedValue({ status: vi.fn().mockReturnValue(200) })
  mockPage.evaluate.mockResolvedValue('body text')
  mockPage.$.mockResolvedValue(null)
  mockPage.setCookie.mockResolvedValue(undefined)
  mockPage.setExtraHTTPHeaders.mockResolvedValue(undefined)
  mockPage.screenshot.mockResolvedValue('base64data')
  mockPage.on.mockReturnValue(undefined)
})

describe('createPuppeteerBrowserFactory — browser creation', () => {
  it('launches puppeteer headless with no-sandbox args', async () => {
    const factory = createPuppeteerBrowserFactory()
    await factory()
    expect(puppeteer.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: true,
        args: expect.arrayContaining(['--no-sandbox']),
      })
    )
  })

  it('close() calls browser.close', async () => {
    const factory = createPuppeteerBrowserFactory()
    const browser = await factory()
    await browser.close()
    expect(mockBrowser.close).toHaveBeenCalledOnce()
  })
})

describe('createPuppeteerBrowserFactory — cookie injection', () => {
  it('no cookie → no setCookie or setExtraHTTPHeaders calls', async () => {
    const factory = createPuppeteerBrowserFactory()
    const browser = await factory()
    await browser.newPage()
    expect(mockPage.setCookie).not.toHaveBeenCalled()
    expect(mockPage.setExtraHTTPHeaders).not.toHaveBeenCalled()
  })

  it('JSON array cookie → page.setCookie with parsed params', async () => {
    const cookies = [{ name: 'sb-ref-auth-token', value: 'tok', domain: '.example.com', path: '/' }]
    const factory = createPuppeteerBrowserFactory()
    const browser = await factory()
    await browser.newPage({ cookie: JSON.stringify(cookies) })
    expect(mockPage.setCookie).toHaveBeenCalledWith(...cookies)
    expect(mockPage.setExtraHTTPHeaders).not.toHaveBeenCalled()
  })

  it('raw header string → setExtraHTTPHeaders({ Cookie: value })', async () => {
    const factory = createPuppeteerBrowserFactory()
    const browser = await factory()
    await browser.newPage({ cookie: 'sb-ref-auth-token=abc; other=xyz' })
    expect(mockPage.setExtraHTTPHeaders).toHaveBeenCalledWith({
      Cookie: 'sb-ref-auth-token=abc; other=xyz',
    })
    expect(mockPage.setCookie).not.toHaveBeenCalled()
  })

  it('invalid JSON starting with [ → falls back to header mode', async () => {
    const factory = createPuppeteerBrowserFactory()
    const browser = await factory()
    await browser.newPage({ cookie: '[not-valid-json' })
    expect(mockPage.setExtraHTTPHeaders).toHaveBeenCalledWith(
      expect.objectContaining({ Cookie: '[not-valid-json' })
    )
  })

  it('empty JSON array [] → falls back to header mode (no cookies to set)', async () => {
    const factory = createPuppeteerBrowserFactory()
    const browser = await factory()
    await browser.newPage({ cookie: '[]' })
    // Empty array is not valid params — header fallback
    expect(mockPage.setExtraHTTPHeaders).toHaveBeenCalled()
    expect(mockPage.setCookie).not.toHaveBeenCalled()
  })
})

describe('createPuppeteerBrowserFactory — BrowserPage methods', () => {
  async function getPage() {
    const factory = createPuppeteerBrowserFactory()
    const browser = await factory()
    return browser.newPage()
  }

  it('goto returns { status } from response', async () => {
    const page = await getPage()
    const result = await page.goto('https://example.com')
    expect(result).toEqual({ status: 200 })
  })

  it('goto returns null when response is null', async () => {
    mockPage.goto.mockResolvedValueOnce(null)
    const page = await getPage()
    const result = await page.goto('https://example.com')
    expect(result).toBeNull()
  })

  it('bodyText() calls evaluate with innerText expression', async () => {
    mockPage.evaluate.mockResolvedValueOnce('hello world')
    const page = await getPage()
    const text = await page.bodyText()
    expect(text).toBe('hello world')
  })

  it('hasSelector returns true when element found', async () => {
    mockPage.$.mockResolvedValueOnce({})
    const page = await getPage()
    expect(await page.hasSelector('.cockpit-header')).toBe(true)
  })

  it('hasSelector returns false when element not found', async () => {
    mockPage.$.mockResolvedValueOnce(null)
    const page = await getPage()
    expect(await page.hasSelector('.cockpit-header')).toBe(false)
  })

  it('consoleErrors() returns empty array when no errors logged', async () => {
    const page = await getPage()
    expect(page.consoleErrors()).toEqual([])
  })

  it('screenshotPng() returns data-URL with base64 prefix', async () => {
    mockPage.screenshot.mockResolvedValueOnce('FAKEBASE64')
    const page = await getPage()
    const png = await page.screenshotPng()
    expect(png).toBe('data:image/png;base64,FAKEBASE64')
  })
})
