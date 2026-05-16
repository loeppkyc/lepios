import { NextResponse } from 'next/server'
import { badRequest, logPetEvent, requirePetUser, serverError } from '../_lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requirePetUser()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return badRequest('Invalid JSON')

  const petId = String(body.pet_id ?? '').trim()
  const medication = String(body.medication ?? '').trim()
  const startDate = String(body.start_date ?? '').trim()

  if (!petId) return badRequest('pet_id is required')
  if (!medication) return badRequest('medication is required')
  if (!startDate) return badRequest('start_date is required')

  const { data, error } = await auth.supabase
    .from('pet_medications')
    .insert({
      pet_id: petId,
      medication,
      dosage: String(body.dosage ?? ''),
      frequency: String(body.frequency ?? ''),
      start_date: startDate,
      end_date: body.end_date ? String(body.end_date) : null,
      prescribing_vet: String(body.prescribing_vet ?? ''),
      notes: String(body.notes ?? ''),
    })
    .select('id')
    .single()

  if (error) return serverError(error.message)

  await logPetEvent(auth.supabase, {
    user: auth.user,
    action: 'pet-medication.add',
    summary: `pet_id=${petId} medication=${medication}`,
  })

  return NextResponse.json({ ok: true, id: data.id })
}
