/**
 * Absolute session lifetime + idle timeout policy.
 *
 * Two independent timers guard every authenticated request:
 *
 *   1. Hard (absolute) timeout — SESSION_LIFETIME_MS (8h) from the moment of
 *      sign-in. Cookie: `lepios_session_expires_at` = epoch-ms string.
 *      Stamped once by /api/auth/session-start; middleware bootstraps it if
 *      missing (legacy sessions / OAuth callbacks). Never refreshed — it
 *      counts from sign-in regardless of activity.
 *
 *   2. Idle timeout — IDLE_TIMEOUT_MS (1h) since the last request. Cookie:
 *      `lepios_last_active_at` = epoch-ms string. Middleware writes it on
 *      every allowed request (rolling window). Also stamped by
 *      /api/auth/session-start so the clock starts at the login moment, not
 *      the first middleware-seen request.
 *
 * Precedence: idle timeout is checked first. A session that is both idle-
 * expired and hard-expired surfaces `idle_timeout`, because that's the more
 * actionable reason — the user was inactive, not just out of time.
 *
 * Why this lives separately from middleware-redirect.ts: pure helpers, no
 * NextRequest dependency, so tests can drive them with plain values.
 */

/** 8 hours, in milliseconds. */
export const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000

/** 8 hours, in seconds — for `Set-Cookie: max-age=…`. */
export const SESSION_LIFETIME_SECONDS = SESSION_LIFETIME_MS / 1000

/** HttpOnly cookie carrying the absolute expiry timestamp (epoch ms). */
export const SESSION_COOKIE_NAME = 'lepios_session_expires_at'

/** URL search-param value used to surface "you were logged out" on the login page. */
export const SESSION_EXPIRED_ERROR = 'session_expired'

/** 1 hour, in milliseconds. */
export const IDLE_TIMEOUT_MS = 1 * 60 * 60 * 1000

/** 1 hour, in seconds — for `Set-Cookie: max-age=…`. */
export const IDLE_TIMEOUT_SECONDS = IDLE_TIMEOUT_MS / 1000

/** HttpOnly cookie carrying the last-activity timestamp (epoch ms, rolling). */
export const IDLE_COOKIE_NAME = 'lepios_last_active_at'

/** URL search-param value surfaced on /login when idle timeout fires. */
export const IDLE_TIMEOUT_ERROR = 'idle_timeout'

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

/**
 * Decide whether the idle cookie indicates the session has gone idle.
 * Missing or malformed cookie → idle (conservative: forces re-stamp on first
 * post-login request rather than treating a missing cookie as active).
 */
export function isIdleExpired(cookieValue: string | undefined, now: number): boolean {
  if (!cookieValue) return true
  const lastActive = Number.parseInt(cookieValue, 10)
  if (!Number.isFinite(lastActive)) return true
  return now - lastActive >= IDLE_TIMEOUT_MS
}

/** Compute a fresh absolute expiry from `now`. */
export function nextSessionExpiresAt(now: number = Date.now()): number {
  return now + SESSION_LIFETIME_MS
}

/** Format the session cookie value as the helpers expect. */
export function formatSessionCookieValue(expiresAt: number): string {
  return String(expiresAt)
}

/** Format the idle cookie value (current epoch ms). */
export function formatIdleCookieValue(now: number = Date.now()): string {
  return String(now)
}
