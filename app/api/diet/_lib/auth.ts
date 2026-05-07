// Shared auth + audit helpers for diet API routes.

import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

export interface DietAuthOk {
  ok: true
  supabase: SupabaseClient
  user: User
}

export interface DietAuthErr {
  ok: false
  response: NextResponse
}

export async function requireDietUser(): Promise<DietAuthOk | DietAuthErr> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }),
    }
  }
  return { ok: true, supabase, user }
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
