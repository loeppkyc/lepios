/**
 * Absolute session lifetime policy.
 *
 * After a user signs in, they have at most SESSION_LIFETIME_MS of total
 * session time before they are forced to re-authenticate — regardless of
 * activity. This is an *absolute* lifetime, not an idle timeout: if the
 * cookie says "expires at T", we sign the user out at T even if they're
 * actively clicking around.
 *
 * Implementation:
 *   1. On successful sign-in, the login page calls /api/auth/session-start,
 *      which sets `lepios_session_expires_at` = `Date.now() + SESSION_LIFETIME_MS`
 *      as an HttpOnly cookie.
 *   2. On every subsequent request, middleware reads the cookie:
 *        - missing       → bootstrap a fresh expiry (handles legacy sessions
 *                          and OAuth callbacks that bypass the login page)
 *        - present & past now → sign out + redirect to /login?error=session_expired
 *        - present & future   → allow
 *
 * Why this lives separately from middleware-redirect.ts: pure helpers, no
 * NextRequest dependency, so tests can drive them with plain values.
 */

/** 4 hours, in milliseconds. */
export const SESSION_LIFETIME_MS = 4 * 60 * 60 * 1000

/** 4 hours, in seconds — for `Set-Cookie: max-age=…`. */
export const SESSION_LIFETIME_SECONDS = SESSION_LIFETIME_MS / 1000

/** HttpOnly cookie carrying the absolute expiry timestamp (epoch ms). */
export const SESSION_COOKIE_NAME = 'lepios_session_expires_at'

/** URL search-param value used to surface "you were logged out" on the login page. */
export const SESSION_EXPIRED_ERROR = 'session_expired'

/**
 * Decide whether the cookie value represents an expired session.
 * Missing or malformed cookie → expired (treat conservatively).
 */
export function isSessionExpired(cookieValue: string | undefined, now: number): boolean {
  if (!cookieValue) return true
  const expiresAt = Number.parseInt(cookieValue, 10)
  if (!Number.isFinite(expiresAt)) return true
  return expiresAt <= now
}

/** Compute a fresh absolute expiry from `now`. */
export function nextSessionExpiresAt(now: number = Date.now()): number {
  return now + SESSION_LIFETIME_MS
}

/** Format the cookie value as the helpers expect. */
export function formatSessionCookieValue(expiresAt: number): string {
  return String(expiresAt)
}
