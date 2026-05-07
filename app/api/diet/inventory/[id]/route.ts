import { NextResponse } from 'next/server'
import { badRequest, logDietEvent, requireDietUser, serverError } from '../../_lib/auth'

export const dynamic = 'force-dynamic'

interface RouteCtx {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, ctx: RouteCtx) {
  const auth = await requireDietUser()
  if (!auth.ok) return auth.response
  const { id } = await ctx.params

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return badRequest('Invalid JSON')

  const update: Record<string, unknown> = {}
  if ('status' in body) update.status = String(body.status ?? 'On hand')
  if ('qty' in body) update.qty = Number(body.qty)
  if ('expires_on' in body) {
    update.expires_on = body.expires_on === null ? null : String(body.expires_on)
  }
  if ('notes' in body) update.notes = String(body.notes ?? '')

  if (Object.keys(update).length === 0) return badRequest('No updatable fields provided')

  const { error } = await auth.supabase.from('grocery_inventory').update(update).eq('id', id)
  if (error) return serverError(error.message)

  await logDietEvent(auth.supabase, {
    user: auth.user,
    action: 'inventory.update',
    summary: `id=${id} ${Object.keys(update).join(',')}`,
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: Request, ctx: RouteCtx) {
  const auth = await requireDietUser()
  if (!auth.ok) return auth.response
  const { id } = await ctx.params

  const { error } = await auth.supabase.from('grocery_inventory').delete().eq('id', id)
  if (error) return serverError(error.message)

  await logDietEvent(auth.supabase, {
    user: auth.user,
    action: 'inventory.delete',
    summary: `id=${id}`,
  })
  return NextResponse.json({ ok: true })
}
