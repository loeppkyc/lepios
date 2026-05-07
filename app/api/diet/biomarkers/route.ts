import { NextResponse } from 'next/server'
import { badRequest, logDietEvent, requireDietUser, serverError } from '../_lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requireDietUser()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return badRequest('Invalid JSON')

  const recorded_on = String(body.recorded_on ?? '')
  const marker = String(body.marker ?? '').trim()
  const value = Number(body.value)

  if (!recorded_on) return badRequest('recorded_on is required')
  if (!marker) return badRequest('marker is required')
  if (!Number.isFinite(value)) return badRequest('value must be numeric')

  const ref_low = body.ref_low == null ? null : Number(body.ref_low)
  const ref_high = body.ref_high == null ? null : Number(body.ref_high)

  // status auto-derives in DB trigger.
  const { data, error } = await auth.supabase
    .from('biomarkers')
    .insert({
      recorded_on,
      marker,
      value,
      unit: String(body.unit ?? ''),
      ref_low,
      ref_high,
      notes: String(body.notes ?? ''),
    })
    .select('id, status')
    .single()
  if (error) return serverError(error.message)

  await logDietEvent(auth.supabase, {
    user: auth.user,
    action: 'biomarker.add',
    summary: `${marker}=${value} (${data.status})`,
  })
  return NextResponse.json({ ok: true, id: data.id, status: data.status })
}
