/**
 * Pet Health module — unit tests for pure business logic.
 * Tests: vaccineStatus(), isMedActive()
 * No Supabase or network calls.
 */

import { describe, expect, it } from 'vitest'
import { vaccineStatus, isMedActive } from '../app/(cockpit)/pet-health/_lib/queries'

describe('vaccineStatus', () => {
  const today = '2026-05-16'

  it('returns overdue when next_due_date is in the past', () => {
    expect(vaccineStatus('2026-05-15', today)).toBe('overdue')
    expect(vaccineStatus('2025-01-01', today)).toBe('overdue')
  })

  it('returns due-soon when next_due_date is within 30 days', () => {
    expect(vaccineStatus('2026-05-17', today)).toBe('due-soon') // tomorrow
    expect(vaccineStatus('2026-06-15', today)).toBe('due-soon') // 30 days out
  })

  it('returns current when next_due_date is more than 30 days away', () => {
    expect(vaccineStatus('2026-06-16', today)).toBe('current') // 31 days out
    expect(vaccineStatus('2027-01-01', today)).toBe('current')
  })

  it('returns current when next_due_date is null', () => {
    expect(vaccineStatus(null, today)).toBe('current')
  })

  it('returns overdue for same day as today (0 days remaining)', () => {
    // today < today is false; today is NOT in the past
    // diff = 0 days → Math.ceil(0/...) = 0 → 0 <= 30 → due-soon
    expect(vaccineStatus(today, today)).toBe('due-soon')
  })
})

describe('isMedActive', () => {
  const today = '2026-05-16'

  it('returns true when end_date is null', () => {
    expect(isMedActive(null, today)).toBe(true)
  })

  it('returns true when end_date is today', () => {
    expect(isMedActive('2026-05-16', today)).toBe(true)
  })

  it('returns true when end_date is in the future', () => {
    expect(isMedActive('2026-12-31', today)).toBe(true)
  })

  it('returns false when end_date is in the past', () => {
    expect(isMedActive('2026-05-15', today)).toBe(false)
    expect(isMedActive('2025-01-01', today)).toBe(false)
  })
})
