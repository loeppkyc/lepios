/**
 * lib/harness/safety/v2/e2e/types.ts
 *
 * Types for the Safety Agent E2E runner. Defined here so runner +
 * archival + test-user modules + tests share the contract without
 * pulling in the puppeteer dependency.
 *
 * Spec: docs/leverage-targets.md#safety-agent-0--done (signal #6 Puppeteer E2E)
 */

// F18: lib/harness/safety/v2/e2e

/**
 * One assertion the runner executes against a surface URL. Builder writes
 * these in the module's done_state. The runner navigates to `url`, waits
 * for the document to load, and verifies all of the optional expects.
 *
 * If multiple expects are set, ALL must hold for the assertion to pass.
 */
export interface E2EAssertion {
  /** Absolute URL on the preview deployment (https only). */
  url: string
  /** Substring that must appear in document.body.innerText. */
  expectText?: string
  /** CSS selector that must resolve to at least one node. */
  expectSelector?: string
  /** HTTP status code the navigation must return. */
  expectStatus?: number
  /** When true, fail the assertion if any console.error fires during load. */
  noConsoleErrors?: boolean
}

/** Per-assertion result from the runner. */
export interface E2EAssertionResult {
  url: string
  pass: boolean
  /** First failure reason, populated only when pass=false. */
  reason?: string
  /** Screenshot data URL or storage path; populated on failure when available. */
  screenshot?: string
  /** Captured console errors during the run. */
  console_errors?: string[]
  /** HTTP status of the navigation (when known). */
  status?: number
}

export interface E2EResult {
  /** True iff every assertion passed. False if any failed. */
  pass: boolean
  assertions: E2EAssertionResult[]
  /** Wall-clock duration in milliseconds. */
  duration_ms: number
  /** Reason the runner couldn't execute (browser unavailable, etc.) — null on success path. */
  abort_reason?: string
}

/**
 * Minimal browser surface the runner depends on. Real implementation uses
 * Puppeteer; tests inject a fake. This abstraction prevents us from importing
 * the puppeteer dependency in test files.
 */
export interface BrowserPage {
  goto(url: string): Promise<{ status: number } | null>
  bodyText(): Promise<string>
  hasSelector(selector: string): Promise<boolean>
  consoleErrors(): string[]
  screenshotPng(): Promise<string>
}

export interface Browser {
  newPage(opts?: { cookie?: string }): Promise<BrowserPage>
  close(): Promise<void>
}

/** Factory injected into the runner. Allows tests to substitute a fake. */
export type BrowserFactory = () => Promise<Browser>
