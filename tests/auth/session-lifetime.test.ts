import { describe, it, expect } from 'vitest'
import {
  SESSION_LIFETIME_MS,
  SESSION_LIFETIME_SECONDS,
  SESSION_COOKIE_NAME,
  SESSION_EXPIRED_ERROR,
  isSessionExpired,
  nextSessionExpiresAt,
  formatSessionCookieValue,
} from '@/lib/auth/session-lifetime'

describe('session-lifetime constants', () => {
  it('SESSION_LIFETIME_MS is exactly 4 hours', () => {
    expect(SESSION_LIFETIME_MS).toBe(4 * 60 * 60 * 1000)
    expect(SESSION_LIFETIME_MS).toBe(14_400_000)
  })

  it('SESSION_LIFETIME_SECONDS = SESSION_LIFETIME_MS / 1000', () => {
    expect(SESSION_LIFETIME_SECONDS).toBe(SESSION_LIFETIME_MS / 1000)
    expect(SESSION_LIFETIME_SECONDS).toBe(14_400)
  })

  it('SESSION_COOKIE_NAME is the documented name (do not rename without migration)', () => {
    expect(SESSION_COOKIE_NAME).toBe('lepios_session_expires_at')
  })

  it('SESSION_EXPIRED_ERROR matches the URL param the login page checks', () => {
    expect(SESSION_EXPIRED_ERROR).toBe('session_expired')
  })
})

describe('isSessionExpired', () => {
  const now = 1_700_000_000_000

  it('treats undefined as expired (no cookie = bootstrap-or-expire path)', () => {
    expect(isSessionExpired(undefined, now)).toBe(true)
  })

  it('treats empty string as expired', () => {
    expect(isSessionExpired('', now)).toBe(true)
  })

  it('treats non-numeric value as expired (defensive)', () => {
    expect(isSessionExpired('not-a-number', now)).toBe(true)
    expect(isSessionExpired('1.5e10abc', now)).toBe(true)
  })

  it('returns false when expiresAt is in the future', () => {
    expect(isSessionExpired(String(now + 60_000), now)).toBe(false)
  })

  it('returns true when expiresAt equals now (boundary — already expired)', () => {
    expect(isSessionExpired(String(now), now)).toBe(true)
  })

  it('returns true when expiresAt is in the past', () => {
    expect(isSessionExpired(String(now - 1), now)).toBe(true)
    expect(isSessionExpired(String(now - SESSION_LIFETIME_MS), now)).toBe(true)
  })

  it('returns false at expiresAt - 1ms (last valid millisecond)', () => {
    expect(isSessionExpired(String(now + 1), now)).toBe(false)
  })

  it('treats negative numbers as expired (cannot represent a future date)', () => {
    expect(isSessionExpired('-1', now)).toBe(true)
  })
})

describe('nextSessionExpiresAt', () => {
  it('returns now + SESSION_LIFETIME_MS', () => {
    const now = 1_700_000_000_000
    expect(nextSessionExpiresAt(now)).toBe(now + SESSION_LIFETIME_MS)
  })

  it('uses Date.now() when no argument passed', () => {
    const before = Date.now()
    const result = nextSessionExpiresAt()
    const after = Date.now()
    expect(result).toBeGreaterThanOrEqual(before + SESSION_LIFETIME_MS)
    expect(result).toBeLessThanOrEqual(after + SESSION_LIFETIME_MS)
  })

  it('round-trips through formatSessionCookieValue + isSessionExpired', () => {
    const now = 1_700_000_000_000
    const expiresAt = nextSessionExpiresAt(now)
    const cookieValue = formatSessionCookieValue(expiresAt)
    expect(isSessionExpired(cookieValue, now)).toBe(false)
    // After exactly SESSION_LIFETIME_MS the session is expired
    expect(isSessionExpired(cookieValue, now + SESSION_LIFETIME_MS)).toBe(true)
    // 1ms before, still valid
    expect(isSessionExpired(cookieValue, now + SESSION_LIFETIME_MS - 1)).toBe(false)
  })
})

describe('formatSessionCookieValue', () => {
  it('serializes an integer to string', () => {
    expect(formatSessionCookieValue(1_700_000_000_000)).toBe('1700000000000')
  })

  it('produces a value parseInt can read back', () => {
    const original = 1_700_000_000_000
    const value = formatSessionCookieValue(original)
    expect(Number.parseInt(value, 10)).toBe(original)
  })
})
