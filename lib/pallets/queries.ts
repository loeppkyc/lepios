import { createServiceClient } from '@/lib/supabase/service'
import type {
  Pallet,
  PalletInsert,
  PalletInvoice,
  PalletInvoiceInsert,
  PalletWithScanCount,
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

/** Active pallets with scan counts — used by /pallets Active Pallets section and scanner context. */
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
  const { data: counts, error: countsError } = await service
    .from('scan_results')
    .select('pallet_id')
    .in('pallet_id', ids)

  if (countsError) throw new Error(countsError.message)

  const countMap = new Map<string, number>()
  for (const row of counts ?? []) {
    if (row.pallet_id) countMap.set(row.pallet_id, (countMap.get(row.pallet_id) ?? 0) + 1)
  }

  return pallets.map((p) => ({ ...(p as Pallet), scan_count: countMap.get(p.id) ?? 0 }))
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
