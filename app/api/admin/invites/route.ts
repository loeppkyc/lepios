import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'

export async function GET() {
  const gate = await requireUser({ minRole: 'admin' })
  if (!gate.ok) return gate.response

  const { data, error } = await gate.supabase
    .from('invite_codes')
    .select('code, max_uses, uses_count, expires_at, created_at, note')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ invites: data ?? [] })
}

export async function POST(request: Request) {
  const gate = await requireUser({ minRole: 'admin' })
  if (!gate.ok) return gate.response

  const body = (await request.json().catch(() => null)) as {
    code?: string
    max_uses?: number
    expires_at?: string | null
    note?: string | null
  } | null
  if (!body?.code || typeof body.code !== 'string') {
    return NextResponse.json({ error: 'code required' }, { status: 400 })
  }
  const code = body.code.trim()
  if (code.length < 6) {
    return NextResponse.json({ error: 'code must be at least 6 characters' }, { status: 400 })
  }
  const max_uses = Number.isFinite(body.max_uses) ? Math.max(1, Math.floor(body.max_uses!)) : 1

  const { error } = await gate.supabase.from('invite_codes').insert({
    code,
    max_uses,
    uses_count: 0,
    expires_at: body.expires_at ?? null,
    note: body.note ?? null,
    created_by: gate.user.id,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await gate.supabase.from('agent_events').insert({
    domain: 'auth',
    action: 'invite_created',
    actor: 'admin_ui',
    status: 'success',
    meta: { code, max_uses, created_by: gate.user.id },
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const gate = await requireUser({ minRole: 'admin' })
  if (!gate.ok) return gate.response

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 })

  const { error } = await gate.supabase.from('invite_codes').delete().eq('code', code)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await gate.supabase.from('agent_events').insert({
    domain: 'auth',
    action: 'invite_deleted',
    actor: 'admin_ui',
    status: 'success',
    meta: { code, deleted_by: gate.user.id },
  })

  return NextResponse.json({ ok: true })
}
