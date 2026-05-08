/**
 * lib/harness/safety/v2/e2e/runner.ts
 *
 * Puppeteer-backed E2E runner for the Safety Agent v2.
 *
 * Drives the surface URLs declared in a module's done_state, asserts each
 * loads + meets text/selector/status expectations + has no console errors,
 * captures screenshots on failure. Returns an E2EResult that the gate uses
 * to set `e2e_pass` on the safety_decisions row.
 *
 * Run-all-then-summarize: every assertion runs even if earlier ones fail,
 * so the diagnostic includes every broken surface — not just the first.
 *
 * Browser is INJECTED via BrowserFactory so tests can pass a fake without
 * pulling in puppeteer. The default factory (Sub-phase D will wire) calls
 * puppeteer.launch().
 *
 * Spec: docs/leverage-targets.md#safety-agent-0--done (sub-module #3)
 */

import type {
  BrowserFactory,
  BrowserPage,
  E2EAssertion,
  E2EAssertionResult,
  E2EResult,
} from './types'

// F18: lib/harness/safety/v2/e2e/runner

export interface RunE2EInput {
  assertions: E2EAssertion[]
  /** Cookie to inject for auth-gated routes. null = unauthenticated. */
  cookie?: string | null
  /** Browser factory — injected for testability. */
  browserFactory: BrowserFactory
}

/**
 * Run a single assertion. Returns the result; never throws.
 *
 * Failure reasons are deterministic strings so the gate's audit log
 * + downstream pattern-matching can group them:
 *   - "navigation_error: <message>"
 *   - "status_mismatch: expected X, got Y"
 *   - "missing_text: <substring>"
 *   - "missing_selector: <selector>"
 *   - "console_errors: <count>"
 */
async function runOne(page: BrowserPage, a: E2EAssertion): Promise<E2EAssertionResult> {
  const result: E2EAssertionResult = { url: a.url, pass: false }
  let response: { status: number } | null = null
  try {
    response = await page.goto(a.url)
    result.status = response?.status
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    result.reason = `navigation_error: ${msg.slice(0, 200)}`
    try {
      result.screenshot = await page.screenshotPng()
    } catch {
      // Screenshot on a failed-load page may itself fail — ignore.
    }
    return result
  }

  if (a.expectStatus !== undefined && response?.status !== a.expectStatus) {
    result.reason = `status_mismatch: expected ${a.expectStatus}, got ${response?.status ?? 'null'}`
    result.screenshot = await page.screenshotPng()
    return result
  }

  if (a.expectText !== undefined) {
    const body = await page.bodyText()
    if (!body.includes(a.expectText)) {
      result.reason = `missing_text: ${a.expectText.slice(0, 80)}`
      result.screenshot = await page.screenshotPng()
      return result
    }
  }

  if (a.expectSelector !== undefined) {
    const found = await page.hasSelector(a.expectSelector)
    if (!found) {
      result.reason = `missing_selector: ${a.expectSelector}`
      result.screenshot = await page.screenshotPng()
      return result
    }
  }

  const consoleErrors = page.consoleErrors()
  if (a.noConsoleErrors && consoleErrors.length > 0) {
    result.console_errors = consoleErrors.slice(0, 5)
    result.reason = `console_errors: ${consoleErrors.length}`
    result.screenshot = await page.screenshotPng()
    return result
  }

  result.pass = true
  if (consoleErrors.length > 0) result.console_errors = consoleErrors.slice(0, 5)
  return result
}

/**
 * Run all assertions against the configured browser. Returns when every
 * assertion has run (or browser launch fails). Always closes the browser.
 *
 * Returns abort_reason populated when the browser couldn't launch — caller
 * treats this differently from a normal failure (don't escalate Colin for
 * infrastructure outages — surface as e2e_pass=null, not false).
 */
export async function runE2E(input: RunE2EInput): Promise<E2EResult> {
  const start = Date.now()

  if (input.assertions.length === 0) {
    return {
      pass: true,
      assertions: [],
      duration_ms: Date.now() - start,
      abort_reason: 'no_assertions',
    }
  }

  let browser: Awaited<ReturnType<BrowserFactory>>
  try {
    browser = await input.browserFactory()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      pass: false,
      assertions: [],
      duration_ms: Date.now() - start,
      abort_reason: `browser_launch_failed: ${msg.slice(0, 200)}`,
    }
  }

  const results: E2EAssertionResult[] = []
  try {
    for (const a of input.assertions) {
      const page = await browser.newPage(input.cookie ? { cookie: input.cookie } : undefined)
      const r = await runOne(page, a)
      results.push(r)
    }
  } finally {
    try {
      await browser.close()
    } catch {
      // Browser teardown failures don't change the verdict.
    }
  }

  return {
    pass: results.every((r) => r.pass),
    assertions: results,
    duration_ms: Date.now() - start,
  }
}
