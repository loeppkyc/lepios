/**
 * Unit tests for lib/harness/safety/v2/arbiter.ts.
 */

import { describe, it, expect } from 'vitest'
import {
  buildArbiterQuestion,
  parseTwinDecision,
  type SafetyArbiterInput,
} from '@/lib/harness/safety/v2/arbiter'

function makeInput(overrides: Partial<SafetyArbiterInput> = {}): SafetyArbiterInput {
  return {
    commit_sha: 'abc1234567890',
    pr_number: 42,
    risk_score: 55,
    findings: [],
    files_changed: ['lib/x.ts'],
    ...overrides,
  }
}

describe('buildArbiterQuestion', () => {
  it('includes commit short sha + PR number', () => {
    const q = buildArbiterQuestion(makeInput())
    expect(q).toContain('abc12345')
    expect(q).toContain('PR #42')
    expect(q).toContain('55/100')
  })

  it('handles null pr_number gracefully', () => {
    const q = buildArbiterQuestion(makeInput({ pr_number: null }))
    expect(q).not.toContain('PR #')
    expect(q).toContain('abc12345')
  })

  it('renders findings block with name + weight_key + evidence', () => {
    const q = buildArbiterQuestion(
      makeInput({
        findings: [
          {
            id: 'f1',
            name: 'destructive op: DROP TABLE',
            weight_key: 'SAFETY_WEIGHT_MIGRATION_DESTRUCTIVE',
            evidence: 'supabase/migrations/0163_x.sql: DROP TABLE foo',
          },
        ],
      })
    )
    expect(q).toContain('destructive op: DROP TABLE')
    expect(q).toContain('SAFETY_WEIGHT_MIGRATION_DESTRUCTIVE')
    expect(q).toContain('DROP TABLE foo')
  })

  it('caps findings at 12', () => {
    const findings = Array.from({ length: 20 }, (_, i) => ({
      id: `f${i}`,
      name: `finding-${i}`,
      weight_key: 'SAFETY_WEIGHT_BASE' as const,
      evidence: 'e',
    }))
    const q = buildArbiterQuestion(makeInput({ findings }))
    expect(q).toContain('finding-0')
    expect(q).toContain('finding-11')
    expect(q).not.toContain('finding-12')
  })

  it('caps files_changed at 10', () => {
    const files = Array.from({ length: 15 }, (_, i) => `lib/f${i}.ts`)
    const q = buildArbiterQuestion(makeInput({ files_changed: files }))
    expect(q).toContain('lib/f0.ts')
    expect(q).toContain('lib/f9.ts')
    expect(q).not.toContain('lib/f10.ts')
  })

  it('shows "(no findings)" when findings is empty', () => {
    const q = buildArbiterQuestion(makeInput({ findings: [] }))
    expect(q).toContain('(no findings)')
  })

  it('ends with the verdict-prompt line', () => {
    const q = buildArbiterQuestion(makeInput())
    expect(q).toMatch(/PROCEED, HOLD, or ESCALATE/)
  })
})

describe('parseTwinDecision', () => {
  it('parses single-word PROCEED', () => {
    expect(parseTwinDecision('PROCEED')).toBe('proceed')
  })

  it('parses single-word HOLD', () => {
    expect(parseTwinDecision('HOLD')).toBe('hold')
  })

  it('parses single-word ESCALATE', () => {
    expect(parseTwinDecision('ESCALATE')).toBe('escalate')
  })

  it('parses lowercase', () => {
    expect(parseTwinDecision('proceed')).toBe('proceed')
  })

  it('parses verdict at end of multi-word answer', () => {
    expect(
      parseTwinDecision('Looking at this, the failure pattern is mild. Recommendation: PROCEED')
    ).toBe('proceed')
  })

  it('takes the LAST keyword when multiple appear', () => {
    expect(
      parseTwinDecision('I considered ESCALATE but on reflection PROCEED is the right call.')
    ).toBe('proceed')
  })

  it('returns null when no keyword present', () => {
    expect(parseTwinDecision('I cannot decide.')).toBe(null)
  })

  it('returns null on empty string', () => {
    expect(parseTwinDecision('')).toBe(null)
  })

  it('case-insensitive: "Proceed" → proceed', () => {
    expect(parseTwinDecision('Proceed.')).toBe('proceed')
  })
})
