import { describe, it, expect } from 'vitest'
import { hasBusinessAccess, hasPersonalAccess, isAdmin, isApproved } from '@/lib/auth/roles'

describe('isApproved', () => {
  it('false for null/undefined', () => {
    expect(isApproved(null)).toBe(false)
    expect(isApproved(undefined)).toBe(false)
  })
  it('false for pending', () => {
    expect(isApproved('pending')).toBe(false)
  })
  it('true for any non-pending role', () => {
    expect(isApproved('admin')).toBe(true)
    expect(isApproved('business')).toBe(true)
    expect(isApproved('personal')).toBe(true)
    expect(isApproved('accountant')).toBe(true)
  })
})

describe('isAdmin', () => {
  it('true only for admin', () => {
    expect(isAdmin('admin')).toBe(true)
    expect(isAdmin('business')).toBe(false)
    expect(isAdmin('personal')).toBe(false)
    expect(isAdmin('accountant')).toBe(false)
    expect(isAdmin('pending')).toBe(false)
    expect(isAdmin(null)).toBe(false)
  })
})

describe('hasBusinessAccess', () => {
  it('admin / business / accountant pass', () => {
    expect(hasBusinessAccess('admin')).toBe(true)
    expect(hasBusinessAccess('business')).toBe(true)
    expect(hasBusinessAccess('accountant')).toBe(true)
  })
  it('personal does NOT have business access', () => {
    expect(hasBusinessAccess('personal')).toBe(false)
  })
  it('pending and null fail', () => {
    expect(hasBusinessAccess('pending')).toBe(false)
    expect(hasBusinessAccess(null)).toBe(false)
  })
})

describe('hasPersonalAccess', () => {
  it('admin / personal / accountant pass', () => {
    expect(hasPersonalAccess('admin')).toBe(true)
    expect(hasPersonalAccess('personal')).toBe(true)
    expect(hasPersonalAccess('accountant')).toBe(true)
  })
  it('business does NOT have personal access (separation of duty)', () => {
    expect(hasPersonalAccess('business')).toBe(false)
  })
  it('pending and null fail', () => {
    expect(hasPersonalAccess('pending')).toBe(false)
    expect(hasPersonalAccess(null)).toBe(false)
  })
})
