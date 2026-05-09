'use server'

import { createServiceClient } from '@/lib/supabase/service'
import { PalletInvoiceInsertSchema, PalletIntakeSchema } from '@/lib/pallets/validation'
import type { Pallet, PalletInvoice } from '@/lib/pallets/types'
import { insertPallet, closePallet } from '@/lib/pallets/queries'

export type SavePalletInvoiceResult =
  | { ok: true; invoice: PalletInvoice }
  | { ok: false; error: string }

export async function savePalletInvoice(rawInput: unknown): Promise<SavePalletInvoiceResult> {
  const parsed = PalletInvoiceInsertSchema.safeParse(rawInput)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: `${first.path.join('.')}: ${first.message}` }
  }

  const { invoice_month, vendor, pallets_count, total_cost_incl_gst, gst_amount, notes } =
    parsed.data

  const service = createServiceClient()

  const { data, error } = await service
    .from('pallet_invoices')
    .insert({
      invoice_month,
      vendor,
      pallets_count,
      total_cost_incl_gst,
      gst_amount,
      notes: notes ?? null,
    })
    .select()
    .single()

  if (error) return { ok: false, error: error.message }

  await service.from('agent_events').insert({
    domain: 'finance',
    action: 'pallet_invoice_created',
    actor: 'user',
    status: 'success',
    meta: { invoice_month, vendor, pallets_count, total_cost_incl_gst },
  })

  return { ok: true, invoice: data as PalletInvoice }
}

export type SavePalletResult = { ok: true; pallet: Pallet } | { ok: false; error: string }

export async function savePallet(rawInput: unknown): Promise<SavePalletResult> {
  const parsed = PalletIntakeSchema.safeParse(rawInput)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: `${first.path.join('.')}: ${first.message}` }
  }

  const { source, intake_date, est_cost_cad, notes } = parsed.data

  let pallet: Pallet
  try {
    pallet = await insertPallet({
      source,
      intake_date,
      est_cost_cad: est_cost_cad ?? null,
      notes: notes ?? null,
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Database error' }
  }

  const service = createServiceClient()
  await service.from('agent_events').insert({
    domain: 'pageprofit',
    action: 'pallet_intake_created',
    actor: 'user',
    status: 'success',
    meta: { pallet_id: pallet.id, source, intake_date, est_cost_cad: est_cost_cad ?? null },
  })

  return { ok: true, pallet }
}

export type ClosePalletResult = { ok: true } | { ok: false; error: string }

export async function closePalletAction(
  palletId: string,
  meta: { source: string; scan_count: number; est_cost_cad: number | null }
): Promise<ClosePalletResult> {
  try {
    await closePallet(palletId)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Database error' }
  }

  const service = createServiceClient()
  await service.from('agent_events').insert({
    domain: 'pageprofit',
    action: 'pallet_closed',
    actor: 'user',
    status: 'success',
    meta: { pallet_id: palletId, ...meta },
  })

  return { ok: true }
}
