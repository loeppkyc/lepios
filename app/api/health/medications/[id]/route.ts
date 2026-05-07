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
  if ('active' in body) update.active = Boolean(body.active)
  if ('end_date' in body) {
    update.end_date = body.end_date === null ? null : String(body.end_date)
  }
  if ('notes' in body) update.notes = String(body.notes ?? '')
  if ('dosage' in body) update.dosage = String(body.dosage ?? '')
  if ('frequency' in body) update.frequency = String(body.frequency ?? '')

  if (Object.keys(update).length === 0) return badRequest('No updatable fields provided')

  const { error } = await auth.supabase.from('medications').update(update).eq('id', id)
  if (error) return serverError(error.message)

  await logHealthEvent(auth.supabase, {
    user: auth.user,
    action: 'medication.update',
    summary: `id=${id} ${Object.keys(update).join(',')}`,
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: Request, ctx: RouteCtx) {
  const auth = await requireHealthUser()
  if (!auth.ok) return auth.response

  const { id } = await ctx.params
  const { error } = await auth.supabase.from('medications').delete().eq('id', id)
  if (error) return serverError(error.message)

  await logHealthEvent(auth.supabase, {
    user: auth.user,
    action: 'medication.delete',
    summary: `id=${id}`,
  })
  return NextResponse.json({ ok: true })
}
