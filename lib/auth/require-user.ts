/**
 * Auth gate for app/api/** routes that need an authenticated, approved user.
 *
 * Fail-closed parallel to requireCronSecret:
 *   - 401 if no session
 *   - 403 if signed in but role = 'pending' (or profile missing)
 *   - 403 if a higher role is required and the user does not have it
 *
 * Usage:
 *   const gate = await requireUser()
 *   if (!gate.ok) return gate.response
 *   const { user, profile, supabase } = gate
 *
 * Or with a role gate:
 *   const gate = await requireUser({ minRole: 'business' })
 */

import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import {
  hasBusinessAccess,
  hasPersonalAccess,
  isAdmin,
  isApproved,
  type UserProfile,
  type UserRole,
} from './roles'

type MinRole = 'approved' | 'personal' | 'business' | 'admin'

interface RequireUserOptions {
  minRole?: MinRole
}

interface RequireUserSuccess {
  ok: true
  user: User
  profile: UserProfile
  supabase: SupabaseClient
}

interface RequireUserFailure {
  ok: false
  response: NextResponse
}

export type RequireUserResult = RequireUserSuccess | RequireUserFailure

export async function requireUser(options: RequireUserOptions = {}): Promise<RequireUserResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('user_id, email, role, created_at, approved_at, approved_by, notes')
    .eq('user_id', user.id)
    .maybeSingle<UserProfile>()

  if (!profile) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'No profile' }, { status: 403 }),
    }
  }

  if (!hasMinRole(profile.role, options.minRole ?? 'approved')) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden', role: profile.role }, { status: 403 }),
    }
  }

  return { ok: true, user, profile, supabase }
}

function hasMinRole(role: UserRole, min: MinRole): boolean {
  switch (min) {
    case 'admin':
      return isAdmin(role)
    case 'business':
      return hasBusinessAccess(role)
    case 'personal':
      return hasPersonalAccess(role)
    case 'approved':
    default:
      return isApproved(role)
  }
}
