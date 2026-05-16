import { NextResponse } from 'next/server'
import { badRequest, logPetEvent, requirePetUser, serverError } from '../_lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requirePetUser()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return badRequest('Invalid JSON')

  const name = String(body.name ?? '').trim()
  const species = String(body.species ?? '').trim()

  if (!name) return badRequest('name is required')
  if (!['cat', 'dog', 'other'].includes(species)) return badRequest('Invalid species')

  const { data, error } = await auth.supabase
    .from('pets')
    .insert({
      name,
      species,
      breed: String(body.breed ?? ''),
      dob: body.dob ? String(body.dob) : null,
      weight_lbs: body.weight_lbs != null ? Number(body.weight_lbs) : null,
      colour: String(body.colour ?? ''),
      microchip: String(body.microchip ?? ''),
      fixed: ['yes', 'no', 'unknown'].includes(String(body.fixed))
        ? String(body.fixed)
        : 'unknown',
      notes: String(body.notes ?? ''),
    })
    .select('id')
    .single()

  if (error) return serverError(error.message)

  await logPetEvent(auth.supabase, {
    user: auth.user,
    action: 'pet.add',
    summary: `${name} (${species})`,
  })

  return NextResponse.json({ ok: true, id: data.id })
}
