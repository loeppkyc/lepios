import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/cron/net-worth-sync
 *
 * Daily cron (08:00 UTC) that auto-updates the balance_sheet_entries rows for
 * category='amazon' and category='inventory' from live source tables:
 *   - amazon: SUM(net_payout) from amazon_settlements WHERE NOT Succeeded/Closed
 *   - inventory: value_at_cost from latest inventory_snapshots row
 *
 * F22: auth via requireCronSecret (never inline CRON_SECRET check).
 * Logs to agent_events for F18 observability.
 */
export async function POST(request: Request) {
  // auth: see lib/auth/cron-secret.ts (F22)
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const db = createServiceClient()
  const today = new Date().toISOString().slice(0, 10)
  const warnings: string[] = []

  // --- 1. Amazon Receivable ---
  // Sum net_payout for all settlements that are NOT yet paid out (Succeeded/Closed)
  const { data: amazonRows, error: amazonErr } = await db
    .from('amazon_settlements')
    .select('net_payout')
    .not('fund_transfer_status', 'in', '("Succeeded","Closed")')

  let amazonBalance = 0
  if (amazonErr) {
    warnings.push(`amazon_settlements query failed: ${amazonErr.message}`)
  } else if (!amazonRows || amazonRows.length === 0) {
    warnings.push('amazon_settlements: no pending rows found — setting amazon balance to 0')
    amazonBalance = 0
  } else {
    for (const row of amazonRows) {
      amazonBalance += Number(row.net_payout ?? 0)
    }
    amazonBalance = Math.round(amazonBalance * 100) / 100
  }

  // --- 2. Inventory ---
  // Latest inventory_snapshots row by snapshot_date
  const { data: invRows, error: invErr } = await db
    .from('inventory_snapshots')
    .select('snapshot_date, value_at_cost')
    .order('snapshot_date', { ascending: false })
    .limit(1)

  let inventoryBalance: number | null = null
  let inventorySnapshotDate: string | null = null
  if (invErr) {
    warnings.push(`inventory_snapshots query failed: ${invErr.message}`)
  } else if (!invRows || invRows.length === 0) {
    warnings.push('inventory_snapshots: no rows found — skipping inventory update')
  } else {
    inventoryBalance = Math.round(Number(invRows[0].value_at_cost) * 100) / 100
    inventorySnapshotDate = invRows[0].snapshot_date as string
  }

  // --- 3. Update balance_sheet_entries (amazon) ---
  const { error: amazonUpdateErr } = await db
    .from('balance_sheet_entries')
    .update({
      balance: amazonBalance,
      as_of_date: today,
      source: 'auto_sync',
      updated_at: new Date().toISOString(),
    })
    .eq('category', 'amazon')

  if (amazonUpdateErr) {
    warnings.push(`balance_sheet_entries amazon update failed: ${amazonUpdateErr.message}`)
  }

  // --- 4. Update balance_sheet_entries (inventory) — skip if no snapshot ---
  if (inventoryBalance !== null && inventorySnapshotDate !== null) {
    const { error: invUpdateErr } = await db
      .from('balance_sheet_entries')
      .update({
        balance: inventoryBalance,
        as_of_date: inventorySnapshotDate,
        source: 'auto_sync',
        updated_at: new Date().toISOString(),
      })
      .eq('category', 'inventory')

    if (invUpdateErr) {
      warnings.push(`balance_sheet_entries inventory update failed: ${invUpdateErr.message}`)
    }
  }

  // --- 5. Log to agent_events (F18 observability) ---
  const meta: Record<string, unknown> = {
    amazon_balance: amazonBalance,
    inventory_balance: inventoryBalance,
    snapshot_date: inventorySnapshotDate,
    warnings: warnings.length > 0 ? warnings : undefined,
  }

  await db
    .from('agent_events')
    .insert({
      domain: 'net_worth',
      action: 'net_worth_sync',
      actor: 'cron',
      status: warnings.length > 0 ? 'warning' : 'success',
      meta,
      occurred_at: new Date().toISOString(),
    })
    .then(
      () => void 0,
      () => void 0
    ) // non-fatal: do not fail the sync if logging fails

  return NextResponse.json({
    ok: true,
    amazon_balance: amazonBalance,
    inventory_balance: inventoryBalance,
    ...(warnings.length > 0 ? { warnings } : {}),
  })
}

// Allow GET for manual browser testing (same auth)
export async function GET(request: Request) {
  return POST(request)
}
