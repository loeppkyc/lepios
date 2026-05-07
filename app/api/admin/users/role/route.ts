import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'
import type { UserRole } from '@/lib/auth/roles'

const VALID_ROLES: ReadonlySet<UserRole> = new Set([
  'admin',
  'business',
  'personal',
  'accountant',
  'pending',
])

export async function POST(request: Request) {
  const gate = await requireUser({ minRole: 'admin' })
  if (!gate.ok) return gate.response

  const body = (await request.json().catch(() => null)) as {
    user_id?: string
    role?: UserRole
  } | null
  if (!body?.user_id || !body.role) {
    return NextResponse.json({ error: 'user_id and role required' }, { status: 400 })
  }
  if (!VALID_ROLES.has(body.role)) {
    return NextResponse.json({ error: 'invalid role' }, { status: 400 })
  }
  if (body.user_id === gate.user.id) {
    return NextResponse.json({ error: 'cannot change your own role' }, { status: 400 })
  }

  const approved_at = body.role === 'pending' ? null : new Date().toISOString()
  const approved_by = body.role === 'pending' ? null : gate.user.id

  const { error } = await gate.supabase
    .from('user_profiles')
    .update({ role: body.role, approved_at, approved_by })
    .eq('user_id', body.user_id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await gate.supabase.from('agent_events').insert({
    domain: 'auth',
    action: 'role_changed',
    actor: 'admin_ui',
    status: 'success',
    meta: {
      target_user_id: body.user_id,
      new_role: body.role,
      changed_by: gate.user.id,
    },
  })

  return NextResponse.json({ ok: true })
}
