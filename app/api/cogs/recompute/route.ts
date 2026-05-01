import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { computeOrderCogs } from '@/lib/cogs/lookup'
import type { CogsPerAsin } from '@/lib/cogs/types'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const RecomputeSchema = z.object({
  asin: z.string().optional(), // if omitted, recompute all orders with a known COGS entry
})

/**
 * POST /api/cogs/recompute
 *
 * Backfills cogs_cad + cogs_source on existing orders rows where COGS data
 * is now available in cogs_entries. Safe to re-run (idempotent — upserts on id).
 *
 * Day 2 scope: historical backfill. New orders get cogs_cad at sync time via
 * orders-sync.ts. This endpoint catches orders synced before their COGS entry existed.
 *
 * Process:
 *  1. Load cogs_per_asin_view (optionally filtered to one ASIN)
 *  2. Fetch matching orders rows (id, asin, quantity)
 *  3. Compute cogs_cad per row via computeOrderCogs()
 *  4. Batch upsert in 100-row chunks
 */
export async function POST(request: Request) {
  const authClient = await createClient()
  const {
    data: { user },
  } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const parsed = RecomputeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { asin: filterAsin } = parsed.data
  const supabase = createServiceClient()

  // Step 1: which ASINs have COGS entries?
  let viewQuery = supabase.from('cogs_per_asin_view').select('*')
  if (filterAsin) viewQuery = viewQuery.eq('asin', filterAsin.toUpperCase())

  const { data: cogsRows, error: viewError } = await viewQuery
  if (viewError) return NextResponse.json({ error: viewError.message }, { status: 500 })
  if (!cogsRows || cogsRows.length === 0) {
    return NextResponse.json({ updated: 0, message: 'No COGS entries found for recompute scope' })
  }

  const cogsMap = new Map<string, CogsPerAsin>(
    cogsRows.map((r) => [
      r.asin as string,
      {
        asin: r.asin as string,
        weighted_avg_unit_cost: r.weighted_avg_unit_cost as number | null,
        latest_unit_cost: r.latest_unit_cost as number | null,
        total_quantity_purchased: r.total_quantity_purchased as number,
        has_pallet_entries: r.has_pallet_entries as boolean,
        entry_count: r.entry_count as number,
      },
    ])
  )

  const cogsAsins = [...cogsMap.keys()]

  // Step 2: fetch orders rows for these ASINs
  const { data: ordersRows, error: ordersError } = await supabase
    .from('orders')
    .select('id, asin, quantity')
    .in('asin', cogsAsins)

  if (ordersError) return NextResponse.json({ error: ordersError.message }, { status: 500 })
  if (!ordersRows || ordersRows.length === 0) {
    return NextResponse.json({ updated: 0, message: 'No matching orders found' })
  }

  // Step 3: compute + batch upsert in 100-row chunks (PostgREST safe)
  const CHUNK = 100
  let updated = 0
  let errors = 0

  for (let i = 0; i < ordersRows.length; i += CHUNK) {
    const chunk = ordersRows.slice(i, i + CHUNK)
    const updates = chunk.map((row) => {
      const { cogs_cad, cogs_source } = computeOrderCogs(
        row.asin as string,
        row.quantity as number,
        cogsMap
      )
      return { id: row.id as string, cogs_cad, cogs_source }
    })

    const { error: upsertError } = await supabase
      .from('orders')
      .upsert(updates, { onConflict: 'id' })

    if (upsertError) {
      errors++
    } else {
      updated += chunk.length
    }
  }

  await supabase.from('agent_events').insert({
    domain: 'finance',
    action: 'cogs_recompute',
    actor: 'user',
    status: errors > 0 ? 'partial' : 'success',
    meta: { asin: filterAsin ?? 'all', updated, errors, cogs_asins_count: cogsAsins.length },
  })

  return NextResponse.json({ updated, errors, cogs_asins_recomputed: cogsAsins.length })
}
