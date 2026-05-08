import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  SESSION_COOKIE_NAME,
  SESSION_LIFETIME_SECONDS,
  formatSessionCookieValue,
  nextSessionExpiresAt,
} from '@/lib/auth/session-lifetime'

/**
 * POST /api/auth/session-start
 *
 * Called by the login page immediately after a successful
 * supabase.auth.signInWithPassword(). Stamps the absolute-lifetime cookie
 * (`lepios_session_expires_at`) with `now + SESSION_LIFETIME_MS`.
 *
 * The middleware bootstrap path will also set this cookie if it's missing
 * for an authenticated user — but that path uses "first request after the
 * Supabase session was minted" as T0, which can drift up to a few seconds.
 * This explicit endpoint guarantees the timestamp matches the actual login
 * moment, and forces a clean reset when the same user signs out and back
 * in (otherwise the existing cookie would carry over with stale expiry).
 *
 * Auth: must already have a valid Supabase session. Returns 401 otherwise.
 */
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const expiresAt = nextSessionExpiresAt()
  const response = NextResponse.json({ ok: true, expiresAt })
  response.cookies.set(SESSION_COOKIE_NAME, formatSessionCookieValue(expiresAt), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_LIFETIME_SECONDS,
    path: '/',
  })
  return response
}
