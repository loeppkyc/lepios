/**
 * Unit tests for lib/harness/arms-legs/browser.ts + browser-handlers.ts
 *
 * All external I/O is mocked:
 *   - puppeteer            (launch → browser → page chain)
 *   - @/lib/security/capability (checkCapability)
 *   - @/lib/supabase/service    (agent_events logging)
 *
 * Handlers registered once via import './browser-handlers' side effects.
 * Registry NOT reset between tests.
 *
 * Coverage:
 *   - browserNavigate: returns title + url + html (truncated at 64KB)
 *   - browserScreenshot: returns base64 string
 *   - browserClick: calls page.click and returns void
 *   - browserFill: calls page.focus + page.type and returns void
 *   - SSRF guard: rejects non-HTTPS URLs and private IP hosts
 *   - capability denied: rejects with capability_denied code
 *   - puppeteer launch failure: propagates as handler_error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock puppeteer ────────────────────────────────────────────────────────────

const mockPage = {
  goto: vi.fn().mockResolvedValue(undefined),
  title: vi.fn().mockResolvedValue('Test Page'),
  url: vi.fn().mockReturnValue('https://example.com/'),
  content: vi.fn().mockResolvedValue('<html><body>hello</body></html>'),
  screenshot: vi.fn().mockResolvedValue('base64data=='),
  click: vi.fn().mockResolvedValue(undefined),
  focus: vi.fn().mockResolvedValue(undefined),
  type: vi.fn().mockResolvedValue(undefined),
  $: vi.fn(),
}

const mockBrowser = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn().mockResolvedValue(undefined),
}

const { mockLaunch } = vi.hoisted(() => ({
  mockLaunch: vi.fn(),
}))

vi.mock('puppeteer', () => ({
  default: { launch: mockLaunch },
}))

// ── Mock checkCapability ──────────────────────────────────────────────────────

const { mockCheckCapability } = vi.hoisted(() => ({
  mockCheckCapability: vi.fn(),
}))

vi.mock('@/lib/security/capability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/capability')>()
  return { ...actual, checkCapability: mockCheckCapability }
})

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Side effects: registers browser.* handlers ────────────────────────────────

import '@/lib/harness/arms-legs/browser-handlers'
import {
  browserNavigate,
  browserScreenshot,
  browserClick,
  browserFill,
} from '@/lib/harness/arms-legs/browser'
import { assertSafeUrl } from '@/lib/harness/arms-legs/browser-handlers'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInsertChain() {
  return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
}

function makeCapAllowed() {
  mockCheckCapability.mockResolvedValue({
    allowed: true,
    reason: 'in_scope',
    enforcement_mode: 'log_only',
    audit_id: 'audit-browser-1',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFrom.mockReturnValue(makeInsertChain())
  makeCapAllowed()
  mockLaunch.mockResolvedValue(mockBrowser)
  mockBrowser.newPage.mockResolvedValue(mockPage)
  mockPage.goto.mockResolvedValue(undefined)
  mockPage.title.mockResolvedValue('Test Page')
  mockPage.url.mockReturnValue('https://example.com/')
  mockPage.content.mockResolvedValue('<html><body>hello</body></html>')
  mockPage.screenshot.mockResolvedValue('base64data==')
  mockPage.click.mockResolvedValue(undefined)
  mockPage.focus.mockResolvedValue(undefined)
  mockPage.type.mockResolvedValue(undefined)
  mockBrowser.close.mockResolvedValue(undefined)
})

// ── assertSafeUrl ─────────────────────────────────────────────────────────────

describe('assertSafeUrl — SSRF guard', () => {
  it('allows a valid HTTPS URL', () => {
    expect(() => assertSafeUrl('https://example.com/path')).not.toThrow()
  })

  it('blocks http:// URLs', () => {
    expect(() => assertSafeUrl('http://example.com')).toThrow('only HTTPS URLs allowed')
  })

  it('blocks file:// URLs', () => {
    expect(() => assertSafeUrl('file:///etc/passwd')).toThrow('only HTTPS URLs allowed')
  })

  it('blocks javascript: URLs', () => {
    expect(() => assertSafeUrl('javascript:alert(1)')).toThrow('only HTTPS URLs allowed')
  })

  it('blocks localhost', () => {
    expect(() => assertSafeUrl('https://localhost/admin')).toThrow(
      'private/loopback host not allowed'
    )
  })

  it('blocks 127.x.x.x', () => {
    expect(() => assertSafeUrl('https://127.0.0.1:8080/')).toThrow(
      'private/loopback host not allowed'
    )
  })

  it('blocks 10.x.x.x', () => {
    expect(() => assertSafeUrl('https://10.0.0.1/')).toThrow('private/loopback host not allowed')
  })

  it('blocks 192.168.x.x', () => {
    expect(() => assertSafeUrl('https://192.168.1.1/')).toThrow('private/loopback host not allowed')
  })

  it('blocks AWS metadata IP 169.254.169.254', () => {
    expect(() => assertSafeUrl('https://169.254.169.254/latest/meta-data/')).toThrow(
      'private/loopback host not allowed'
    )
  })
})

// ── browserNavigate ───────────────────────────────────────────────────────────

describe('browserNavigate — happy path', () => {
  it('returns title, url, and html', async () => {
    const result = await browserNavigate('https://example.com', 'coordinator')

    expect(result.title).toBe('Test Page')
    expect(result.url).toBe('https://example.com/')
    expect(result.html).toBe('<html><body>hello</body></html>')
    expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', {
      waitUntil: 'domcontentloaded',
      timeout: expect.any(Number),
    })
  })

  it('truncates html at 64KB', async () => {
    const bigHtml = 'x'.repeat(70 * 1024)
    mockPage.content.mockResolvedValue(bigHtml)

    const result = await browserNavigate('https://example.com', 'coordinator')

    expect(result.html.length).toBe(64 * 1024)
  })

  it('closes the browser even on page error', async () => {
    mockPage.goto.mockRejectedValue(new Error('Navigation timeout'))

    await expect(browserNavigate('https://example.com', 'coordinator')).rejects.toThrow(
      'browser.navigate failed [handler_error]'
    )
    expect(mockBrowser.close).toHaveBeenCalledOnce()
  })
})

// ── browserScreenshot ─────────────────────────────────────────────────────────

describe('browserScreenshot — happy path', () => {
  it('returns base64 string from full-page screenshot', async () => {
    const base64 = await browserScreenshot('https://example.com', 'coordinator')
    expect(base64).toBe('base64data==')
    expect(mockPage.screenshot).toHaveBeenCalledWith({ encoding: 'base64' })
  })

  it('screenshots a selector element when provided', async () => {
    const mockEl = { screenshot: vi.fn().mockResolvedValue('element_base64') }
    mockPage.$.mockResolvedValue(mockEl)

    const base64 = await browserScreenshot('https://example.com', 'coordinator', {
      selector: '#hero',
    })

    expect(base64).toBe('element_base64')
    expect(mockPage.$).toHaveBeenCalledWith('#hero')
  })

  it('throws handler_error when selector not found', async () => {
    mockPage.$.mockResolvedValue(null)

    await expect(
      browserScreenshot('https://example.com', 'coordinator', { selector: '#missing' })
    ).rejects.toThrow('browser.screenshot failed [handler_error]')
  })
})

// ── browserClick ──────────────────────────────────────────────────────────────

describe('browserClick — happy path', () => {
  it('calls page.click with the selector and resolves', async () => {
    await expect(
      browserClick('https://example.com', '#submit', 'coordinator')
    ).resolves.toBeUndefined()

    expect(mockPage.click).toHaveBeenCalledWith('#submit')
  })
})

// ── browserFill ───────────────────────────────────────────────────────────────

describe('browserFill — happy path', () => {
  it('focuses then types the value into the selector', async () => {
    await expect(
      browserFill('https://example.com', '#email', 'test@example.com', 'coordinator')
    ).resolves.toBeUndefined()

    expect(mockPage.focus).toHaveBeenCalledWith('#email')
    expect(mockPage.type).toHaveBeenCalledWith('#email', 'test@example.com')
  })
})

// ── capability denied ─────────────────────────────────────────────────────────

describe('capability denied', () => {
  it('rejects with capability_denied and never launches browser', async () => {
    mockCheckCapability.mockResolvedValue({
      allowed: false,
      reason: 'no_grant_for_agent',
      enforcement_mode: 'enforce',
      audit_id: 'audit-denied',
    })

    await expect(browserNavigate('https://example.com', 'rogue_agent')).rejects.toThrow(
      'browser.navigate failed [capability_denied]'
    )
    expect(mockLaunch).not.toHaveBeenCalled()
  })
})

// ── puppeteer launch failure ──────────────────────────────────────────────────

describe('puppeteer launch failure', () => {
  it('propagates as handler_error with clear message', async () => {
    mockLaunch.mockRejectedValue(new Error('Could not find Chromium executable'))

    await expect(browserNavigate('https://example.com', 'coordinator')).rejects.toThrow(
      'browser.navigate failed [handler_error]'
    )
  })
})
