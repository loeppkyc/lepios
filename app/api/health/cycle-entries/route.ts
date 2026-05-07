import { NextResponse } from 'next/server'
import {
  badRequest,
  logHealthEvent,
  parsePersonHandle,
  requireHealthUser,
  serverError,
} from '../_lib/auth'

export const dynamic = 'force-dynamic'

function clamp10(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(10, Math.round(v)))
}

export async function POST(request: Request) {
  const auth = await requireHealthUser()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return badRequest('Invalid JSON')

  const person = parsePersonHandle(body.person_handle)
  if (!person) return badRequest('Invalid person_handle')

  const entry_date = String(body.entry_date ?? '')
  if (!entry_date) return badRequest('entry_date is required')

  const cycleDayRaw = body.cycle_day
  const cycle_day =
    cycleDayRaw == null || cycleDayRaw === ''
      ? null
      : Math.max(1, Math.min(60, Math.round(Number(cycleDayRaw))))

  const pain_locations = Array.isArray(body.pain_locations)
    ? (body.pain_locations as unknown[]).map((m) => String(m))
    : []

  // Upsert by (person_handle, entry_date) — schema has UNIQUE constraint, so update
  // re-runs of the same day instead of failing.
  const { data, error } = await auth.supabase
    .from('cycle_entries')
    .upsert(
      {
        person_handle: person,
        entry_date,
        cycle_day,
        pain_level: clamp10(body.pain_level),
        pain_locations,
        bloating: clamp10(body.bloating),
        energy: clamp10(body.energy),
        mood: String(body.mood ?? ''),
        sleep_quality: clamp10(body.sleep_quality),
        bowel_status: String(body.bowel_status ?? ''),
        foods: String(body.foods ?? ''),
        supplements: String(body.supplements ?? ''),
        notes: String(body.notes ?? ''),
      },
      { onConflict: 'person_handle,entry_date' }
    )
    .select('id')
    .single()

  if (error) return serverError(error.message)

  await logHealthEvent(auth.supabase, {
    user: auth.user,
    action: 'cycle.add',
    summary: `${person} ${entry_date} pain=${clamp10(body.pain_level)}`,
  })
  return NextResponse.json({ ok: true, id: data.id })
}
