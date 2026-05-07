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

  const visit_date = String(body.visit_date ?? '')
  const doctor_name = String(body.doctor_name ?? '').trim()
  if (!visit_date) return badRequest('visit_date is required')
  if (!doctor_name) return badRequest('doctor_name is required')

  const { data, error } = await auth.supabase
    .from('doctor_visits')
    .insert({
      person_handle: person,
      visit_date,
      doctor_name,
      specialty: String(body.specialty ?? ''),
      clinic: String(body.clinic ?? ''),
      reason: String(body.reason ?? ''),
      diagnosis: String(body.diagnosis ?? ''),
      outcome: String(body.outcome ?? ''),
      follow_up_date: body.follow_up_date ? String(body.follow_up_date) : null,
      notes: String(body.notes ?? ''),
    })
    .select('id')
    .single()

  if (error) return serverError(error.message)

  await logHealthEvent(auth.supabase, {
    user: auth.user,
    action: 'visit.add',
    summary: `${person} ${doctor_name} ${visit_date}`,
  })
  return NextResponse.json({ ok: true, id: data.id })
}
