import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { NextResponse } from 'next/server'

const BetSettleSchema = z.object({
  result: z.enum(['win', 'loss', 'push']),
  pnl: z.number(),
  bankroll_after: z.number().positive(),
  closing_odds: z.number().int().optional(),
})

// ── PATCH /api/bets/:id — settle a pending bet ───────────────────────────────

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = BetSettleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
  }

  const { id } = await params

  const { data, error } = await supabase
    .from('bets')
    .update({
      ...parsed.data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ bet: data })
}
