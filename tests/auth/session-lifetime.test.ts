import { describe, it, expect } from 'vitest'
import {
  SESSION_LIFETIME_MS,
  SESSION_LIFETIME_SECONDS,
  SESSION_COOKIE_NAME,
  SESSION_EXPIRED_ERROR,
  isSessionExpired,
  nextSessionExpiresAt,
  formatSessionCookieValue,
  IDLE_TIMEOUT_MS,
  IDLE_TIMEOUT_SECONDS,
  IDLE_COOKIE_NAME,
  IDLE_TIMEOUT_ERROR,
  isIdleExpired,
  formatIdleCookieValue,
} from '@/lib/auth/session-lifetime'

describe('session-lifetime constants', () => {
  it('SESSION_LIFETIME_MS is exactly 8 hours', () => {
    expect(SESSION_LIFETIME_MS).toBe(8 * 60 * 60 * 1000)
    expect(SESSION_LIFETIME_MS).toBe(28_800_000)
  })

  it('SESSION_LIFETIME_SECONDS = SESSION_LIFETIME_MS / 1000', () => {
    expect(SESSION_LIFETIME_SECONDS).toBe(SESSION_LIFETIME_MS / 1000)
    expect(SESSION_LIFETIME_SECONDS).toBe(28_800)
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

describe('idle timeout constants', () => {
  it('IDLE_TIMEOUT_MS is exactly 1 hour', () => {
    expect(IDLE_TIMEOUT_MS).toBe(1 * 60 * 60 * 1000)
    expect(IDLE_TIMEOUT_MS).toBe(3_600_000)
  })

  it('IDLE_TIMEOUT_SECONDS = IDLE_TIMEOUT_MS / 1000', () => {
    expect(IDLE_TIMEOUT_SECONDS).toBe(IDLE_TIMEOUT_MS / 1000)
    expect(IDLE_TIMEOUT_SECONDS).toBe(3_600)
  })

  it('IDLE_COOKIE_NAME is the documented name', () => {
    expect(IDLE_COOKIE_NAME).toBe('lepios_last_active_at')
  })

  it('IDLE_TIMEOUT_ERROR matches the URL param the login page checks', () => {
    expect(IDLE_TIMEOUT_ERROR).toBe('idle_timeout')
  })
})

describe('isIdleExpired', () => {
  const now = 1_700_000_000_000

  it('treats undefined as idle (no cookie = conservative)', () => {
    expect(isIdleExpired(undefined, now)).toBe(true)
  })

  it('treats empty string as idle', () => {
    expect(isIdleExpired('', now)).toBe(true)
  })

  it('treats non-numeric value as idle (defensive)', () => {
    expect(isIdleExpired('not-a-number', now)).toBe(true)
  })

  it('returns false when last activity was just now', () => {
    expect(isIdleExpired(String(now), now)).toBe(false)
  })

  it('returns false when last activity was 1ms ago', () => {
    expect(isIdleExpired(String(now - 1), now)).toBe(false)
  })

  it('returns false when last activity was just under 1 hour ago', () => {
    expect(isIdleExpired(String(now - IDLE_TIMEOUT_MS + 1), now)).toBe(false)
  })

  it('returns true when last activity was exactly 1 hour ago (boundary)', () => {
    expect(isIdleExpired(String(now - IDLE_TIMEOUT_MS), now)).toBe(true)
  })

  it('returns true when last activity was over 1 hour ago', () => {
    expect(isIdleExpired(String(now - IDLE_TIMEOUT_MS - 1), now)).toBe(true)
    expect(isIdleExpired(String(now - 2 * IDLE_TIMEOUT_MS), now)).toBe(true)
  })

  it('returns false for a fresh cookie (last_active = now - 30min)', () => {
    expect(isIdleExpired(String(now - 30 * 60 * 1000), now)).toBe(false)
  })
})

describe('formatIdleCookieValue', () => {
  const now = 1_700_000_000_000

  it('serializes an integer to string', () => {
    expect(formatIdleCookieValue(1_700_000_000_000)).toBe('1700000000000')
  })

  it('produces a value parseInt can read back', () => {
    const original = 1_700_000_000_000
    const value = formatIdleCookieValue(original)
    expect(Number.parseInt(value, 10)).toBe(original)
  })

  it('uses Date.now() when no argument passed', () => {
    const before = Date.now()
    const value = formatIdleCookieValue()
    const after = Date.now()
    const parsed = Number.parseInt(value, 10)
    expect(parsed).toBeGreaterThanOrEqual(before)
    expect(parsed).toBeLessThanOrEqual(after)
  })

  it('round-trips through isIdleExpired: fresh cookie is not idle', () => {
    const value = formatIdleCookieValue(now)
    expect(isIdleExpired(value, now)).toBe(false)
    expect(isIdleExpired(value, now + IDLE_TIMEOUT_MS - 1)).toBe(false)
    expect(isIdleExpired(value, now + IDLE_TIMEOUT_MS)).toBe(true)
  })
})
