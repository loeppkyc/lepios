'use server'

import { createServiceClient } from '@/lib/supabase/service'

export type SaveUtilityBillResult = { ok: true } | { ok: false; error: string }

/**
 * Upsert a utility bill month entry.
 * Provider is passed from the form — never hardcoded here.
 * ON CONFLICT (month) DO UPDATE implements idempotent update semantics.
 */
export async function saveUtilityBill(params: {
  month: string
  kwh: number
  amount: number
  provider: string
  notes: string
}): Promise<SaveUtilityBillResult> {
  const { month, kwh, amount, provider, notes } = params

  // Validate month format server-side (defence against direct calls)
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return { ok: false, error: 'Month must be YYYY-MM format.' }
  }
  if (kwh < 0) {
    return { ok: false, error: 'kWh must be 0 or greater.' }
  }
  if (amount < 0) {
    return { ok: false, error: 'Amount must be 0 or greater.' }
  }

  const supabase = createServiceClient()

  const { error: upsertError } = await supabase.from('utility_bills').upsert(
    {
      month,
      kwh,
      amount_cad: amount,
      provider,
      notes: notes || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'month' }
  )

  if (upsertError) {
    return { ok: false, error: upsertError.message }
  }

  // F18: log save event for autonomous querying
  await supabase.from('agent_events').insert({
    domain: 'finance',
    action: 'utility_bill_saved',
    actor: 'user',
    status: 'success',
    meta: { month, kwh, amount_cad: amount },
  })

  return { ok: true }
}
