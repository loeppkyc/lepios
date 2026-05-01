'use server'

import { createServiceClient } from '@/lib/supabase/service'
import { z } from 'zod'
import type { CogsEntry } from '@/lib/cogs/types'

const SaveCostInputSchema = z.object({
  asin: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[A-Z0-9]+$/, 'ASIN must be uppercase alphanumeric'),
  unit_cost_cad: z.number().positive('unit_cost_cad must be positive'),
  quantity: z.number().int().positive().default(1),
  purchased_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'purchased_at must be YYYY-MM-DD'),
})

export type SaveCostResult = { ok: true; entry: CogsEntry } | { ok: false; error: string }

export async function saveCostEntry(rawInput: unknown): Promise<SaveCostResult> {
  const parsed = SaveCostInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: `${first.path.join('.')}: ${first.message}` }
  }

  const { asin, unit_cost_cad, quantity, purchased_at } = parsed.data

  const service = createServiceClient()

  const { data, error } = await service
    .from('cogs_entries')
    .insert({
      asin: asin.toUpperCase(),
      pricing_model: 'per_unit',
      unit_cost_cad,
      quantity,
      purchased_at,
      source: 'manual',
      created_by: 'user',
    })
    .select()
    .single()

  if (error) return { ok: false, error: error.message }

  await service.from('agent_events').insert({
    domain: 'finance',
    action: 'inventory_cost_saved',
    actor: 'user',
    status: 'success',
    meta: { asin, unit_cost_cad, quantity, purchased_at },
  })

  return { ok: true, entry: data as CogsEntry }
}
