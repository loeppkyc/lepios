import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { gateRequest } from '@/lib/auth/middleware-redirect'
import type { UserRole } from '@/lib/auth/roles'
import {
  SESSION_COOKIE_NAME,
  SESSION_EXPIRED_ERROR,
  SESSION_LIFETIME_SECONDS,
  formatSessionCookieValue,
  isSessionExpired,
  nextSessionExpiresAt,
} from '@/lib/auth/session-lifetime'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  let role: UserRole | null = null
  if (user) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle<{ role: UserRole }>()
    role = profile?.role ?? null
  }

  // ── Absolute session lifetime ──────────────────────────────────────────
  // After SESSION_LIFETIME_MS (4h) from sign-in, the cookie expires and we
  // sign the user out. /api/auth/session-start stamps the cookie on a fresh
  // login; missing for an authenticated user means a legacy session
  // (pre-rollout) or an OAuth callback flow — bootstrap a fresh expiry
  // rather than punishing the user. Once stamped, the timestamp inside is
  // the server-side authority; the cookie's max-age handles browser cleanup.
  let sessionExpired = false
  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (user) {
    if (!cookieValue) {
      const expiresAt = nextSessionExpiresAt()
      supabaseResponse.cookies.set(SESSION_COOKIE_NAME, formatSessionCookieValue(expiresAt), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: SESSION_LIFETIME_SECONDS,
        path: '/',
      })
    } else if (isSessionExpired(cookieValue, Date.now())) {
      sessionExpired = true
    }
  }

  const outcome = gateRequest(request.nextUrl.pathname, !!user, role, sessionExpired)

  if (outcome.kind === 'redirect-session-expired') {
    // signOut() flushes Supabase auth cookies via setAll above, which mutates
    // supabaseResponse. We then build a redirect, copy those cleared cookies
    // onto it, and also delete our own expiry cookie.
    await supabase.auth.signOut()
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.search = ''
    loginUrl.searchParams.set('error', SESSION_EXPIRED_ERROR)
    const expiredResponse = NextResponse.redirect(loginUrl)
    for (const cookie of supabaseResponse.cookies.getAll()) {
      expiredResponse.cookies.set(cookie.name, cookie.value, cookie)
    }
    expiredResponse.cookies.delete(SESSION_COOKIE_NAME)
    return expiredResponse
  }
  if (outcome.kind === 'redirect-login') {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', request.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }
  if (outcome.kind === 'redirect-pending') {
    const pendingUrl = request.nextUrl.clone()
    pendingUrl.pathname = '/pending-approval'
    pendingUrl.search = ''
    return NextResponse.redirect(pendingUrl)
  }
  if (outcome.kind === 'redirect-home') {
    const homeUrl = request.nextUrl.clone()
    homeUrl.pathname = '/'
    homeUrl.search = ''
    return NextResponse.redirect(homeUrl)
  }

  return supabaseResponse
}

export const config = {
  // Run on every path EXCEPT API routes (they self-gate via requireUser/requireCronSecret),
  // Next internals, and static assets. API routes return JSON 401/403 — redirecting them
  // would break clients expecting JSON.
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
