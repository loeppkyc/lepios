import { describe, it, expect } from 'vitest'
import {
  gateRequest,
  isAdminPath,
  isPublicPath,
  shouldRedirectToLogin,
} from '@/lib/auth/middleware-redirect'

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

describe('isAdminPath', () => {
  it('matches /admin exactly', () => {
    expect(isAdminPath('/admin')).toBe(true)
  })
  it('matches /admin/users', () => {
    expect(isAdminPath('/admin/users')).toBe(true)
  })
  it('does not match /administrator (prefix-only false positive)', () => {
    expect(isAdminPath('/administrator')).toBe(false)
  })
  it('does not match /money', () => {
    expect(isAdminPath('/money')).toBe(false)
  })
})

describe('gateRequest', () => {
  it('unauthenticated on protected path → redirect-login', () => {
    expect(gateRequest('/net-worth', false, null)).toEqual({ kind: 'redirect-login' })
  })

  it('unauthenticated on /login → allow', () => {
    expect(gateRequest('/login', false, null)).toEqual({ kind: 'allow' })
  })

  it('unauthenticated on /auth/callback → allow', () => {
    expect(gateRequest('/auth/callback', false, null)).toEqual({ kind: 'allow' })
  })

  it('authenticated but no profile → redirect-pending', () => {
    expect(gateRequest('/net-worth', true, null)).toEqual({ kind: 'redirect-pending' })
  })

  it('authenticated, no profile, on /pending-approval → allow', () => {
    expect(gateRequest('/pending-approval', true, null)).toEqual({ kind: 'allow' })
  })

  it('pending user on protected page → redirect-pending', () => {
    expect(gateRequest('/accounts', true, 'pending')).toEqual({ kind: 'redirect-pending' })
  })

  it('pending user on /pending-approval → allow', () => {
    expect(gateRequest('/pending-approval', true, 'pending')).toEqual({ kind: 'allow' })
  })

  it('pending user on /login → allow (so they can sign out and switch accounts)', () => {
    expect(gateRequest('/login', true, 'pending')).toEqual({ kind: 'allow' })
  })

  it('approved business user on /login → redirect-home', () => {
    expect(gateRequest('/login', true, 'business')).toEqual({ kind: 'redirect-home' })
  })

  it('approved admin user on /admin/users → allow', () => {
    expect(gateRequest('/admin/users', true, 'admin')).toEqual({ kind: 'allow' })
  })

  it('business user on /admin/users → redirect-pending (no admin access)', () => {
    expect(gateRequest('/admin/users', true, 'business')).toEqual({ kind: 'redirect-pending' })
  })

  it('personal user on /admin → redirect-pending', () => {
    expect(gateRequest('/admin', true, 'personal')).toEqual({ kind: 'redirect-pending' })
  })

  it('accountant user on financial page → allow (RLS gates data, middleware lets through)', () => {
    expect(gateRequest('/bookkeeping', true, 'accountant')).toEqual({ kind: 'allow' })
  })

  it('admin user on regular page → allow', () => {
    expect(gateRequest('/net-worth', true, 'admin')).toEqual({ kind: 'allow' })
  })
})

describe('gateRequest — session lifetime guard', () => {
  // Default behavior unchanged: omitting sessionExpired/idleExpired args = false.
  it('legacy 3-arg call shape still works (both timeout flags default to false)', () => {
    expect(gateRequest('/net-worth', true, 'admin')).toEqual({ kind: 'allow' })
  })

  it('authenticated + expired on protected path → redirect-session-expired', () => {
    expect(gateRequest('/net-worth', true, 'admin', true)).toEqual({
      kind: 'redirect-session-expired',
    })
  })

  it('authenticated + expired on /accounts (admin role) → redirect-session-expired', () => {
    expect(gateRequest('/accounts', true, 'admin', true)).toEqual({
      kind: 'redirect-session-expired',
    })
  })

  it('expired flag does NOT trigger on /login (user must reach login to re-auth)', () => {
    // role here is admin, but middleware will also have signed them out before
    // gateRequest sees them — this branch covers the case where the cookie
    // expired but middleware has not yet completed signOut.
    expect(gateRequest('/login', true, 'admin', true)).toEqual({ kind: 'redirect-home' })
  })

  it('expired flag does NOT trigger on /auth/callback', () => {
    expect(gateRequest('/auth/callback', true, 'admin', true)).toEqual({ kind: 'allow' })
  })

  it('expired flag does NOT trigger on /pending-approval', () => {
    expect(gateRequest('/pending-approval', true, 'pending', true)).toEqual({ kind: 'allow' })
  })

  it('unauthenticated user with expired flag → redirect-login (expired only matters with a session)', () => {
    expect(gateRequest('/net-worth', false, null, true)).toEqual({ kind: 'redirect-login' })
  })

  it('expired flag overrides role-based redirects (pending + expired → expired wins)', () => {
    expect(gateRequest('/net-worth', true, 'pending', true)).toEqual({
      kind: 'redirect-session-expired',
    })
  })

  it('expired flag overrides admin-path role check', () => {
    // Without expired: business user on /admin → redirect-pending.
    // With expired: should be redirect-session-expired (run signOut path first).
    expect(gateRequest('/admin', true, 'business', true)).toEqual({
      kind: 'redirect-session-expired',
    })
  })
})

describe('gateRequest — idle timeout guard', () => {
  it('idle only → redirect-idle-timeout on protected path', () => {
    expect(gateRequest('/net-worth', true, 'admin', false, true)).toEqual({
      kind: 'redirect-idle-timeout',
    })
  })

  it('idle + hard expired → idle wins (checked first, more actionable reason)', () => {
    expect(gateRequest('/net-worth', true, 'admin', true, true)).toEqual({
      kind: 'redirect-idle-timeout',
    })
  })

  it('neither idle nor expired → allow', () => {
    expect(gateRequest('/net-worth', true, 'admin', false, false)).toEqual({ kind: 'allow' })
  })

  it('hard expired only (not idle) → redirect-session-expired', () => {
    expect(gateRequest('/net-worth', true, 'admin', true, false)).toEqual({
      kind: 'redirect-session-expired',
    })
  })

  it('idle flag does NOT trigger on /login', () => {
    expect(gateRequest('/login', true, 'admin', false, true)).toEqual({ kind: 'redirect-home' })
  })

  it('idle flag does NOT trigger on /auth/callback', () => {
    expect(gateRequest('/auth/callback', true, 'admin', false, true)).toEqual({ kind: 'allow' })
  })

  it('idle flag does NOT trigger on /pending-approval', () => {
    expect(gateRequest('/pending-approval', true, 'pending', false, true)).toEqual({
      kind: 'allow',
    })
  })

  it('unauthenticated user with idle flag → redirect-login (no session, no idle clock)', () => {
    expect(gateRequest('/net-worth', false, null, false, true)).toEqual({ kind: 'redirect-login' })
  })

  it('idle flag overrides role-based redirects (pending + idle → idle wins)', () => {
    expect(gateRequest('/net-worth', true, 'pending', false, true)).toEqual({
      kind: 'redirect-idle-timeout',
    })
  })
})
