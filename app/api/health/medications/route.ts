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

  const medication = String(body.medication ?? '').trim()
  const start_date = String(body.start_date ?? '')

  if (!medication) return badRequest('medication is required')
  if (!start_date) return badRequest('start_date is required')

  const { data, error } = await auth.supabase
    .from('medications')
    .insert({
      person_handle: person,
      medication,
      dosage: String(body.dosage ?? ''),
      frequency: String(body.frequency ?? ''),
      start_date,
      end_date: body.end_date ? String(body.end_date) : null,
      prescribing_doctor: String(body.prescribing_doctor ?? ''),
      pharmacy: String(body.pharmacy ?? ''),
      active: true,
      notes: String(body.notes ?? ''),
    })
    .select('id')
    .single()

  if (error) return serverError(error.message)

  await logHealthEvent(auth.supabase, {
    user: auth.user,
    action: 'medication.add',
    summary: `${person} ${medication}`,
  })
  return NextResponse.json({ ok: true, id: data.id })
}
