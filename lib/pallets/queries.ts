import { createServiceClient } from '@/lib/supabase/service'
import type { PalletInvoice, PalletInvoiceInsert } from './types'

/** Returns pallet invoices ordered newest-first, capped at the given month window. */
export async function listPalletInvoices(months: number = 24): Promise<PalletInvoice[]> {
  const service = createServiceClient()
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  const cutoffDate = cutoff.toISOString().slice(0, 10)

  const { data, error } = await service
    .from('pallet_invoices')
    .select('id, invoice_month, vendor, pallets_count, total_cost_incl_gst, gst_amount, notes, created_at')
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
  const { data, error } = await service
    .from('pallet_invoices')
    .insert(insert)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as PalletInvoice
}
