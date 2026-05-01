'use server'

import { createServiceClient } from '@/lib/supabase/service'
import { PalletInvoiceInsertSchema } from '@/lib/pallets/validation'
import type { PalletInvoice } from '@/lib/pallets/types'

export type SavePalletResult = { ok: true; invoice: PalletInvoice } | { ok: false; error: string }

export async function savePalletInvoice(rawInput: unknown): Promise<SavePalletResult> {
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
    .insert({ invoice_month, vendor, pallets_count, total_cost_incl_gst, gst_amount, notes: notes ?? null })
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
