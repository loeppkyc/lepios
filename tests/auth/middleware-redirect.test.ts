import { describe, it, expect } from 'vitest'
import { isPublicPath, shouldRedirectToLogin } from '@/lib/auth/middleware-redirect'

describe('isPublicPath', () => {
  it('treats /login exactly as public', () => {
    expect(isPublicPath('/login')).toBe(true)
  })

  it('treats /login/anything as public', () => {
    expect(isPublicPath('/login/forgot')).toBe(true)
  })

  it('treats /auth/callback as public (Supabase OAuth)', () => {
    expect(isPublicPath('/auth/callback')).toBe(true)
  })

  it('treats /auth/recovery as public', () => {
    expect(isPublicPath('/auth/recovery')).toBe(true)
  })

  it('does NOT treat /chat as public', () => {
    expect(isPublicPath('/chat')).toBe(false)
  })

  it('does NOT treat / as public', () => {
    expect(isPublicPath('/')).toBe(false)
  })

  it('does NOT treat /loginabc as public (prefix-only false positive guard)', () => {
    expect(isPublicPath('/loginabc')).toBe(false)
  })

  it('does NOT treat /authsomething as public', () => {
    expect(isPublicPath('/authsomething')).toBe(false)
  })
})

describe('shouldRedirectToLogin', () => {
  it('redirects unauthenticated user away from /chat', () => {
    expect(shouldRedirectToLogin('/chat', false)).toBe(true)
  })

  it('redirects unauthenticated user away from / (root → /money)', () => {
    expect(shouldRedirectToLogin('/', false)).toBe(true)
  })

  it('does NOT redirect when user is authenticated, even from /chat', () => {
    expect(shouldRedirectToLogin('/chat', true)).toBe(false)
  })

  it('does NOT redirect from /login regardless of auth state', () => {
    expect(shouldRedirectToLogin('/login', false)).toBe(false)
    expect(shouldRedirectToLogin('/login', true)).toBe(false)
  })

  it('does NOT redirect from /auth/callback regardless of auth state', () => {
    expect(shouldRedirectToLogin('/auth/callback', false)).toBe(false)
    expect(shouldRedirectToLogin('/auth/callback', true)).toBe(false)
  })
})
