/**
 * PATCH /api/predictions/[id]  — settle a prediction (authenticated)
 *
 * Sets: won, actual_pnl, actual_result, resolved_at=now()
 * Auth: session (Supabase auth cookie)
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const PredictionSettleSchema = z.object({
  won: z.boolean(),
  actual_pnl: z.number().optional(),
  actual_result: z.string().optional(),
  exit_price: z.number().positive().optional(),
})

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = PredictionSettleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const d = parsed.data

  const { data, error } = await supabase
    .from('predictions')
    .update({
      won: d.won,
      actual_pnl: d.actual_pnl ?? null,
      actual_result: d.actual_result ?? (d.won ? 'win' : 'loss'),
      exit_price: d.exit_price ?? null,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('[PATCH /api/predictions/[id]]', error)
    return NextResponse.json({ error: 'Database error', detail: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: 'Prediction not found' }, { status: 404 })
  }

  return NextResponse.json({ prediction: data })
}
