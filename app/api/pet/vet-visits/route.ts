import { NextResponse } from 'next/server'
import { badRequest, logPetEvent, requirePetUser, serverError } from '../_lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requirePetUser()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return badRequest('Invalid JSON')

  const petId = String(body.pet_id ?? '').trim()
  const visitDate = String(body.visit_date ?? '').trim()

  if (!petId) return badRequest('pet_id is required')
  if (!visitDate) return badRequest('visit_date is required')

  const { data, error } = await auth.supabase
    .from('vet_visits')
    .insert({
      pet_id: petId,
      visit_date: visitDate,
      clinic: String(body.clinic ?? ''),
      vet_name: String(body.vet_name ?? ''),
      reason: String(body.reason ?? ''),
      diagnosis: String(body.diagnosis ?? ''),
      treatment: String(body.treatment ?? ''),
      follow_up_date: body.follow_up_date ? String(body.follow_up_date) : null,
      cost_cad: body.cost_cad != null ? Number(body.cost_cad) : null,
      notes: String(body.notes ?? ''),
    })
    .select('id')
    .single()

  if (error) return serverError(error.message)

  await logPetEvent(auth.supabase, {
    user: auth.user,
    action: 'vet-visit.add',
    summary: `pet_id=${petId} date=${visitDate}`,
  })

  return NextResponse.json({ ok: true, id: data.id })
}
