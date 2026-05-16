// Shared auth helpers for pet API routes.
// Mirrors app/api/health/_lib/auth.ts pattern.

import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { requireUser } from '@/lib/auth/require-user'

export interface PetAuthOk {
  ok: true
  supabase: SupabaseClient
  user: User
}

export interface PetAuthErr {
  ok: false
  response: NextResponse
}

export async function requirePetUser(): Promise<PetAuthOk | PetAuthErr> {
  const result = await requireUser()
  if (!result.ok) return { ok: false, response: result.response }
  return { ok: true, supabase: result.supabase, user: result.user }
}

export async function logPetEvent(
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
      domain: 'pet-health',
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
