'use server'

import { createServiceClient } from '@/lib/supabase/service'
import { CogsEntryInsertSchema } from '@/lib/cogs/validation'
import type { CogsEntry } from '@/lib/cogs/types'

export type CogsSaveResult = { ok: true; entry: CogsEntry } | { ok: false; error: string }

export async function saveCogsEntry(rawInput: unknown): Promise<CogsSaveResult> {
  const parsed = CogsEntryInsertSchema.safeParse(rawInput)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: `${first.path.join('.')}: ${first.message}` }
  }

  const { asin, pricing_model, unit_cost_cad, quantity, purchased_at, vendor, notes, source } =
    parsed.data

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('cogs_entries')
    .insert({
      asin: asin.toUpperCase(),
      pricing_model,
      unit_cost_cad: unit_cost_cad ?? null,
      quantity,
      purchased_at,
      vendor: vendor ?? null,
      notes: notes ?? null,
      source,
      created_by: 'user',
    })
    .select()
    .single()

  if (error) return { ok: false, error: error.message }

  await supabase.from('agent_events').insert({
    domain: 'finance',
    action: 'cogs_entry_created',
    actor: 'user',
    status: 'success',
    meta: { asin, pricing_model, unit_cost_cad, quantity, purchased_at, source },
  })

  return { ok: true, entry: data as CogsEntry }
}
