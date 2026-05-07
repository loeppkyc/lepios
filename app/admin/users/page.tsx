import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { UserProfile, UserRole } from '@/lib/auth/roles'
import { isAdmin } from '@/lib/auth/roles'
import AdminUsersClient from './client'

export const dynamic = 'force-dynamic'

interface InviteCode {
  code: string
  max_uses: number
  uses_count: number
  expires_at: string | null
  created_at: string
  note: string | null
}

export default async function AdminUsersPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/admin/users')

  const { data: me } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle<{ role: UserRole }>()
  if (!isAdmin(me?.role)) redirect('/pending-approval')

  const [{ data: profiles }, { data: invites }] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('user_id, email, role, created_at, approved_at, approved_by, notes')
      .order('created_at', { ascending: false }),
    supabase
      .from('invite_codes')
      .select('code, max_uses, uses_count, expires_at, created_at, note')
      .order('created_at', { ascending: false }),
  ])

  return (
    <AdminUsersClient
      profiles={(profiles ?? []) as UserProfile[]}
      invites={(invites ?? []) as InviteCode[]}
      currentUserId={user.id}
    />
  )
}
