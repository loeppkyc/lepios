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

  const started_on = String(body.started_on ?? '')
  const symptom = String(body.symptom ?? '').trim()
  const severity = Number(body.severity)
  const duration = String(body.duration ?? '')
  const notes = String(body.notes ?? '')

  if (!started_on) return badRequest('started_on is required')
  if (!symptom) return badRequest('symptom is required')
  if (!Number.isInteger(severity) || severity < 1 || severity > 10) {
    return badRequest('severity must be 1-10')
  }

  const { data, error } = await auth.supabase
    .from('symptoms')
    .insert({ person_handle: person, started_on, symptom, severity, duration, notes })
    .select('id')
    .single()

  if (error) return serverError(error.message)

  await logHealthEvent(auth.supabase, {
    user: auth.user,
    action: 'symptom.add',
    summary: `${person} ${symptom} sev=${severity}`,
  })

  return NextResponse.json({ ok: true, id: data.id })
}
