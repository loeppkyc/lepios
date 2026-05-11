import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  SESSION_COOKIE_NAME,
  SESSION_LIFETIME_SECONDS,
  formatSessionCookieValue,
  nextSessionExpiresAt,
  IDLE_COOKIE_NAME,
  IDLE_TIMEOUT_SECONDS,
  formatIdleCookieValue,
} from '@/lib/auth/session-lifetime'

/**
 * POST /api/auth/session-start
 *
 * Called by the login page immediately after a successful
 * supabase.auth.signInWithPassword(). Stamps two cookies:
 *   - lepios_session_expires_at = now + SESSION_LIFETIME_MS (8h absolute)
 *   - lepios_last_active_at     = now (idle clock starts at login, not first middleware hit)
 *
 * The middleware bootstrap path will set the session cookie if it's missing,
 * but only on the first post-login request — which can drift a few seconds.
 * This explicit endpoint anchors both timestamps to the actual login moment
 * and resets them cleanly on re-login (stale cookies would otherwise carry
 * over their old values until the browser max-age expires).
 *
 * Auth: must already have a valid Supabase session. Returns 401 otherwise.
 */
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now = Date.now()
  const expiresAt = nextSessionExpiresAt(now)
  const cookieBase = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  }

  const response = NextResponse.json({ ok: true, expiresAt })
  response.cookies.set(SESSION_COOKIE_NAME, formatSessionCookieValue(expiresAt), {
    ...cookieBase,
    maxAge: SESSION_LIFETIME_SECONDS,
  })
  response.cookies.set(IDLE_COOKIE_NAME, formatIdleCookieValue(now), {
    ...cookieBase,
    maxAge: IDLE_TIMEOUT_SECONDS,
  })
  return response
}
