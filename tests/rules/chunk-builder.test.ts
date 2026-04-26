import { describe, it, expect } from 'vitest'
import { buildArchRuleChunk, buildArchRuleChunks } from '../../lib/rules/chunk-builder'
import { RULES, type Rule } from '../../lib/rules/registry'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const F17_STUB: Rule = {
  number: 17,
  name: 'behavioral-ingestion-justification',
  scope: 'project',
  summary: 'Every new module must justify its contribution to the behavioral ingestion spec.',
  defined_at: 'CLAUDE.md:70',
  references: [],
}

const F21_STUB: Rule = {
  number: 21,
  name: 'acceptance-tests-first',
  scope: 'project',
  summary: 'Every module must have written acceptance criteria before any code is written.',
  defined_at: 'CLAUDE.md:69',
  references: [],
}

const FOUR_RULES: readonly Rule[] = [
  { number: 17, name: 'behavioral-ingestion-justification', scope: 'project', summary: 'Rule 17 summary.', defined_at: 'CLAUDE.md:70', references: [] },
  { number: 18, name: 'measurement-benchmark-required', scope: 'project', summary: 'Rule 18 summary.', defined_at: 'CLAUDE.md:71', references: [] },
  { number: 20, name: 'design-system-enforcement', scope: 'project', summary: 'Rule 20 summary.', defined_at: 'CLAUDE.md:73', references: [] },
  { number: 21, name: 'acceptance-tests-first', scope: 'project', summary: 'Rule 21 summary.', defined_at: 'CLAUDE.md:69', references: [] },
]

// ── buildArchRuleChunk — entity ID ───────────────────────────────────────────

describe('buildArchRuleChunk — entity ID', () => {
  it('uses pattern cmdingest:lepios:arch-F{number}-{name}', () => {
    const chunk = buildArchRuleChunk(F17_STUB)
    expect(chunk.entity).toBe('cmdingest:lepios:arch-F17-behavioral-ingestion-justification')
  })

  it('F21 entity ID matches the existing DB row (idempotency: skip on re-run)', () => {
    // This is the exact entity ID already in the knowledge table.
    // If it changes, the re-run would INSERT a duplicate instead of SKIP.
    const chunk = buildArchRuleChunk(F21_STUB)
    expect(chunk.entity).toBe('cmdingest:lepios:arch-F21-acceptance-tests-first')
  })

  it('entity ID contains the rule number as integer (not padded)', () => {
    const chunk = buildArchRuleChunk({ ...F17_STUB, number: 9 })
    expect(chunk.entity).toBe('cmdingest:lepios:arch-F9-behavioral-ingestion-justification')
  })
})

// ── buildArchRuleChunk — content fields ──────────────────────────────────────

describe('buildArchRuleChunk — content fields', () => {
  it('category is always "rule"', () => {
    const chunk = buildArchRuleChunk(F17_STUB)
    expect(chunk.category).toBe('rule')
  })

  it('domain is always "lepios"', () => {
    const chunk = buildArchRuleChunk(F17_STUB)
    expect(chunk.domain).toBe('lepios')
  })

  it('solution equals rule.summary verbatim', () => {
    const chunk = buildArchRuleChunk(F17_STUB)
    expect(chunk.solution).toBe(F17_STUB.summary)
  })

  it('title starts with F{number}:', () => {
    const chunk = buildArchRuleChunk(F17_STUB)
    expect(chunk.title).toMatch(/^F17:/)
  })

  it('title uses first sentence of summary (split on ". ")', () => {
    const rule: Rule = {
      ...F17_STUB,
      summary: 'First sentence here. Second sentence not in title.',
    }
    const chunk = buildArchRuleChunk(rule)
    expect(chunk.title).toContain('First sentence here')
    expect(chunk.title).not.toContain('Second sentence')
  })

  it('title is capped at ~100 chars when summary is very long', () => {
    const rule: Rule = { ...F17_STUB, summary: 'A'.repeat(200) + '. rest.' }
    const chunk = buildArchRuleChunk(rule)
    expect(chunk.title.length).toBeLessThanOrEqual(110) // F17: prefix + 100 chars + ...
  })

  it('problem field contains F{number} and human-readable rule name', () => {
    const chunk = buildArchRuleChunk(F17_STUB)
    expect(chunk.problem).toContain('F17')
    expect(chunk.problem).toContain('behavioral ingestion justification')
  })

  it('context field contains rule number, name, and defined_at', () => {
    const chunk = buildArchRuleChunk(F17_STUB)
    expect(chunk.context).toContain('F17')
    expect(chunk.context).toContain('behavioral-ingestion-justification')
    expect(chunk.context).toContain('CLAUDE.md:70')
  })

  it('context mentions registry source file', () => {
    const chunk = buildArchRuleChunk(F17_STUB)
    expect(chunk.context).toContain('lib/rules/registry.ts')
  })

  it('confidence is 0.9', () => {
    const chunk = buildArchRuleChunk(F17_STUB)
    expect(chunk.confidence).toBe(0.9)
  })
})

// ── buildArchRuleChunks — array behaviour ────────────────────────────────────

describe('buildArchRuleChunks — array behaviour', () => {
  it('4 rules → 4 chunks', () => {
    const chunks = buildArchRuleChunks(FOUR_RULES)
    expect(chunks).toHaveLength(4)
  })

  it('empty array → empty array', () => {
    expect(buildArchRuleChunks([])).toHaveLength(0)
  })

  it('adding a new rule to the list produces 1 extra chunk', () => {
    const base = buildArchRuleChunks(FOUR_RULES)
    const newRule: Rule = {
      number: 22,
      name: 'new-rule-example',
      scope: 'project',
      summary: 'A new rule added to the registry.',
      defined_at: 'CLAUDE.md:80',
      references: [],
    }
    const extended = buildArchRuleChunks([...FOUR_RULES, newRule])
    expect(extended).toHaveLength(base.length + 1)
    expect(extended[extended.length - 1].entity).toBe('cmdingest:lepios:arch-F22-new-rule-example')
  })

  it('each chunk entity is unique', () => {
    const chunks = buildArchRuleChunks(FOUR_RULES)
    const entities = chunks.map((c) => c.entity)
    expect(new Set(entities).size).toBe(entities.length)
  })

  it('scope filtering: project-only excludes global-scoped rules', () => {
    const withGlobal: readonly Rule[] = [
      ...FOUR_RULES,
      {
        number: 19,
        name: 'continuous-improvement-process',
        scope: 'global',
        summary: 'Global scope rule.',
        defined_at: '~/.claude/CLAUDE.md:73',
        references: [],
      },
    ]
    const projectOnly = buildArchRuleChunks(withGlobal.filter((r) => r.scope === 'project'))
    expect(projectOnly).toHaveLength(4) // excludes F19
    expect(projectOnly.every((c) => !c.entity.includes('continuous-improvement-process'))).toBe(true)
  })
})

// ── Live RULES regression — F-number parity ──────────────────────────────────

describe('buildArchRuleChunks — live RULES regression', () => {
  it('generates one chunk per project-scoped rule in the live registry', () => {
    const projectRules = RULES.filter((r) => r.scope === 'project')
    const chunks = buildArchRuleChunks(projectRules)
    expect(chunks).toHaveLength(projectRules.length)
  })

  it('all generated entity IDs match cmdingest:lepios:arch-F{number}-{name} pattern', () => {
    const projectRules = RULES.filter((r) => r.scope === 'project')
    const chunks = buildArchRuleChunks(projectRules)
    for (const chunk of chunks) {
      expect(chunk.entity).toMatch(/^cmdingest:lepios:arch-F\d+-[a-z0-9-]+$/)
    }
  })

  it('F21 generated entity ID is cmdingest:lepios:arch-F21-acceptance-tests-first', () => {
    const f21 = RULES.find((r) => r.number === 21)
    expect(f21).toBeDefined()
    const chunk = buildArchRuleChunk(f21!)
    expect(chunk.entity).toBe('cmdingest:lepios:arch-F21-acceptance-tests-first')
  })
})
