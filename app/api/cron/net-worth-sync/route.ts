import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/cron/net-worth-sync
 *
 * Daily cron (08:00 UTC) that auto-updates balance_sheet_entries rows for
 * amazon (by currency/ID) and inventory from live source tables.
 *
 * Amazon splits by currency to prevent double-count:
 *   - CAD settlements → Amazon.ca row (c02fd74c...)
 *   - USD settlements → Amazon.com row (9d7ca28d...), converted to CAD at BoC rate
 *
 * NULL fund_transfer_status is treated as pending (NOT IN + IS NULL filter).
 *
 * F22: auth via requireCronSecret. Logs to agent_events for F18 observability.
 */

const AMAZON_CA_ID = 'c02fd74c-00a7-4ace-a73a-4f1ea657c2ca'
const AMAZON_COM_ID = '9d7ca28d-7d96-4c80-95bd-d75519790287'
const FALLBACK_FX_RATE = 1.37

async function fetchFxRate(): Promise<number> {
  try {
    const r = await fetch(
      'https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1'
    )
    if (!r.ok) return FALLBACK_FX_RATE
    const data = (await r.json()) as {
      observations?: Array<{ FXUSDCAD: { v: string } }>
    }
    const rate = Number(data.observations?.[0]?.FXUSDCAD?.v)
    return isFinite(rate) && rate > 0 ? rate : FALLBACK_FX_RATE
  } catch {
    return FALLBACK_FX_RATE
  }
}

export async function POST(request: Request) {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const db = createServiceClient()
  const today = new Date().toISOString().slice(0, 10)
  const warnings: string[] = []

  // --- FX rate (needed for USD→CAD conversion) ---
  const fxRate = await fetchFxRate()

  // --- 1. Amazon settlements — split by currency, include NULL status as pending ---
  // PostgREST: fund_transfer_status IS NULL OR (NOT IN Succeeded, Closed)
  const { data: settlements, error: settlementsErr } = await db
    .from('amazon_settlements')
    .select('currency, net_payout')
    .or('fund_transfer_status.is.null,and(fund_transfer_status.neq.Succeeded,fund_transfer_status.neq.Closed)')

  let amazonCadBalance = 0
  let amazonUsdBalanceCad = 0

  if (settlementsErr) {
    warnings.push(`amazon_settlements query failed: ${settlementsErr.message}`)
  } else {
    for (const row of settlements ?? []) {
      const amount = Number(row.net_payout ?? 0)
      if (row.currency === 'USD') {
        amazonUsdBalanceCad += amount * fxRate
      } else {
        amazonCadBalance += amount
      }
    }
    amazonCadBalance = Math.round(amazonCadBalance * 100) / 100
    amazonUsdBalanceCad = Math.round(amazonUsdBalanceCad * 100) / 100
  }

  // --- 2. Inventory — latest inventory_snapshots row ---
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

  // --- 3. Update Amazon.ca (CAD settlements only) ---
  const { error: caUpdateErr } = await db
    .from('balance_sheet_entries')
    .update({ balance: amazonCadBalance, as_of_date: today, source: 'auto_sync', updated_at: new Date().toISOString() })
    .eq('id', AMAZON_CA_ID)

  if (caUpdateErr) {
    warnings.push(`amazon.ca update failed: ${caUpdateErr.message}`)
  }

  // --- 4. Update Amazon.com (USD settlements → CAD) ---
  const { error: comUpdateErr } = await db
    .from('balance_sheet_entries')
    .update({ balance: amazonUsdBalanceCad, as_of_date: today, source: 'auto_sync', updated_at: new Date().toISOString() })
    .eq('id', AMAZON_COM_ID)

  if (comUpdateErr) {
    warnings.push(`amazon.com update failed: ${comUpdateErr.message}`)
  }

  // --- 5. Update inventory ---
  if (inventoryBalance !== null && inventorySnapshotDate !== null) {
    const { error: invUpdateErr } = await db
      .from('balance_sheet_entries')
      .update({ balance: inventoryBalance, as_of_date: inventorySnapshotDate, source: 'auto_sync', updated_at: new Date().toISOString() })
      .eq('category', 'inventory')

    if (invUpdateErr) {
      warnings.push(`inventory update failed: ${invUpdateErr.message}`)
    }
  }

  // --- 6. Log to agent_events (F18) ---
  await db
    .from('agent_events')
    .insert({
      domain: 'net_worth',
      action: 'net_worth_sync',
      actor: 'cron',
      status: warnings.length > 0 ? 'warning' : 'success',
      meta: {
        amazon_ca_balance: amazonCadBalance,
        amazon_com_balance_cad: amazonUsdBalanceCad,
        inventory_balance: inventoryBalance,
        snapshot_date: inventorySnapshotDate,
        fx_rate: fxRate,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
      occurred_at: new Date().toISOString(),
    })
    .then(() => void 0, () => void 0)

  return NextResponse.json({
    ok: true,
    amazon_ca_balance: amazonCadBalance,
    amazon_com_balance_cad: amazonUsdBalanceCad,
    inventory_balance: inventoryBalance,
    fx_rate: fxRate,
    ...(warnings.length > 0 ? { warnings } : {}),
  })
}

export async function GET(request: Request) {
  return POST(request)
}
