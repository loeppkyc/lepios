import { NextResponse } from 'next/server'
import { badRequest, logDietEvent, requireDietUser, serverError } from '../_lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requireDietUser()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return badRequest('Invalid JSON')

  const meal_date = String(body.meal_date ?? '')
  const meal = String(body.meal ?? '').trim()
  const description = String(body.description ?? '').trim()

  if (!meal_date) return badRequest('meal_date is required')
  if (!meal) return badRequest('meal is required')
  if (!description) return badRequest('description is required')

  const { data, error } = await auth.supabase
    .from('meal_log')
    .insert({
      meal_date,
      meal,
      description,
      calories: body.calories == null ? null : Number(body.calories),
      protein_g: body.protein_g == null ? null : Number(body.protein_g),
      carbs_g: body.carbs_g == null ? null : Number(body.carbs_g),
      fat_g: body.fat_g == null ? null : Number(body.fat_g),
      notes: String(body.notes ?? ''),
    })
    .select('id')
    .single()
  if (error) return serverError(error.message)

  await logDietEvent(auth.supabase, {
    user: auth.user,
    action: 'meal.add',
    summary: `${meal_date} ${meal}: ${description.slice(0, 40)}`,
  })
  return NextResponse.json({ ok: true, id: data.id })
}
