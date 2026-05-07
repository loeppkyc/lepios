import { NextResponse } from 'next/server'
import { badRequest, logHealthEvent, requireHealthUser, serverError } from '../../_lib/auth'

export const dynamic = 'force-dynamic'

interface RouteCtx {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, ctx: RouteCtx) {
  const auth = await requireHealthUser()
  if (!auth.ok) return auth.response

  const { id } = await ctx.params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return badRequest('Invalid JSON')

  const update: Record<string, unknown> = {}
  if ('resolved_on' in body) {
    update.resolved_on = body.resolved_on === null ? null : String(body.resolved_on)
  }
  if ('notes' in body) update.notes = String(body.notes ?? '')

  if (Object.keys(update).length === 0) return badRequest('No updatable fields provided')

  const { error } = await auth.supabase.from('symptoms').update(update).eq('id', id)
  if (error) return serverError(error.message)

  await logHealthEvent(auth.supabase, {
    user: auth.user,
    action: 'symptom.update',
    summary: `id=${id} ${Object.keys(update).join(',')}`,
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: Request, ctx: RouteCtx) {
  const auth = await requireHealthUser()
  if (!auth.ok) return auth.response

  const { id } = await ctx.params
  const { error } = await auth.supabase.from('symptoms').delete().eq('id', id)
  if (error) return serverError(error.message)

  await logHealthEvent(auth.supabase, {
    user: auth.user,
    action: 'symptom.delete',
    summary: `id=${id}`,
  })
  return NextResponse.json({ ok: true })
}
