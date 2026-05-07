import { NextResponse } from 'next/server'
import { badRequest, logDietEvent, requireDietUser, serverError } from '../_lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requireDietUser()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return badRequest('Invalid JSON')

  const weighed_on = String(body.weighed_on ?? '')
  const weight_lbs = Number(body.weight_lbs)
  const notes = String(body.notes ?? '')

  if (!weighed_on) return badRequest('weighed_on is required')
  if (!Number.isFinite(weight_lbs) || weight_lbs <= 0) {
    return badRequest('weight_lbs must be a positive number')
  }

  // UNIQUE(weighed_on) — upsert so re-logging the same day overwrites cleanly.
  const { data, error } = await auth.supabase
    .from('weight_log')
    .upsert({ weighed_on, weight_lbs, notes }, { onConflict: 'weighed_on' })
    .select('id')
    .single()
  if (error) return serverError(error.message)

  await logDietEvent(auth.supabase, {
    user: auth.user,
    action: 'weight.add',
    summary: `${weighed_on} ${weight_lbs}lbs`,
  })
  return NextResponse.json({ ok: true, id: data.id })
}
