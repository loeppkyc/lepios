/**
 * Pure helpers for the root middleware's auth-redirect decision.
 * Kept separate from `middleware.ts` so the logic is testable without
 * spinning up a NextRequest.
 */

import type { UserRole } from './roles'

const PUBLIC_PATH_PREFIXES = ['/login', '/auth/', '/pending-approval'] as const

const ADMIN_PATH_PREFIX = '/admin'

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((prefix) =>
    prefix.endsWith('/')
      ? pathname.startsWith(prefix)
      : pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_PATH_PREFIX || pathname.startsWith(`${ADMIN_PATH_PREFIX}/`)
}

export function shouldRedirectToLogin(pathname: string, hasUser: boolean): boolean {
  if (hasUser) return false
  return !isPublicPath(pathname)
}

export type GateOutcome =
  | { kind: 'allow' }
  | { kind: 'redirect-login' }
  | { kind: 'redirect-pending' }
  | { kind: 'redirect-home' } // signed-in user hitting /login

/**
 * Single source of truth for the middleware decision.
 * - Unauthenticated on a public path → allow.
 * - Unauthenticated on a protected path → redirect to /login.
 * - Authenticated but no profile → redirect to /pending-approval (signs them out at the page level).
 * - Authenticated + pending → redirect to /pending-approval (except already on it).
 * - Authenticated + non-admin on /admin → redirect to /pending-approval.
 * - Authenticated + approved on /login → redirect to /.
 */
export function gateRequest(
  pathname: string,
  hasUser: boolean,
  role: UserRole | null
): GateOutcome {
  const onLogin = pathname === '/login' || pathname.startsWith('/login/')
  const onPending = pathname === '/pending-approval' || pathname.startsWith('/pending-approval/')
  const onAuthCallback = pathname.startsWith('/auth/')

  if (!hasUser) {
    if (isPublicPath(pathname)) return { kind: 'allow' }
    return { kind: 'redirect-login' }
  }

  // Authenticated but no profile row — treat as pending.
  if (role === null) {
    if (onPending || onAuthCallback) return { kind: 'allow' }
    return { kind: 'redirect-pending' }
  }

  // Already approved + on /login → bounce home.
  if (onLogin && role !== 'pending') return { kind: 'redirect-home' }

  // Pending users: only the pending page + auth callbacks.
  if (role === 'pending') {
    if (onPending || onAuthCallback || onLogin) return { kind: 'allow' }
    return { kind: 'redirect-pending' }
  }

  // Admin paths require admin.
  if (isAdminPath(pathname) && role !== 'admin') {
    return { kind: 'redirect-pending' }
  }

  return { kind: 'allow' }
}
