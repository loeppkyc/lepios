#!/usr/bin/env node
/**
 * scripts/safety/seed-e2e-cookie.mjs
 *
 * One-time (or refresh) script: sign in a test user via the live LepiOS login
 * page and store the resulting session cookies in harness_config so the
 * Safety Agent E2E runner can authenticate against auth-gated cockpit pages.
 *
 * Prerequisites (run once):
 *   1. Create a test user in Supabase Auth (Dashboard → Authentication → Users)
 *      with any email + a password that meets the login page requirements.
 *   2. Store the credentials in harness_config:
 *        INSERT INTO harness_config (key, value) VALUES
 *          ('SAFETY_E2E_USER_EMAIL', 'your-test@example.com'),
 *          ('SAFETY_E2E_USER_PASSWORD', 'your-test-password');
 *   3. Approve the user's role in user_profiles (role = 'business' or higher).
 *
 * Usage:
 *   node scripts/safety/seed-e2e-cookie.mjs
 *   node scripts/safety/seed-e2e-cookie.mjs --url https://lepios-one.vercel.app
 *   # Or override credentials from env instead of harness_config:
 *   SAFETY_E2E_USER_EMAIL=test@x.com SAFETY_E2E_USER_PASSWORD=pw node ...
 *
 * After running, SAFETY_E2E_SESSION_COOKIE is set in harness_config and the
 * E2E runner can authenticate. Re-run when cookies expire (typically 7 days).
 *
 * Closes: F-N13 — Puppeteer E2E blocked by auth gate (no signed-in session)
 */

import puppeteer from 'puppeteer'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

// ── Config ────────────────────────────────────────────────────────────────────

const APP_URL = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'https://lepios-one.vercel.app'

// Load .env.local for Supabase credentials if available
function loadEnvLocal() {
  const envPath = resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnvLocal()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (via .env.local or env).')
  process.exit(1)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readHarnessConfig(key) {
  const db = createSupabaseClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { data } = await db.from('harness_config').select('value').eq('key', key).maybeSingle()
  return data?.value?.trim() ?? null
}

async function writeHarnessConfig(key, value) {
  const db = createSupabaseClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { error } = await db
    .from('harness_config')
    .upsert({ key, value }, { onConflict: 'key' })
  if (error) throw new Error(`Failed to write harness_config.${key}: ${error.message}`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Resolve credentials: CLI env vars take precedence over harness_config.
  let email = process.env.SAFETY_E2E_USER_EMAIL?.trim() ?? null
  let password = process.env.SAFETY_E2E_USER_PASSWORD?.trim() ?? null

  if (!email) email = await readHarnessConfig('SAFETY_E2E_USER_EMAIL')
  if (!password) password = await readHarnessConfig('SAFETY_E2E_USER_PASSWORD')

  if (!email || !password) {
    console.error(`❌ Test user credentials not found.

Run these SQL statements in Supabase, then re-run this script:

  INSERT INTO harness_config (key, value) VALUES
    ('SAFETY_E2E_USER_EMAIL', 'your-test@example.com')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  INSERT INTO harness_config (key, value) VALUES
    ('SAFETY_E2E_USER_PASSWORD', 'YourPassword1')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

Also ensure the test user exists in auth.users and has role = 'business' in user_profiles.`)
    process.exit(1)
  }

  console.log(`Signing in test user: ${email.slice(0, 4)}...@... → ${APP_URL}/login`)

  // 2. Launch puppeteer and sign in via the real login page.
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })

  try {
    const page = await browser.newPage()

    // Navigate to login page
    await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle2', timeout: 30_000 })

    // Wait for the email input to appear (the Suspense boundary may delay rendering)
    await page.waitForSelector('input[type="email"]', { timeout: 10_000 })

    // Fill credentials
    await page.type('input[type="email"]', email)
    await page.type('input[type="password"]', password)

    // Click Sign In and wait for navigation away from /login
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20_000 }),
      page.click('button[type="submit"]'),
    ])

    const finalUrl = page.url()
    if (finalUrl.includes('/login')) {
      // Still on login page — check for error message
      const errorText = await page
        .evaluate(() => document.body.innerText)
        .catch(() => 'unknown')
      console.error(`❌ Sign-in failed — still on /login. Page text snippet:`)
      console.error(errorText.slice(0, 300))
      process.exit(1)
    }

    console.log(`✓ Signed in. Landed on: ${finalUrl}`)

    // 3. Capture all sb-* cookies from the browser
    const allCookies = await page.cookies()
    const authCookies = allCookies.filter((c) => c.name.startsWith('sb-'))

    if (authCookies.length === 0) {
      console.error('❌ No sb-* auth cookies found after sign-in.')
      console.error('All cookies:', allCookies.map((c) => c.name).join(', '))
      process.exit(1)
    }

    console.log(`✓ Captured ${authCookies.length} auth cookie(s): ${authCookies.map((c) => c.name).join(', ')}`)

    // 4. Serialize as JSON array and store in harness_config
    const cookieJson = JSON.stringify(
      authCookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path ?? '/',
        httpOnly: c.httpOnly ?? false,
        secure: c.secure ?? true,
        sameSite: c.sameSite,
      }))
    )

    await writeHarnessConfig('SAFETY_E2E_SESSION_COOKIE', cookieJson)
    console.log(`✓ SAFETY_E2E_SESSION_COOKIE written to harness_config (${cookieJson.length} chars).`)
    console.log(`  E2E runner will use these cookies for auth-gated page verification.`)
    console.log(`  Re-run this script when cookies expire (Supabase default: 7 days).`)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error('Seed script failed:', err)
  process.exit(1)
})
