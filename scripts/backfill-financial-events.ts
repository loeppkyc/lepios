/**
 * One-off backfill script: fetch financial events for all amazon_settlements
 * where gross IS NULL, parse them, and update the settlement rows.
 *
 * Usage (from lepios/ dir):
 *   npx tsx scripts/backfill-financial-events.ts
 *   (loads .env.production.local automatically via dotenv)
 *
 * Phase D acceptance gate:
 *   - Prints per-group: gross, fees_total, refunds_total, events_inserted
 *   - Prints 3 internal balance reconciliations (gross/fees/refunds)
 *   - Fails with non-zero exit if any settlement has a discrepancy > $0.01
 */

import { config } from 'dotenv'
import { resolve } from 'path'

// Load .env.production.local from the project root
config({ path: resolve(process.cwd(), '.env.production.local'), override: true })

import { createClient } from '@supabase/supabase-js'
import { upsertFinancialEventsForGroup } from '../lib/amazon/financial-events'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  console.log('=== Financial Events Backfill ===')
  console.log(`Started: ${new Date().toISOString()}`)
  console.log()

  // 1. Find all CAD settlements missing gross
  const { data: pending, error: fetchErr } = await supabase
    .from('amazon_settlements')
    .select('id, period_start_at, period_end_at, net_payout, fund_transfer_status')
    .is('gross', null)
    .eq('currency', 'CAD')
    .order('period_start_at', { ascending: false })

  if (fetchErr) {
    console.error('ERROR fetching pending settlements:', fetchErr.message)
    process.exit(1)
  }

  console.log(`Settlements with gross IS NULL: ${pending?.length ?? 0}`)
  console.log()

  const results: Array<{
    id: string
    period_start: string | null
    period_end: string | null
    net_payout: number | null
    events_inserted: number
    gross: number
    fees_total: number
    refunds_total: number
    skipped_event_types: string[]
    error?: string
  }> = []

  // 2. Process each group
  for (const row of pending ?? []) {
    process.stdout.write(
      `  → ${row.id.slice(0, 20)}… (${row.period_start_at?.slice(0, 10) ?? 'open'} → ${row.period_end_at?.slice(0, 10) ?? 'open'}) `
    )

    try {
      const r = await upsertFinancialEventsForGroup(row.id, supabase)
      process.stdout.write(
        `gross=${r.gross.toFixed(2)} fees=${r.fees_total.toFixed(2)} refunds=${r.refunds_total.toFixed(2)} events=${r.events_inserted}` +
          (r.skipped_event_types.length > 0 ? ` ⚠ skipped=[${r.skipped_event_types.join(',')}]` : '') +
          '\n'
      )
      results.push({
        id: row.id,
        period_start: row.period_start_at,
        period_end: row.period_end_at,
        net_payout: row.net_payout,
        events_inserted: r.events_inserted,
        gross: r.gross,
        fees_total: r.fees_total,
        refunds_total: r.refunds_total,
        skipped_event_types: r.skipped_event_types,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stdout.write(`ERROR: ${msg}\n`)
      results.push({
        id: row.id,
        period_start: row.period_start_at,
        period_end: row.period_end_at,
        net_payout: row.net_payout,
        events_inserted: 0,
        gross: 0,
        fees_total: 0,
        refunds_total: 0,
        skipped_event_types: [],
        error: msg,
      })
    }

    await sleep(1000)
  }

  // 3. Summary
  const successful = results.filter((r) => !r.error)
  const failed = results.filter((r) => r.error)
  const skippedTypes = [...new Set(results.flatMap((r) => r.skipped_event_types))].sort()

  console.log()
  console.log('=== PHASE D — Internal Balance Reconciliation ===')
  console.log()

  // Pull the final DB state to cross-check
  const { data: dbRows } = await supabase
    .from('amazon_settlements')
    .select('id, gross, fees_total, refunds_total')
    .not('gross', 'is', null)
    .eq('currency', 'CAD')

  const { data: eventRows } = await supabase
    .from('amazon_financial_events')
    .select('group_id, gross_contribution, fees_contribution, refunds_contribution')

  // Build per-group event sums from DB
  const eventSums = new Map<string, { gross: number; fees: number; refunds: number }>()
  for (const e of eventRows ?? []) {
    const cur = eventSums.get(e.group_id) ?? { gross: 0, fees: 0, refunds: 0 }
    cur.gross += Number(e.gross_contribution)
    cur.fees += Number(e.fees_contribution)
    cur.refunds += Number(e.refunds_contribution)
    eventSums.set(e.group_id, cur)
  }

  let grossDiscrepancies = 0
  let feesDiscrepancies = 0
  let refundsDiscrepancies = 0

  console.log(
    'group_id (short)               | settlement_gross | events_gross | delta | settlement_fees | events_fees | delta | settlement_refunds | events_refunds | delta'
  )
  console.log('─'.repeat(160))

  for (const s of dbRows ?? []) {
    const ev = eventSums.get(s.id) ?? { gross: 0, fees: 0, refunds: 0 }
    const grossDelta = Math.abs(Number(s.gross) - Math.round(ev.gross * 100) / 100)
    const feesDelta = Math.abs(Number(s.fees_total) - Math.round(ev.fees * 100) / 100)
    const refundsDelta = Math.abs(Number(s.refunds_total) - Math.round(ev.refunds * 100) / 100)

    const flag =
      grossDelta > 0.01 || feesDelta > 0.01 || refundsDelta > 0.01 ? '  ← DISCREPANCY' : ''

    console.log(
      `${s.id.slice(0, 30).padEnd(30)} | ${Number(s.gross).toFixed(2).padStart(16)} | ${Math.round(ev.gross * 100 / 100).toFixed(2).padStart(12)} | ${grossDelta.toFixed(2).padStart(5)} | ${Number(s.fees_total).toFixed(2).padStart(15)} | ${Math.round(ev.fees * 100 / 100).toFixed(2).padStart(11)} | ${feesDelta.toFixed(2).padStart(5)} | ${Number(s.refunds_total).toFixed(2).padStart(18)} | ${Math.round(ev.refunds * 100 / 100).toFixed(2).padStart(14)} | ${refundsDelta.toFixed(2).padStart(5)}${flag}`
    )

    if (grossDelta > 0.01) grossDiscrepancies++
    if (feesDelta > 0.01) feesDiscrepancies++
    if (refundsDelta > 0.01) refundsDiscrepancies++
  }

  console.log()
  console.log('=== SUMMARY ===')
  console.log(`Settlements before: ${pending?.length ?? 0} with gross IS NULL`)
  console.log(`Settlements processed: ${successful.length}`)
  console.log(`Settlements failed:    ${failed.length}`)
  console.log(
    `Total events inserted: ${successful.reduce((s, r) => s + r.events_inserted, 0)}`
  )
  console.log()
  console.log('Event type breakdown:')
  const { data: typeCounts } = await supabase
    .from('amazon_financial_events')
    .select('event_type')
  const counts = (typeCounts ?? []).reduce(
    (acc, r) => {
      acc[r.event_type] = (acc[r.event_type] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>
  )
  for (const [type, count] of Object.entries(counts)) {
    console.log(`  ${type}: ${count}`)
  }
  if (skippedTypes.length > 0) {
    console.log()
    console.log(`Skipped event types observed: ${skippedTypes.join(', ')}`)
  } else {
    console.log('  (no skipped event types)')
  }
  console.log()
  console.log('Internal balance reconciliation:')
  console.log(`  Gross discrepancies  (> $0.01): ${grossDiscrepancies}`)
  console.log(`  Fees discrepancies   (> $0.01): ${feesDiscrepancies}`)
  console.log(`  Refunds discrepancies (> $0.01): ${refundsDiscrepancies}`)
  console.log()

  const totalDiscrepancies = grossDiscrepancies + feesDiscrepancies + refundsDiscrepancies
  if (totalDiscrepancies > 0) {
    console.error(
      `PHASE D GATE FAILED: ${totalDiscrepancies} balance discrepancy(ies) > $0.01. Do not commit.`
    )
    process.exit(1)
  }

  if (failed.length > 0) {
    console.log(`WARNING: ${failed.length} group(s) failed to parse:`)
    for (const f of failed) {
      console.log(`  ${f.id}: ${f.error}`)
    }
    process.exit(1)
  }

  console.log('PHASE D GATE PASSED: all internal balances reconcile to the cent.')
  console.log(`Completed: ${new Date().toISOString()}`)
}

main().catch((err) => {
  console.error('Unhandled error:', err)
  process.exit(1)
})
