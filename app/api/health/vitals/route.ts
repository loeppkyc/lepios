import { NextResponse } from 'next/server'
import {
  badRequest,
  logHealthEvent,
  parsePersonHandle,
  requireHealthUser,
  serverError,
} from '../_lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requireHealthUser()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return badRequest('Invalid JSON')

  const person = parsePersonHandle(body.person_handle)
  if (!person) return badRequest('Invalid person_handle')

  const recorded_on = String(body.recorded_on ?? '')
  const vital_type = String(body.vital_type ?? '').trim()
  const value = Number(body.value)
  const unit = String(body.unit ?? '')
  const notes = String(body.notes ?? '')

  if (!recorded_on) return badRequest('recorded_on is required')
  if (!vital_type) return badRequest('vital_type is required')
  if (!Number.isFinite(value)) return badRequest('value must be numeric')

  const { data, error } = await auth.supabase
    .from('vitals')
    .insert({ person_handle: person, recorded_on, vital_type, value, unit, notes })
    .select('id')
    .single()

  if (error) return serverError(error.message)

  await logHealthEvent(auth.supabase, {
    user: auth.user,
    action: 'vital.add',
    summary: `${person} ${vital_type}=${value}${unit ? ' ' + unit : ''}`,
  })

  return NextResponse.json({ ok: true, id: data.id })
}
