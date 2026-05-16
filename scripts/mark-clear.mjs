#!/usr/bin/env node
/**
 * mark-clear.mjs
 * Run this after fixing issues to stamp a "clean slate" watermark.
 * Sends a Telegram message so you can look back in chat history and know:
 *   - everything before this message = resolved
 *   - everything after = new problems you haven't seen yet
 *
 * Usage:  node scripts/mark-clear.mjs
 */

import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const LEPIOS_URL = 'https://lepios-one.vercel.app'

function loadEnv() {
  const envPath = join(ROOT, '.env.local')
  if (!existsSync(envPath)) {
    console.error('No .env.local found')
    process.exit(1)
  }
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/\\n$/g, '')
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnv()

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  { auth: { persistSession: false } }
)
const CRON_SECRET = process.env.CRON_SECRET?.trim()

async function main() {
  const now = new Date()

  // Read last cleared-at to count issues in the window
  let lastClearedAt = null
  try {
    const { data } = await db
      .from('harness_config')
      .select('value')
      .eq('key', 'ALERTS_CLEARED_AT')
      .maybeSingle()
    if (data?.value) lastClearedAt = new Date(data.value)
  } catch {
    /* first run */
  }

  // Count failures/warnings since last clear (or last 7 days if never cleared)
  const since = lastClearedAt ?? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const { data: issueRows } = await db
    .from('agent_events')
    .select('id', { count: 'exact', head: true })
    .in('status', ['failure', 'warning'])
    .gte('occurred_at', since.toISOString())

  const issueCount = issueRows?.length ?? 0

  // Stamp the watermark
  const { data: existing } = await db
    .from('harness_config')
    .select('key')
    .eq('key', 'ALERTS_CLEARED_AT')
    .maybeSingle()

  if (existing) {
    await db
      .from('harness_config')
      .update({ value: now.toISOString() })
      .eq('key', 'ALERTS_CLEARED_AT')
  } else {
    await db.from('harness_config').insert({ key: 'ALERTS_CLEARED_AT', value: now.toISOString() })
  }

  // Format the Telegram message
  const timeStr = now.toLocaleTimeString('en-CA', {
    timeZone: 'America/Edmonton',
    hour: '2-digit',
    minute: '2-digit',
  })
  const dateStr = now.toLocaleDateString('en-CA', {
    timeZone: 'America/Edmonton',
    month: 'short',
    day: 'numeric',
  })
  const windowDesc = lastClearedAt
    ? `since ${lastClearedAt.toLocaleDateString('en-CA', { timeZone: 'America/Edmonton', month: 'short', day: 'numeric' })}`
    : 'last 7 days'

  const message = [
    `✅ ALL CLEAR — ${dateStr} ${timeStr} MDT`,
    ``,
    `${issueCount} warning/failure event${issueCount === 1 ? '' : 's'} resolved (${windowDesc}).`,
    ``,
    `Fresh monitoring active. Any alerts after this message are new problems you haven't seen yet.`,
  ].join('\n')

  // Read telegram chat ID from harness_config
  const { data: configRows } = await db
    .from('harness_config')
    .select('key, value')
    .in('key', ['TELEGRAM_CHAT_ID'])

  const telegramChatId = configRows?.find((r) => r.key === 'TELEGRAM_CHAT_ID')?.value

  if (!telegramChatId) {
    console.error('TELEGRAM_CHAT_ID not found in harness_config')
    process.exit(1)
  }

  // Insert notification and drain
  await db.from('outbound_notifications').insert({
    channel: 'telegram',
    chat_id: telegramChatId,
    payload: { text: message },
    status: 'pending',
  })

  if (CRON_SECRET) {
    await fetch(`${LEPIOS_URL}/api/harness/notifications-drain`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      signal: AbortSignal.timeout(10_000),
    })
    console.log('Telegram message sent.')
  } else {
    console.log(
      'No CRON_SECRET — notification queued but not drained (will send on next drain tick).'
    )
  }

  console.log(`\nWatermark set: ${now.toISOString()}`)
  console.log(`Message: ${message}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
