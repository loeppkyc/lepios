import { createServiceClient } from '@/lib/supabase/service'
import type {
  DonatedBook,
  Pallet,
  PalletApRecord,
  PalletApRecordInsert,
  PalletInsert,
  PalletInvoice,
  PalletInvoiceInsert,
  PalletWithScanCount,
  RoutingBreakdown,
  SettledPalletWithAp,
  TierBreakdown,
} from './types'

/** Returns pallet invoices ordered newest-first, capped at the given month window. */
export async function listPalletInvoices(months: number = 24): Promise<PalletInvoice[]> {
  const service = createServiceClient()
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  const cutoffDate = cutoff.toISOString().slice(0, 10)

  const { data, error } = await service
    .from('pallet_invoices')
    .select(
      'id, invoice_month, vendor, pallets_count, total_cost_incl_gst, gst_amount, notes, created_at'
    )
    .gte('invoice_month', cutoffDate)
    .order('invoice_month', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as PalletInvoice[]
}

/** Sum of total_cost_incl_gst for invoices in the trailing 12 months (inclusive). */
export async function sumPalletSpendLast12Months(): Promise<number> {
  const service = createServiceClient()
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 12)
  const cutoffDate = cutoff.toISOString().slice(0, 10)

  const { data, error } = await service
    .from('pallet_invoices')
    .select('total_cost_incl_gst')
    .gte('invoice_month', cutoffDate)

  if (error) throw new Error(error.message)
  const rows = (data ?? []) as { total_cost_incl_gst: number }[]
  return Math.round(rows.reduce((sum, r) => sum + r.total_cost_incl_gst, 0) * 100) / 100
}

/** Insert a new pallet invoice. Returns the created row. */
export async function insertPalletInvoice(insert: PalletInvoiceInsert): Promise<PalletInvoice> {
  const service = createServiceClient()
  const { data, error } = await service.from('pallet_invoices').insert(insert).select().single()
  if (error) throw new Error(error.message)
  return data as PalletInvoice
}

// ── Pallets (physical units, sub-module 1) ────────────────────────────────

const EMPTY_TIER: TierBreakdown = { COLLECTIBLE: 0, HIGH_DEMAND: 0, STANDARD: 0 }
const EMPTY_ROUTING: RoutingBreakdown = { go: 0, bbv: 0, donate: 0, pending: 0 }

/** Active pallets with scan counts and tier/routing breakdown — used by /pallets Active Pallets section. */
export async function listActivePalletsWithScanCount(): Promise<PalletWithScanCount[]> {
  const service = createServiceClient()

  const { data: pallets, error: palletsError } = await service
    .from('pallets')
    .select('id, source, intake_date, est_cost_cad, status, notes, created_at')
    .eq('status', 'active')
    .order('intake_date', { ascending: false })

  if (palletsError) throw new Error(palletsError.message)
  if (!pallets?.length) return []

  const ids = pallets.map((p) => p.id as string)
  const { data: scans, error: scansError } = await service
    .from('scan_results')
    .select('pallet_id, tier, routing_decision')
    .in('pallet_id', ids)

  if (scansError) throw new Error(scansError.message)

  type BdMap = {
    scan_count: number
    tier_breakdown: TierBreakdown
    routing_breakdown: RoutingBreakdown
  }
  const bdMap = new Map<string, BdMap>()

  for (const row of scans ?? []) {
    const pid = row.pallet_id as string
    if (!bdMap.has(pid)) {
      bdMap.set(pid, {
        scan_count: 0,
        tier_breakdown: { ...EMPTY_TIER },
        routing_breakdown: { ...EMPTY_ROUTING },
      })
    }
    const bd = bdMap.get(pid)!
    bd.scan_count++
    const tier = row.tier as string | null
    if (tier === 'COLLECTIBLE') bd.tier_breakdown.COLLECTIBLE++
    else if (tier === 'HIGH_DEMAND') bd.tier_breakdown.HIGH_DEMAND++
    else if (tier === 'STANDARD') bd.tier_breakdown.STANDARD++
    const rd = row.routing_decision as string | null
    if (rd === 'go') bd.routing_breakdown.go++
    else if (rd === 'bbv') bd.routing_breakdown.bbv++
    else if (rd === 'donate') bd.routing_breakdown.donate++
    else bd.routing_breakdown.pending++
  }

  return pallets.map((p) => {
    const bd = bdMap.get(p.id) ?? {
      scan_count: 0,
      tier_breakdown: { ...EMPTY_TIER },
      routing_breakdown: { ...EMPTY_ROUTING },
    }
    return { ...(p as Pallet), ...bd }
  })
}

/** Insert a new pallet. Returns the created row. */
export async function insertPallet(insert: PalletInsert): Promise<Pallet> {
  const service = createServiceClient()
  const { data, error } = await service.from('pallets').insert(insert).select().single()
  if (error) throw new Error(error.message)
  return data as Pallet
}

/** Close a pallet (sets status = 'closed'). */
export async function closePallet(id: string): Promise<void> {
  const service = createServiceClient()
  const { error } = await service
    .from('pallets')
    .update({ status: 'closed' })
    .eq('id', id)
    .eq('status', 'active')
  if (error) throw new Error(error.message)
}

// ── AP Records (sub-module 2) ─────────────────────────────────────────────

/** Closed pallets that have no AP record yet — shown in the AP settlement section. */
export async function listClosedPalletsAwaitingAp(): Promise<Pallet[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('pallets')
    .select('id, source, intake_date, est_cost_cad, status, notes, created_at')
    .eq('status', 'closed')
    .order('intake_date', { ascending: false })

  if (error) throw new Error(error.message)
  if (!data?.length) return []

  const ids = data.map((p) => p.id as string)
  const { data: existing, error: apError } = await service
    .from('pallet_ap_records')
    .select('pallet_id')
    .in('pallet_id', ids)

  if (apError) throw new Error(apError.message)

  const settledSet = new Set((existing ?? []).map((r) => r.pallet_id as string))
  return (data as Pallet[]).filter((p) => !settledSet.has(p.id))
}

/** Recently settled pallets with their AP record — for the settlement history table. */
export async function listSettledPalletsWithAp(limit: number = 20): Promise<SettledPalletWithAp[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('pallet_ap_records')
    .select(
      'pallet_id, invoice_month, confirmed_cost_cad, gst_amount_cad, paid_on, pallets(id, source, intake_date, est_cost_cad, status, notes, created_at)'
    )
    .order('invoice_month', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)

  return (
    (data ?? []) as unknown as Array<{
      pallet_id: string
      invoice_month: string
      confirmed_cost_cad: number
      gst_amount_cad: number
      paid_on: string | null
      pallets: Pallet
    }>
  ).map((r) => ({
    ...r.pallets,
    confirmed_cost_cad: r.confirmed_cost_cad,
    gst_amount_cad: r.gst_amount_cad,
    invoice_month: r.invoice_month,
    paid_on: r.paid_on,
  }))
}

/** Insert an AP record. The DB trigger auto-settles the linked pallet. */
export async function insertApRecord(insert: PalletApRecordInsert): Promise<PalletApRecord> {
  const service = createServiceClient()
  const { data, error } = await service.from('pallet_ap_records').insert(insert).select().single()
  if (error) throw new Error(error.message)
  return data as PalletApRecord
}

// ── Donate log (sub-module 8) ─────────────────────────────────────────────

/** Books routed to donate, newest-first. */
export async function listDonatedBooks(limit: number = 30): Promise<DonatedBook[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('scan_results')
    .select('id, isbn, asin, title, author, tier, cost_paid_cad, created_at')
    .eq('routing_decision', 'donate')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)
  return (data ?? []) as DonatedBook[]
}
