// Shared auth + audit helpers for health API routes.

import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
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

export async function requireHealthUser(): Promise<HealthAuthOk | HealthAuthErr> {
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
