#!/usr/bin/env tsx
/**
 * Backfill Amazon settlements for the full 2025 calendar year.
 *
 * Usage:
 *   npx tsx scripts/backfill-settlements-2025.ts [--dry-run]
 *
 * What it does:
 *   1. Calculates the days since 2025-01-01 (SP-API supports up to 18 months back)
 *   2. Calls syncSettlementsForRange with that window — fetches all groups since
 *      Jan 1 2025 and upserts them (2025 + 2026 YTD are both fetched)
 *   3. Prints a summary filtered to 2025 period_end_at for reporting clarity
 *
 * Idempotent — upserts on id conflict, safe to re-run.
 *
 * Note: the SP-API FinancialEventGroupStartedAfter parameter means groups that
 * STARTED after that date. Groups that started in late 2024 but closed in 2025
 * will be missed. For full coverage confirm via Seller Central settlement reports.
 */

import { config } from 'dotenv'
import path from 'path'

config({ path: path.resolve(process.cwd(), '.env.local') })
config({ path: path.resolve(process.cwd(), '.env') })

import { createClient } from '@supabase/supabase-js'
import { syncSettlementsForRange } from '../lib/amazon/settlements-sync'
import { spApiConfigured } from '../lib/amazon/client'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

// Days since 2025-01-01 — gives full 2025 + 2026 YTD coverage.
// SP-API supports ~18 months (540 days). Review this value if running in late 2026.
const TARGET_START = new Date('2025-01-01T00:00:00Z')
const daysBack = Math.ceil((Date.now() - TARGET_START.getTime()) / (1000 * 60 * 60 * 24)) + 1

async function main() {
  if (!spApiConfigured()) {
    console.error(
      'SP-API not configured. Set AMAZON_SP_CLIENT_ID, AMAZON_SP_CLIENT_SECRET,\n' +
        'AMAZON_SP_REFRESH_TOKEN, AMAZON_AWS_ACCESS_KEY, AMAZON_AWS_SECRET_KEY in .env.local'
    )
    process.exit(1)
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      'Supabase credentials missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local'
    )
    process.exit(1)
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  console.log(`Backfilling Amazon settlements since 2025-01-01 (${daysBack} days back)`)
  if (dryRun) console.log('DRY RUN — no writes to DB')

  const result = await syncSettlementsForRange({ daysBack, supabase, dryRun })

  console.log('\n--- Sync result (all fetched groups) ---')
  console.log(`  Fetched:  ${result.fetched} groups (all currencies)`)
  console.log(`  Skipped:  ${result.skipped} non-CAD groups`)
  console.log(`  Upserted: ${result.inserted} CAD groups`)
  console.log(`  Errors:   ${result.errors}`)

  // Query DB for 2025-specific summary (only useful on non-dry-run)
  if (!dryRun) {
    const { data: settlements2025, error } = await supabase
      .from('amazon_settlements')
      .select('period_end_at, net_payout')
      .gte('period_end_at', '2025-01-01')
      .lte('period_end_at', '2025-12-31')
      .order('period_end_at', { ascending: true })

    if (error) {
      console.error('\nFailed to query 2025 summary:', error.message)
    } else {
      const rows = settlements2025 ?? []
      const totalNet = rows.reduce((s, r) => s + (Number(r.net_payout) || 0), 0)
      const firstDate = rows[0]?.period_end_at?.slice(0, 10) ?? '—'
      const lastDate = rows[rows.length - 1]?.period_end_at?.slice(0, 10) ?? '—'

      console.log('\n--- 2025 calendar year settlements in DB ---')
      console.log(`  Settlements: ${rows.length}`)
      console.log(`  Date range:  ${firstDate} → ${lastDate}`)
      console.log(`  Total net payout: $${totalNet.toFixed(2)}`)
    }
  }

  if (result.errors > 0) {
    console.warn(`\n${result.errors} group(s) failed — check agent_events for details`)
    process.exit(1)
  }

  console.log('\nDone.')
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
