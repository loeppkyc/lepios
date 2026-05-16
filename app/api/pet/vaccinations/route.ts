import { NextResponse } from 'next/server'
import { badRequest, logPetEvent, requirePetUser, serverError } from '../_lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requirePetUser()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return badRequest('Invalid JSON')

  const petId = String(body.pet_id ?? '').trim()
  const givenDate = String(body.given_date ?? '').trim()
  const vaccine = String(body.vaccine ?? '').trim()

  if (!petId) return badRequest('pet_id is required')
  if (!givenDate) return badRequest('given_date is required')
  if (!vaccine) return badRequest('vaccine is required')

  const { data, error } = await auth.supabase
    .from('pet_vaccinations')
    .insert({
      pet_id: petId,
      given_date: givenDate,
      vaccine,
      next_due_date: body.next_due_date ? String(body.next_due_date) : null,
      clinic: String(body.clinic ?? ''),
      notes: String(body.notes ?? ''),
    })
    .select('id')
    .single()

  if (error) return serverError(error.message)

  await logPetEvent(auth.supabase, {
    user: auth.user,
    action: 'vaccination.add',
    summary: `pet_id=${petId} vaccine=${vaccine}`,
  })

  return NextResponse.json({ ok: true, id: data.id })
}
