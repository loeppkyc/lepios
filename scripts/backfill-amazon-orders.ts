#!/usr/bin/env tsx
/**
 * Backfill Amazon orders for the last N days.
 *
 * Usage:
 *   npx tsx scripts/backfill-amazon-orders.ts [--days=90] [--dry-run]
 *
 * Preferred: hit the cron endpoint instead for a prod-equivalent run:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://lepios-one.vercel.app/api/cron/amazon-orders-sync?backfill=90"
 *
 * Idempotent — upserts on id conflict, safe to re-run.
 */

import { config } from 'dotenv'
import path from 'path'

// Load .env.local first, fall back to .env
config({ path: path.resolve(process.cwd(), '.env.local') })
config({ path: path.resolve(process.cwd(), '.env') })

import { createClient } from '@supabase/supabase-js'
import { syncOrdersForRange } from '../lib/amazon/orders-sync'
import { spApiConfigured } from '../lib/amazon/client'

const args = process.argv.slice(2)
const daysArg = args.find((a) => a.startsWith('--days='))
const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : 90
const dryRun = args.includes('--dry-run')

async function main() {
  if (!spApiConfigured()) {
    console.error(
      'SP-API not configured. Set AMAZON_SP_CLIENT_ID, AMAZON_SP_CLIENT_SECRET, AMAZON_SP_REFRESH_TOKEN, AMAZON_AWS_ACCESS_KEY, AMAZON_AWS_SECRET_KEY in .env.local'
    )
    process.exit(1)
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const endDate = new Date()
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  console.log(
    `Backfilling Amazon orders: ${days} days (${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)})`
  )
  if (dryRun) console.log('DRY RUN — no writes to DB')

  const result = await syncOrdersForRange({ startDate, endDate, supabase, dryRun })

  console.log(
    `Done: fetched=${result.fetched} inserted=${result.inserted} skipped=${result.skipped} errors=${result.errors}`
  )

  if (result.errors > 0) {
    console.warn(`${result.errors} order(s) failed — check agent_events for details`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
