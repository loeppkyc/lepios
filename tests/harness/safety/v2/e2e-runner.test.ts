/**
 * Unit tests for lib/harness/safety/v2/e2e/runner.ts.
 *
 * Browser is faked via the BrowserFactory injection. Real puppeteer is
 * never invoked in these tests — the runner contract is independent of
 * the browser implementation.
 */

import { describe, it, expect, vi } from 'vitest'
import { runE2E } from '@/lib/harness/safety/v2/e2e/runner'
import type { Browser, BrowserPage, E2EAssertion } from '@/lib/harness/safety/v2/e2e/types'

interface FakePageOpts {
  status?: number
  bodyText?: string
  selectors?: string[]
  consoleErrors?: string[]
  gotoThrows?: string
}

function fakePage(opts: FakePageOpts = {}): BrowserPage {
  return {
    goto: vi.fn(async (_url: string) => {
      if (opts.gotoThrows) throw new Error(opts.gotoThrows)
      return { status: opts.status ?? 200 }
    }),
    bodyText: vi.fn(async () => opts.bodyText ?? 'hello world'),
    hasSelector: vi.fn(async (s: string) => (opts.selectors ?? []).includes(s)),
    consoleErrors: vi.fn(() => opts.consoleErrors ?? []),
    screenshotPng: vi.fn(async () => 'data:image/png;base64,FAKE'),
  }
}

function fakeBrowserFactory(pages: BrowserPage[]): () => Promise<Browser> {
  let i = 0
  return async () => ({
    newPage: vi.fn(async () => {
      const p = pages[i] ?? pages[pages.length - 1]
      i += 1
      return p
    }),
    close: vi.fn(async () => {}),
  })
}

describe('runE2E — happy path', () => {
  it('returns pass=true when every assertion passes', async () => {
    const a: E2EAssertion = { url: 'https://x/a', expectStatus: 200 }
    const out = await runE2E({
      assertions: [a],
      browserFactory: fakeBrowserFactory([fakePage({ status: 200 })]),
    })
    expect(out.pass).toBe(true)
    expect(out.assertions).toHaveLength(1)
    expect(out.assertions[0].pass).toBe(true)
  })

  it('runs every assertion (does not short-circuit on failure)', async () => {
    const out = await runE2E({
      assertions: [
        { url: 'https://x/a', expectStatus: 200 },
        { url: 'https://x/b', expectStatus: 200 },
        { url: 'https://x/c', expectStatus: 200 },
      ],
      browserFactory: fakeBrowserFactory([
        fakePage({ status: 500 }), // fail
        fakePage({ status: 200 }),
        fakePage({ status: 500 }), // fail
      ]),
    })
    expect(out.pass).toBe(false)
    expect(out.assertions).toHaveLength(3)
    expect(out.assertions[0].pass).toBe(false)
    expect(out.assertions[1].pass).toBe(true)
    expect(out.assertions[2].pass).toBe(false)
  })

  it('empty assertions array returns pass with abort_reason', async () => {
    const out = await runE2E({
      assertions: [],
      browserFactory: fakeBrowserFactory([]),
    })
    expect(out.pass).toBe(true)
    expect(out.abort_reason).toBe('no_assertions')
  })
})

describe('runE2E — assertion checks', () => {
  it('expectStatus mismatch fails with status_mismatch reason', async () => {
    const out = await runE2E({
      assertions: [{ url: 'https://x/a', expectStatus: 200 }],
      browserFactory: fakeBrowserFactory([fakePage({ status: 500 })]),
    })
    expect(out.assertions[0].pass).toBe(false)
    expect(out.assertions[0].reason).toContain('status_mismatch')
    expect(out.assertions[0].reason).toContain('500')
  })

  it('expectText present passes', async () => {
    const out = await runE2E({
      assertions: [{ url: 'https://x/a', expectText: 'welcome' }],
      browserFactory: fakeBrowserFactory([fakePage({ bodyText: 'welcome home' })]),
    })
    expect(out.assertions[0].pass).toBe(true)
  })

  it('expectText missing fails with missing_text reason', async () => {
    const out = await runE2E({
      assertions: [{ url: 'https://x/a', expectText: 'admin' }],
      browserFactory: fakeBrowserFactory([fakePage({ bodyText: 'welcome home' })]),
    })
    expect(out.assertions[0].pass).toBe(false)
    expect(out.assertions[0].reason).toContain('missing_text')
    expect(out.assertions[0].reason).toContain('admin')
  })

  it('expectSelector present passes', async () => {
    const out = await runE2E({
      assertions: [{ url: 'https://x/a', expectSelector: '.cockpit-header' }],
      browserFactory: fakeBrowserFactory([fakePage({ selectors: ['.cockpit-header'] })]),
    })
    expect(out.assertions[0].pass).toBe(true)
  })

  it('expectSelector missing fails with missing_selector reason', async () => {
    const out = await runE2E({
      assertions: [{ url: 'https://x/a', expectSelector: '.cockpit-header' }],
      browserFactory: fakeBrowserFactory([fakePage({ selectors: [] })]),
    })
    expect(out.assertions[0].pass).toBe(false)
    expect(out.assertions[0].reason).toContain('missing_selector')
  })
})

describe('runE2E — console errors', () => {
  it('console errors do not fail when noConsoleErrors is unset', async () => {
    const out = await runE2E({
      assertions: [{ url: 'https://x/a' }],
      browserFactory: fakeBrowserFactory([fakePage({ consoleErrors: ['hydration mismatch'] })]),
    })
    expect(out.assertions[0].pass).toBe(true)
    expect(out.assertions[0].console_errors).toEqual(['hydration mismatch'])
  })

  it('console errors fail when noConsoleErrors is true', async () => {
    const out = await runE2E({
      assertions: [{ url: 'https://x/a', noConsoleErrors: true }],
      browserFactory: fakeBrowserFactory([fakePage({ consoleErrors: ['hydration mismatch'] })]),
    })
    expect(out.assertions[0].pass).toBe(false)
    expect(out.assertions[0].reason).toContain('console_errors')
    expect(out.assertions[0].console_errors).toContain('hydration mismatch')
  })

  it('caps console_errors output at 5 entries', async () => {
    const errs = Array.from({ length: 12 }, (_, i) => `err-${i}`)
    const out = await runE2E({
      assertions: [{ url: 'https://x/a', noConsoleErrors: true }],
      browserFactory: fakeBrowserFactory([fakePage({ consoleErrors: errs })]),
    })
    expect(out.assertions[0].console_errors?.length).toBe(5)
  })
})

describe('runE2E — browser failures', () => {
  it('browser launch failure aborts with abort_reason', async () => {
    const factory = async (): Promise<Browser> => {
      throw new Error('chromium not found')
    }
    const out = await runE2E({
      assertions: [{ url: 'https://x/a' }],
      browserFactory: factory,
    })
    expect(out.pass).toBe(false)
    expect(out.abort_reason).toContain('browser_launch_failed')
    expect(out.abort_reason).toContain('chromium')
    expect(out.assertions).toHaveLength(0)
  })

  it('navigation error per assertion does not abort the run', async () => {
    const out = await runE2E({
      assertions: [{ url: 'https://x/a' }, { url: 'https://x/b' }],
      browserFactory: fakeBrowserFactory([
        fakePage({ gotoThrows: 'net::ERR' }),
        fakePage({ status: 200 }),
      ]),
    })
    expect(out.pass).toBe(false)
    expect(out.assertions[0].pass).toBe(false)
    expect(out.assertions[0].reason).toContain('navigation_error')
    expect(out.assertions[1].pass).toBe(true)
  })

  it('captures screenshot on failure', async () => {
    const out = await runE2E({
      assertions: [{ url: 'https://x/a', expectText: 'absent' }],
      browserFactory: fakeBrowserFactory([fakePage({ bodyText: 'foo' })]),
    })
    expect(out.assertions[0].screenshot).toBeDefined()
    expect(out.assertions[0].screenshot).toContain('data:image/png')
  })
})

describe('runE2E — duration tracking', () => {
  it('reports duration_ms for normal runs', async () => {
    const out = await runE2E({
      assertions: [{ url: 'https://x/a' }],
      browserFactory: fakeBrowserFactory([fakePage()]),
    })
    expect(out.duration_ms).toBeGreaterThanOrEqual(0)
    expect(out.duration_ms).toBeLessThan(5000)
  })

  it('reports duration_ms even on browser launch failure', async () => {
    const factory = async (): Promise<Browser> => {
      throw new Error('boom')
    }
    const out = await runE2E({ assertions: [{ url: 'https://x/a' }], browserFactory: factory })
    expect(out.duration_ms).toBeGreaterThanOrEqual(0)
  })
})
