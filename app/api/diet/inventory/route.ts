import { NextResponse } from 'next/server'
import { badRequest, logDietEvent, requireDietUser, serverError } from '../_lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requireDietUser()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return badRequest('Invalid JSON')

  const item = String(body.item ?? '').trim()
  const purchased_on = String(body.purchased_on ?? '')
  const qty = Number(body.qty ?? 1)
  if (!item) return badRequest('item is required')
  if (!purchased_on) return badRequest('purchased_on is required')
  if (!Number.isFinite(qty)) return badRequest('qty must be numeric')

  const { data, error } = await auth.supabase
    .from('grocery_inventory')
    .insert({
      item,
      category: String(body.category ?? 'Other'),
      qty,
      unit: String(body.unit ?? 'count'),
      purchased_on,
      expires_on: body.expires_on ? String(body.expires_on) : null,
      status: String(body.status ?? 'On hand'),
      notes: String(body.notes ?? ''),
    })
    .select('id')
    .single()
  if (error) return serverError(error.message)

  await logDietEvent(auth.supabase, {
    user: auth.user,
    action: 'inventory.add',
    summary: `${item} qty=${qty}`,
  })
  return NextResponse.json({ ok: true, id: data.id })
}
