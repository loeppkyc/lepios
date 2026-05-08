// Shared auth + audit helpers for diet API routes.

import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { requireUser } from '@/lib/auth/require-user'

export interface DietAuthOk {
  ok: true
  supabase: SupabaseClient
  user: User
}

export interface DietAuthErr {
  ok: false
  response: NextResponse
}

/**
 * Diet API auth gate — delegates to `requireUser()` so role/profile checks
 * (approved + non-pending) are enforced uniformly with the rest of the app.
 *
 * Previously this only verified a Supabase session, which let `pending`
 * users hit diet endpoints directly even though middleware blocked them
 * in-browser. Closing that gap as part of the api-routes-locked-down
 * sweep — defense in depth alongside RLS.
 */
export async function requireDietUser(): Promise<DietAuthOk | DietAuthErr> {
  const result = await requireUser()
  if (!result.ok) return { ok: false, response: result.response }
  return { ok: true, supabase: result.supabase, user: result.user }
}

export async function logDietEvent(
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
      domain: 'diet',
      action: args.action,
      actor: args.user.email ?? args.user.id,
      status: args.status ?? 'success',
      output_summary: args.summary,
      error_message: args.error,
    })
  } catch {
    // best-effort
  }
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status: 400 })
}

export function serverError(message: string): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status: 500 })
}
