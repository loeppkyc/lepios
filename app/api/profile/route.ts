import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { UserProfile, ProfileResponse } from '@/lib/profile/types'

export const revalidate = 0
export type { UserProfile, ProfileResponse }

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('user_id, email, role, display_name, module_prefs, created_at, approved_at')
    .eq('user_id', user.id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    profile,
    auth_email: user.email ?? '',
    auth_created_at: user.created_at,
  } satisfies ProfileResponse)
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as {
    display_name?: string
    module_prefs?: string[]
    password?: string
  }

  if (body.password !== undefined) {
    const { error } = await supabase.auth.updateUser({ password: body.password })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  const update: Record<string, unknown> = {}
  if (body.display_name !== undefined) update.display_name = body.display_name || null
  if (body.module_prefs !== undefined) update.module_prefs = body.module_prefs

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .update(update)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
