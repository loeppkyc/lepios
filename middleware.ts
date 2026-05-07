import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { gateRequest } from '@/lib/auth/middleware-redirect'
import type { UserRole } from '@/lib/auth/roles'

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

  const outcome = gateRequest(request.nextUrl.pathname, !!user, role)

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
