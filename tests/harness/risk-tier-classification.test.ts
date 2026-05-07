/**
 * Tests for lib/harness/risk-classifier.ts
 *
 * Pure function tests — no DB, no network, no env. The classifier is the
 * load-bearing decision for whether the deploy gate auto-merges.
 *
 * Spec: docs/sprint-5/overnight-autonomy-acceptance.md §3 + AC-A1.
 */

import { describe, it, expect } from 'vitest'
import {
  classifyRisk,
  riskScoreToTier,
  tierPermits,
  type ClassifyInput,
} from '@/lib/harness/risk-classifier'

function input(partial: Partial<ClassifyInput>): ClassifyInput {
  return {
    changed_files: [],
    added_lines: 0,
    removed_lines: 0,
    diff_text: '',
    ...partial,
  }
}

describe('classifyRisk — decision branches', () => {
  it('empty diff → low', () => {
    const result = classifyRisk(input({}))
    expect(result.required_tier).toBe('low')
    expect(result.risk_score).toBeLessThanOrEqual(20)
  })

  it('50 lines, 2 files, no special paths → low', () => {
    const result = classifyRisk(
      input({
        changed_files: ['lib/foo.ts', 'lib/bar.ts'],
        added_lines: 50,
      })
    )
    expect(result.required_tier).toBe('low')
  })

  it('199 added lines (boundary, ≤200) → low', () => {
    const result = classifyRisk(input({ changed_files: ['lib/a.ts'], added_lines: 199 }))
    expect(result.required_tier).toBe('low')
  })

  it('5 files (boundary, ≤5) → low', () => {
    const result = classifyRisk(
      input({
        changed_files: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
        added_lines: 50,
      })
    )
    expect(result.required_tier).toBe('low')
  })

  it('201 added lines → medium', () => {
    const result = classifyRisk(input({ changed_files: ['lib/a.ts'], added_lines: 201 }))
    expect(result.required_tier).toBe('medium')
  })

  it('6 files → medium', () => {
    const result = classifyRisk(
      input({
        changed_files: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'],
        added_lines: 50,
      })
    )
    expect(result.required_tier).toBe('medium')
  })

  it('250 lines, 6 files → medium (still inside medium caps)', () => {
    const result = classifyRisk(
      input({
        changed_files: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'],
        added_lines: 250,
      })
    )
    expect(result.required_tier).toBe('medium')
  })

  it('801 added lines → off (above medium cap)', () => {
    const result = classifyRisk(input({ changed_files: ['lib/a.ts'], added_lines: 801 }))
    expect(result.required_tier).toBe('off')
  })

  it('16 files → off (above medium file cap)', () => {
    const result = classifyRisk(
      input({
        changed_files: Array.from({ length: 16 }, (_, i) => `lib/f${i}.ts`),
        added_lines: 50,
      })
    )
    expect(result.required_tier).toBe('off')
  })

  it('touches package.json → off', () => {
    const result = classifyRisk(input({ changed_files: ['package.json'], added_lines: 5 }))
    expect(result.required_tier).toBe('off')
    expect(result.reasons.join(' ')).toMatch(/seam/)
  })

  it('touches package-lock.json → off', () => {
    const result = classifyRisk(input({ changed_files: ['package-lock.json'], added_lines: 5 }))
    expect(result.required_tier).toBe('off')
  })

  it('touches app/layout.tsx → off (shared seam)', () => {
    const result = classifyRisk(input({ changed_files: ['app/layout.tsx'], added_lines: 5 }))
    expect(result.required_tier).toBe('off')
  })

  it('touches middleware.ts → off (shared seam)', () => {
    const result = classifyRisk(input({ changed_files: ['middleware.ts'], added_lines: 5 }))
    expect(result.required_tier).toBe('off')
  })

  it('touches next.config.mjs → off (shared seam)', () => {
    const result = classifyRisk(input({ changed_files: ['next.config.mjs'], added_lines: 5 }))
    expect(result.required_tier).toBe('off')
  })

  it('touches eslint.config.mjs → off (shared seam)', () => {
    const result = classifyRisk(input({ changed_files: ['eslint.config.mjs'], added_lines: 5 }))
    expect(result.required_tier).toBe('off')
  })

  it('touches .claude/CLAUDE.md → off (protocol file)', () => {
    const result = classifyRisk(input({ changed_files: ['.claude/CLAUDE.md'], added_lines: 5 }))
    expect(result.required_tier).toBe('off')
  })

  it('touches scripts/window-start.mjs → off (protocol script prefix)', () => {
    const result = classifyRisk(
      input({ changed_files: ['scripts/window-start.mjs'], added_lines: 5 })
    )
    expect(result.required_tier).toBe('off')
  })

  it('touches .husky/pre-commit → off (protocol prefix)', () => {
    const result = classifyRisk(input({ changed_files: ['.husky/pre-commit'], added_lines: 5 }))
    expect(result.required_tier).toBe('off')
  })

  it('touches .env.example → off', () => {
    const result = classifyRisk(input({ changed_files: ['.env.example'], added_lines: 5 }))
    expect(result.required_tier).toBe('off')
    expect(result.reasons.join(' ')).toMatch(/env/)
  })

  it('touches .env.local → off', () => {
    const result = classifyRisk(input({ changed_files: ['.env.local'], added_lines: 5 }))
    expect(result.required_tier).toBe('off')
  })

  it('additive migration (CREATE TABLE) → off (allowlist deferred per Q3)', () => {
    // Q3 in the acceptance doc explicitly defers the allowlist. v1 of the
    // classifier routes ALL migrations to 'off' — even additive ones — until
    // the allowlist is implemented.
    const result = classifyRisk(
      input({
        changed_files: ['supabase/migrations/0200_new_table.sql'],
        added_lines: 30,
        diff_text: 'CREATE TABLE foo (id uuid primary key);',
      })
    )
    expect(result.required_tier).toBe('off')
    expect(result.reasons.join(' ')).toMatch(/migration/)
  })

  it('destructive migration (DROP COLUMN) → off', () => {
    const result = classifyRisk(
      input({
        changed_files: ['supabase/migrations/0201_drop_thing.sql'],
        added_lines: 5,
        diff_text: 'ALTER TABLE foo DROP COLUMN bar;',
      })
    )
    expect(result.required_tier).toBe('off')
  })

  it('Ollama-drafted small fix → low tier but elevated risk_score', () => {
    const without = classifyRisk(input({ changed_files: ['lib/foo.ts'], added_lines: 30 }))
    const withHint = classifyRisk(
      input({
        changed_files: ['lib/foo.ts'],
        added_lines: 30,
        drafter_tier_hint: 'tier_1_laptop_ollama',
      })
    )
    expect(withHint.risk_score).toBeGreaterThan(without.risk_score)
    expect(withHint.risk_score - without.risk_score).toBeGreaterThanOrEqual(20)
    // Tier classification is based on file/line caps, not drafter hint —
    // so the tier should still be 'low' for a small diff. The score increase
    // is only consulted when proposals are auto-promoted from task_proposals
    // (Module B). The gate itself uses the tier.
    expect(withHint.required_tier).toBe('low')
  })

  it('reasons array is always populated', () => {
    const r1 = classifyRisk(input({}))
    const r2 = classifyRisk(input({ changed_files: ['package.json'] }))
    const r3 = classifyRisk(input({ added_lines: 1000 }))
    expect(r1.reasons.length).toBeGreaterThan(0)
    expect(r2.reasons.length).toBeGreaterThan(0)
    expect(r3.reasons.length).toBeGreaterThan(0)
  })
})

describe('tierPermits — configured vs required', () => {
  it('off configured permits nothing', () => {
    expect(tierPermits('off', 'low')).toBe(false)
    expect(tierPermits('off', 'medium')).toBe(false)
    expect(tierPermits('off', 'off')).toBe(false)
  })

  it('low configured permits only low', () => {
    expect(tierPermits('low', 'low')).toBe(true)
    expect(tierPermits('low', 'medium')).toBe(false)
    expect(tierPermits('low', 'migration-allow')).toBe(false)
  })

  it('medium configured permits low and medium', () => {
    expect(tierPermits('medium', 'low')).toBe(true)
    expect(tierPermits('medium', 'medium')).toBe(true)
    expect(tierPermits('medium', 'migration-allow')).toBe(false)
  })

  it('migration-allow configured permits everything except off', () => {
    expect(tierPermits('migration-allow', 'low')).toBe(true)
    expect(tierPermits('migration-allow', 'medium')).toBe(true)
    expect(tierPermits('migration-allow', 'migration-allow')).toBe(true)
  })
})

describe('riskScoreToTier — score → tier mapping', () => {
  it('score boundaries match the spec table', () => {
    expect(riskScoreToTier(0)).toBe('low')
    expect(riskScoreToTier(20)).toBe('low')
    expect(riskScoreToTier(21)).toBe('medium')
    expect(riskScoreToTier(50)).toBe('medium')
    expect(riskScoreToTier(51)).toBe('migration-allow')
    expect(riskScoreToTier(70)).toBe('migration-allow')
    expect(riskScoreToTier(71)).toBe('off')
    expect(riskScoreToTier(100)).toBe('off')
  })
})
