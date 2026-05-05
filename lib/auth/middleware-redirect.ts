/**
 * Pure helpers for the root middleware's auth-redirect decision.
 * Kept separate from `middleware.ts` so the logic is testable without
 * spinning up a NextRequest.
 */

const PUBLIC_PATH_PREFIXES = ['/login', '/auth/'] as const

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((prefix) =>
    prefix.endsWith('/')
      ? pathname.startsWith(prefix)
      : pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

export function shouldRedirectToLogin(pathname: string, hasUser: boolean): boolean {
  if (hasUser) return false
  return !isPublicPath(pathname)
}
