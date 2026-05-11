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
  IDLE_COOKIE_NAME,
  IDLE_TIMEOUT_ERROR,
  IDLE_TIMEOUT_SECONDS,
  formatIdleCookieValue,
  isIdleExpired,
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

  // ── Session lifetime + idle timeout ───────────────────────────────────
  //
  // Two HttpOnly cookies guard every authenticated request:
  //
  //   lepios_session_expires_at  — absolute 8h expiry stamped at sign-in.
  //     Missing → bootstrap (legacy session or OAuth callback). Never refreshed.
  //
  //   lepios_last_active_at      — rolling idle timestamp. Written on every
  //     allowed request. Missing → treated as idle (forces re-stamp safely).
  //
  // Both cookies are checked below. Idle is checked first; when both timers
  // have fired, idle_timeout is the surfaced reason (more actionable).
  const now = Date.now()
  let sessionExpired = false
  let idleExpired = false
  const sessionCookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value
  const idleCookieValue = request.cookies.get(IDLE_COOKIE_NAME)?.value

  if (user) {
    // Hard expiry
    if (!sessionCookieValue) {
      const expiresAt = nextSessionExpiresAt(now)
      supabaseResponse.cookies.set(SESSION_COOKIE_NAME, formatSessionCookieValue(expiresAt), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: SESSION_LIFETIME_SECONDS,
        path: '/',
      })
    } else if (isSessionExpired(sessionCookieValue, now)) {
      sessionExpired = true
    }

    // Idle timeout — only checked when hard expiry hasn't already fired
    // (avoids double-checking an already-doomed session).
    if (!sessionExpired) {
      idleExpired = isIdleExpired(idleCookieValue, now)
    }
  }

  const outcome = gateRequest(request.nextUrl.pathname, !!user, role, sessionExpired, idleExpired)

  if (outcome.kind === 'redirect-idle-timeout') {
    await supabase.auth.signOut()
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.search = ''
    loginUrl.searchParams.set('error', IDLE_TIMEOUT_ERROR)
    const idleResponse = NextResponse.redirect(loginUrl)
    for (const cookie of supabaseResponse.cookies.getAll()) {
      idleResponse.cookies.set(cookie.name, cookie.value, cookie)
    }
    idleResponse.cookies.delete(SESSION_COOKIE_NAME)
    idleResponse.cookies.delete(IDLE_COOKIE_NAME)
    return idleResponse
  }

  if (outcome.kind === 'redirect-session-expired') {
    // signOut() flushes Supabase auth cookies via setAll above, which mutates
    // supabaseResponse. We then build a redirect, copy those cleared cookies
    // onto it, and also delete both our own cookies.
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
    expiredResponse.cookies.delete(IDLE_COOKIE_NAME)
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

  // On every allowed authenticated request, roll the idle cookie forward.
  // Unauthenticated requests don't touch it (no user = no idle clock to keep).
  if (user && outcome.kind === 'allow') {
    supabaseResponse.cookies.set(IDLE_COOKIE_NAME, formatIdleCookieValue(now), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: IDLE_TIMEOUT_SECONDS,
      path: '/',
    })
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
