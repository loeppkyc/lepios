// Shared auth + audit helpers for health API routes.

import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { requireUser } from '@/lib/auth/require-user'
import { isPersonHandle, type PersonHandle } from '@/lib/health/types'

export interface HealthAuthOk {
  ok: true
  supabase: SupabaseClient
  user: User
}

export interface HealthAuthErr {
  ok: false
  response: NextResponse
}

/**
 * Health API auth gate — delegates to `requireUser()` so role/profile checks
 * (approved + non-pending) are enforced uniformly with the rest of the app.
 *
 * Previously this only verified a Supabase session, which let `pending`
 * users hit health endpoints directly even though middleware blocked them
 * in-browser. Closing that gap as part of the api-routes-locked-down
 * sweep — defense in depth alongside RLS.
 */
export async function requireHealthUser(): Promise<HealthAuthOk | HealthAuthErr> {
  const result = await requireUser()
  if (!result.ok) return { ok: false, response: result.response }
  return { ok: true, supabase: result.supabase, user: result.user }
}

export function parsePersonHandle(value: unknown): PersonHandle | null {
  return isPersonHandle(value) ? value : null
}

export async function logHealthEvent(
  supabase: SupabaseClient,
  args: {
    user: User
    action: string
    status?: 'success' | 'error'
    summary?: string
    error?: string
  }
): Promise<void> {
  try {
    await supabase.from('agent_events').insert({
      domain: 'health',
      action: args.action,
      actor: args.user.email ?? args.user.id,
      status: args.status ?? 'success',
      output_summary: args.summary,
      error_message: args.error,
    })
  } catch {
    // best-effort logging — never fail the request
  }
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status: 400 })
}

export function serverError(message: string): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status: 500 })
}
