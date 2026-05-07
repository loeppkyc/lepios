import { NextResponse } from 'next/server'
import { logDietEvent, requireDietUser, serverError } from '../../_lib/auth'

export const dynamic = 'force-dynamic'

interface RouteCtx {
  params: Promise<{ id: string }>
}

export async function DELETE(_request: Request, ctx: RouteCtx) {
  const auth = await requireDietUser()
  if (!auth.ok) return auth.response
  const { id } = await ctx.params

  const { error } = await auth.supabase.from('biomarkers').delete().eq('id', id)
  if (error) return serverError(error.message)

  await logDietEvent(auth.supabase, {
    user: auth.user,
    action: 'biomarker.delete',
    summary: `id=${id}`,
  })
  return NextResponse.json({ ok: true })
}
