import { NextResponse } from 'next/server'
import { logHealthEvent, requireHealthUser, serverError } from '../../_lib/auth'

export const dynamic = 'force-dynamic'

interface RouteCtx {
  params: Promise<{ id: string }>
}

export async function DELETE(_request: Request, ctx: RouteCtx) {
  const auth = await requireHealthUser()
  if (!auth.ok) return auth.response

  const { id } = await ctx.params
  const { error } = await auth.supabase.from('doctor_visits').delete().eq('id', id)
  if (error) return serverError(error.message)

  await logHealthEvent(auth.supabase, {
    user: auth.user,
    action: 'visit.delete',
    summary: `id=${id}`,
  })
  return NextResponse.json({ ok: true })
}
