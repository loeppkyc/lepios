import { NextResponse } from 'next/server'
import { badRequest, logDietEvent, requireDietUser, serverError } from '../_lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requireDietUser()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return badRequest('Invalid JSON')

  const purchased_on = String(body.purchased_on ?? '')
  const store = String(body.store ?? '').trim()
  const item = String(body.item ?? '').trim()
  const price = Number(body.price)

  if (!purchased_on) return badRequest('purchased_on is required')
  if (!store) return badRequest('store is required')
  if (!item) return badRequest('item is required')
  if (!Number.isFinite(price)) return badRequest('price must be numeric')

  const { data, error } = await auth.supabase
    .from('grocery_receipts')
    .insert({
      purchased_on,
      store,
      item,
      price,
      category: String(body.category ?? 'Other'),
      qty: Number(body.qty ?? 1),
      unit: String(body.unit ?? 'count'),
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
    action: 'receipt.add',
    summary: `${store} ${item} $${price}`,
  })
  return NextResponse.json({ ok: true, id: data.id })
}
