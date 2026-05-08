/**
 * Unit tests for lib/harness/safety/v2/router.ts.
 *
 * Pure decision routing. Tests cover the full matrix from the routing table
 * in the module's docstring.
 */

import { describe, it, expect } from 'vitest'
import { routeSafetyDecision } from '@/lib/harness/safety/v2/router'

describe('routeSafetyDecision — E2E hard fail', () => {
  it('low + e2e false → colin_escalate', () => {
    const r = routeSafetyDecision({ tier: 'low', e2e_pass: false })
    expect(r.action).toBe('colin_escalate')
    expect(r.reason).toContain('e2e_fail')
  })

  it('medium + e2e false → colin_escalate (twin not consulted)', () => {
    const r = routeSafetyDecision({
      tier: 'medium',
      e2e_pass: false,
      twin: 'proceed', // ignored — e2e fail wins
    })
    expect(r.action).toBe('colin_escalate')
  })

  it('high + e2e false → colin_escalate', () => {
    const r = routeSafetyDecision({ tier: 'high', e2e_pass: false })
    expect(r.action).toBe('colin_escalate')
  })
})

describe('routeSafetyDecision — high tier', () => {
  it('high + e2e true → colin_escalate (twin skipped)', () => {
    const r = routeSafetyDecision({ tier: 'high', e2e_pass: true })
    expect(r.action).toBe('colin_escalate')
    expect(r.reason).toContain('high-risk')
  })

  it('high + e2e null → colin_escalate', () => {
    const r = routeSafetyDecision({ tier: 'high', e2e_pass: null })
    expect(r.action).toBe('colin_escalate')
  })
})

describe('routeSafetyDecision — low tier', () => {
  it('low + e2e true → auto_merge', () => {
    const r = routeSafetyDecision({ tier: 'low', e2e_pass: true })
    expect(r.action).toBe('auto_merge')
    expect(r.reason).toContain('low')
  })

  it('low + e2e null (no surface) → auto_merge', () => {
    const r = routeSafetyDecision({ tier: 'low', e2e_pass: null })
    expect(r.action).toBe('auto_merge')
    expect(r.reason).toContain('no e2e surface')
  })
})

describe('routeSafetyDecision — medium tier (twin consultation)', () => {
  it('medium + twin proceed → twin_proceed', () => {
    const r = routeSafetyDecision({
      tier: 'medium',
      e2e_pass: true,
      twin: 'proceed',
    })
    expect(r.action).toBe('twin_proceed')
  })

  it('medium + twin hold → twin_hold (gate writes 24h retry)', () => {
    const r = routeSafetyDecision({
      tier: 'medium',
      e2e_pass: true,
      twin: 'hold',
    })
    expect(r.action).toBe('twin_hold')
    expect(r.reason).toContain('24h')
  })

  it('medium + twin escalate → twin_escalate', () => {
    const r = routeSafetyDecision({
      tier: 'medium',
      e2e_pass: true,
      twin: 'escalate',
    })
    expect(r.action).toBe('twin_escalate')
  })

  it('medium + twin null → twin_unavailable (fail-safe)', () => {
    const r = routeSafetyDecision({
      tier: 'medium',
      e2e_pass: true,
      twin: null,
    })
    expect(r.action).toBe('twin_unavailable')
    expect(r.reason).toContain('fail-safe')
  })

  it('medium + twin undefined → twin_unavailable', () => {
    const r = routeSafetyDecision({
      tier: 'medium',
      e2e_pass: true,
    })
    expect(r.action).toBe('twin_unavailable')
  })

  it('medium + e2e null + twin proceed → twin_proceed (no E2E surface, twin still consulted)', () => {
    const r = routeSafetyDecision({
      tier: 'medium',
      e2e_pass: null,
      twin: 'proceed',
    })
    expect(r.action).toBe('twin_proceed')
  })
})

describe('routeSafetyDecision — reason strings present', () => {
  const cases: Array<Parameters<typeof routeSafetyDecision>[0]> = [
    { tier: 'low', e2e_pass: true },
    { tier: 'low', e2e_pass: null },
    { tier: 'low', e2e_pass: false },
    { tier: 'medium', e2e_pass: true, twin: 'proceed' },
    { tier: 'medium', e2e_pass: true, twin: 'hold' },
    { tier: 'medium', e2e_pass: true, twin: 'escalate' },
    { tier: 'medium', e2e_pass: false },
    { tier: 'medium', e2e_pass: null, twin: null },
    { tier: 'high', e2e_pass: true },
    { tier: 'high', e2e_pass: false },
  ]
  it.each(cases)('reason is non-empty for %o', (input) => {
    expect(routeSafetyDecision(input).reason).toMatch(/.+/)
  })
})
