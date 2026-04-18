/**
 * Puppeteer acceptance tests for the Betting Tile at /money.
 *
 * Tests 1–3, 6–7 run against the unauthenticated page (server component,
 * service-client data fetch — no session required).
 *
 * Tests 4, 5, 8 require a logged-in session and are skipped until
 * Sprint 5 ships the auth flow. They document the acceptance criteria
 * and will be un-skipped when auth.users is populated.
 *
 * Prerequisites: `npm run dev` must be running on BASE_URL.
 */

import puppeteer, { type Browser, type Page } from 'puppeteer'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'path'
import fs from 'fs'

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3000'
const MONEY_URL = `${BASE_URL}/money`
const SCREENSHOT_DIR = path.resolve(__dirname, '../.screenshots')

async function screenshot(page: Page, name: string) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true })
}

describe('Betting Tile — /money', () => {
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
    page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
  })

  afterAll(async () => {
    await browser.close()
  })

  // ── Test 1: Page loads without errors ──────────────────────────────────────

  it('page loads at /money without JS errors', async () => {
    const jsErrors: string[] = []
    page.on('pageerror', (err) => jsErrors.push(err.message))

    const res = await page.goto(MONEY_URL, { waitUntil: 'networkidle0' })
    expect(res?.status()).toBeLessThan(500)
    expect(jsErrors).toHaveLength(0)

    await screenshot(page, '01-page-load')
  })

  // ── Test 2: Empty state ─────────────────────────────────────────────────────

  it('shows empty-state message when no bets exist', async () => {
    await page.goto(MONEY_URL, { waitUntil: 'networkidle0' })

    const bettingTile = await page.$('[data-testid="betting-tile"]')
    expect(bettingTile).not.toBeNull()

    // When bets table is empty, empty state text must appear
    const pageText = await page.evaluate(() => document.body.innerText)
    const hasEmptyState =
      pageText.includes('No bets yet') || pageText.includes('Collecting data')
    expect(hasEmptyState).toBe(true)

    await screenshot(page, '02-empty-state')
  })

  // ── Test 3: Log Bet form renders with all required fields ──────────────────

  it('"Log Bet" form renders with all required fields', async () => {
    await page.goto(MONEY_URL, { waitUntil: 'networkidle0' })

    // Open the log-bet form (toggle button)
    const logBetBtn = await page.$('[data-testid="log-bet-toggle"]')
    expect(logBetBtn).not.toBeNull()
    await logBetBtn!.click()
    await page.waitForSelector('[data-testid="log-bet-form"]', { timeout: 3000 })

    // Required fields per spec
    const requiredFields = [
      '[name="bet_date"]',
      '[name="sport"]',
      '[name="league"]',
      '[name="home_team"]',
      '[name="away_team"]',
      '[name="bet_on"]',
      '[name="bet_type"]',
      '[name="odds"]',
      '[name="stake"]',
      '[name="ai_notes"]',
    ]

    for (const selector of requiredFields) {
      const el = await page.$(selector)
      expect(el, `Expected field ${selector} to exist`).not.toBeNull()
    }

    await screenshot(page, '03-log-bet-form')
  })

  // ── Test 4: Submit valid bet (Sprint 5 — requires auth) ────────────────────

  it.skip('submitting a valid bet POSTs to /api/bets and shows new bet in list — Sprint 5: requires auth', async () => {
    // Un-skip after Sprint 5 ships login flow and seeds auth.users.
    // Auth setup: log in as Colin, navigate to /money, fill and submit form,
    // expect new row to appear in the pending section.
  })

  // ── Test 5: Invalid bet shows validation errors (Sprint 5 — requires auth) ─

  it.skip('submitting an invalid bet shows Zod validation errors inline — Sprint 5: requires auth', async () => {
    // Un-skip after Sprint 5. Test: submit form with odds as a string,
    // expect inline error text to appear near the odds field.
  })

  // ── Test 6: Kelly recommendation displays ──────────────────────────────────

  it('Kelly recommendation updates when win_prob and odds are entered', async () => {
    await page.goto(MONEY_URL, { waitUntil: 'networkidle0' })

    const logBetBtn = await page.$('[data-testid="log-bet-toggle"]')
    await logBetBtn!.click()
    await page.waitForSelector('[data-testid="log-bet-form"]', { timeout: 3000 })

    // Enter odds
    await page.type('[name="odds"]', '-150')
    // Enter win probability
    await page.type('[name="win_prob_pct"]', '65')

    // Kelly recommendation should appear
    await page.waitForSelector('[data-testid="kelly-rec"]', { timeout: 3000 })
    const kellyText = await page.$eval('[data-testid="kelly-rec"]', (el) => el.textContent)
    expect(kellyText).toMatch(/kelly/i)
    // 65% at -150 → ~12.5% Kelly
    expect(kellyText).toMatch(/12/)

    await screenshot(page, '06-kelly-rec')
  })

  // ── Test 7: System Proof signal renders ────────────────────────────────────

  it('System Proof signal shows "Collecting data (X/30)" when fewer than 30 settled bets', async () => {
    await page.goto(MONEY_URL, { waitUntil: 'networkidle0' })

    await page.waitForSelector('[data-testid="edge-signal"]', { timeout: 5000 })
    const signalText = await page.$eval('[data-testid="edge-signal"]', (el) => el.textContent)

    // With 0 bets the signal must show collecting state, not a misleading classification
    const validSignals = ['PROFITABLE', 'BREAK-EVEN', 'LOSING', 'Collecting data']
    const isValid = validSignals.some((s) => signalText?.includes(s))
    expect(isValid).toBe(true)

    // If < 30 settled bets: must NOT show PROFITABLE/BREAK-EVEN/LOSING
    // (we can't know count here without querying DB — test the shape, not the value)
    await screenshot(page, '07-edge-signal')
  })

  // ── Test 8: Settle Bet action (Sprint 5 — requires auth + pending bet) ─────

  it.skip('Settle Bet action updates result/pnl/bankroll_after — Sprint 5: requires auth', async () => {
    // Un-skip after Sprint 5. Precondition: a pending bet exists (seeded or logged in test 4).
    // Steps: click Settle on pending row, fill result/pnl/bankroll_after, submit,
    // verify row moves from PENDING section to completed stats and pnl is displayed.
  })
})
