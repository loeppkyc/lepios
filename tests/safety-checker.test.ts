import { describe, it, expect } from 'vitest'
import { runSafetyChecks } from '@/lib/safety/checker'
import type { SafetyCheckInput } from '@/lib/safety/types'

// Shared empty test registry — forces missing_test to fire on new lib/api files
const NO_TESTS = new Set<string>()
// Full test registry — suppresses missing_test flags
const ALL_TESTS = new Set(['knowledge-client', 'handoffs-client', 'safety-checker', 'foo-api'])

// ── Helpers ───────────────────────────────────────────────────────────────────

function cleanInput(overrides: Partial<SafetyCheckInput> = {}): SafetyCheckInput {
  return {
    scopeDescription: 'test input',
    fileChanges: [],
    migrations: [],
    newApiRoutes: [],
    declaredScope: [],
    ...overrides,
  }
}

// ── Destructive SQL ───────────────────────────────────────────────────────────

describe('Rule 1 — destructive SQL', () => {
  it('flags DROP TABLE as critical', () => {
    const report = runSafetyChecks(cleanInput({
      migrations: [{ name: '0099_test', sql: 'DROP TABLE public.users;', hasRollback: false }],
    }))
    expect(report.blocking).toBe(true)
    expect(report.passed).toBe(false)
    const check = report.checks.find((c) => c.id === 'destructive_sql_drop_table')
    expect(check).toBeDefined()
    expect(check?.severity).toBe('critical')
  })

  it('flags TRUNCATE as critical', () => {
    const report = runSafetyChecks(cleanInput({
      migrations: [{ name: '0099_test', sql: 'TRUNCATE public.bets;', hasRollback: false }],
    }))
    expect(report.checks.some((c) => c.id === 'destructive_sql_truncate')).toBe(true)
  })

  it('flags DROP COLUMN as critical', () => {
    const report = runSafetyChecks(cleanInput({
      migrations: [{ name: '0099_test', sql: 'ALTER TABLE bets DROP COLUMN old_col;', hasRollback: false }],
    }))
    expect(report.checks.some((c) => c.id === 'destructive_sql_drop_column')).toBe(true)
  })

  it('does NOT flag CREATE TABLE', () => {
    const report = runSafetyChecks(cleanInput({
      migrations: [{ name: '0099_test', sql: 'CREATE TABLE public.new_table (id UUID PRIMARY KEY);', hasRollback: true }],
    }))
    expect(report.checks.filter((c) => c.category === 'destructive_operation')).toHaveLength(0)
  })

  it('does NOT flag ALTER TABLE ADD COLUMN', () => {
    const report = runSafetyChecks(cleanInput({
      migrations: [{ name: '0099_test', sql: 'ALTER TABLE bets ADD COLUMN notes TEXT;', hasRollback: true }],
    }))
    expect(report.checks.filter((c) => c.category === 'destructive_operation')).toHaveLength(0)
  })
})

// ── Secret Leak ───────────────────────────────────────────────────────────────

describe('Rule 2 — secret leak', () => {
  it('flags hardcoded AWS access key', () => {
    const report = runSafetyChecks(cleanInput({
      fileChanges: [{
        path: 'lib/aws.ts',
        diff: 'const key = "AKIAIOSFODNN7EXAMPLE"\nconst secret = "wJalrXUtnFEMI"',
        isNew: true,
      }],
    }), ALL_TESTS)
    expect(report.checks.some((c) => c.id === 'secret_leak_aws_access_key')).toBe(true)
    expect(report.checks.find((c) => c.id === 'secret_leak_aws_access_key')?.severity).toBe('critical')
  })

  it('does NOT flag process.env references', () => {
    const report = runSafetyChecks(cleanInput({
      fileChanges: [{
        path: 'lib/aws.ts',
        diff: 'const key = process.env.AMAZON_AWS_ACCESS_KEY\nconst secret = process.env.AMAZON_AWS_SECRET_KEY',
        isNew: true,
      }],
    }), ALL_TESTS)
    expect(report.checks.filter((c) => c.category === 'secret_leak')).toHaveLength(0)
  })

  it('does NOT flag .env files (they are expected to hold secrets)', () => {
    const report = runSafetyChecks(cleanInput({
      fileChanges: [{
        path: '.env.local',
        diff: 'STRIPE_SECRET_KEY=sk_live_abcdefghijklmnopqrst',
        isNew: false,
      }],
    }), ALL_TESTS)
    expect(report.checks.filter((c) => c.category === 'secret_leak')).toHaveLength(0)
  })

  it('does NOT flag comment lines', () => {
    const report = runSafetyChecks(cleanInput({
      fileChanges: [{
        path: 'lib/foo.ts',
        diff: '// AKIA comment for documentation purposes only',
        isNew: true,
      }],
    }), ALL_TESTS)
    expect(report.checks.filter((c) => c.category === 'secret_leak')).toHaveLength(0)
  })
})

// ── Missing Test ──────────────────────────────────────────────────────────────

describe('Rule 3 — missing test coverage', () => {
  it('flags new lib file without corresponding test', () => {
    const report = runSafetyChecks(cleanInput({
      fileChanges: [{ path: 'lib/knowledge/client.ts', diff: 'export function foo() {}', isNew: true }],
    }), NO_TESTS)
    expect(report.checks.some((c) => c.category === 'missing_test')).toBe(true)
    expect(report.checks.find((c) => c.category === 'missing_test')?.severity).toBe('medium')
  })

  it('flags new api route file without test', () => {
    const report = runSafetyChecks(cleanInput({
      fileChanges: [{ path: 'app/api/foo/route.ts', diff: 'export async function GET() {}', isNew: true }],
    }), NO_TESTS)
    expect(report.checks.some((c) => c.category === 'missing_test')).toBe(true)
  })

  it('does NOT flag modified (not new) files', () => {
    const report = runSafetyChecks(cleanInput({
      fileChanges: [{ path: 'lib/knowledge/client.ts', diff: '// minor edit', isNew: false }],
    }), NO_TESTS)
    expect(report.checks.filter((c) => c.category === 'missing_test')).toHaveLength(0)
  })

  it('does NOT flag lib files when test exists', () => {
    const report = runSafetyChecks(cleanInput({
      fileChanges: [{ path: 'lib/knowledge/client.ts', diff: 'export function foo() {}', isNew: true }],
    }), ALL_TESTS)
    expect(report.checks.filter((c) => c.category === 'missing_test')).toHaveLength(0)
  })

  it('does NOT flag non-lib non-api files', () => {
    const report = runSafetyChecks(cleanInput({
      fileChanges: [{ path: 'components/foo.tsx', diff: 'export function Foo() {}', isNew: true }],
    }), NO_TESTS)
    expect(report.checks.filter((c) => c.category === 'missing_test')).toHaveLength(0)
  })
})

// ── Scope Creep ───────────────────────────────────────────────────────────────

describe('Rule 4 — scope creep', () => {
  it('flags file outside declared scope', () => {
    const report = runSafetyChecks(cleanInput({
      fileChanges: [
        { path: 'lib/knowledge/client.ts', diff: '', isNew: false },
        { path: 'components/unrelated.tsx', diff: '', isNew: true },
      ],
      declaredScope: ['lib/knowledge/', 'app/api/knowledge/'],
    }), ALL_TESTS)
    const scopeChecks = report.checks.filter((c) => c.category === 'scope_creep')
    expect(scopeChecks.length).toBe(1)
    expect(scopeChecks[0].file).toBe('components/unrelated.tsx')
    expect(scopeChecks[0].severity).toBe('high')
  })

  it('does NOT flag files within declared scope', () => {
    const report = runSafetyChecks(cleanInput({
      fileChanges: [{ path: 'lib/knowledge/client.ts', diff: '', isNew: false }],
      declaredScope: ['lib/knowledge/'],
    }), ALL_TESTS)
    expect(report.checks.filter((c) => c.category === 'scope_creep')).toHaveLength(0)
  })

  it('skips scope check when no declaredScope provided', () => {
    const report = runSafetyChecks(cleanInput({
      fileChanges: [{ path: 'anything/foo.ts', diff: '', isNew: true }],
      declaredScope: [],
    }), ALL_TESTS)
    expect(report.checks.filter((c) => c.category === 'scope_creep')).toHaveLength(0)
  })
})

// ── Missing Rollback ──────────────────────────────────────────────────────────

describe('Rule 5 — missing rollback', () => {
  it('flags migration with no rollback comment', () => {
    const report = runSafetyChecks(cleanInput({
      migrations: [{ name: '0099_test', sql: 'CREATE TABLE foo (id UUID PRIMARY KEY);', hasRollback: false }],
    }))
    expect(report.checks.some((c) => c.category === 'missing_rollback')).toBe(true)
    expect(report.checks.find((c) => c.category === 'missing_rollback')?.severity).toBe('high')
  })

  it('does NOT flag when hasRollback=true', () => {
    const report = runSafetyChecks(cleanInput({
      migrations: [{ name: '0099_test', sql: 'CREATE TABLE foo (id UUID PRIMARY KEY);', hasRollback: true }],
    }))
    expect(report.checks.filter((c) => c.category === 'missing_rollback')).toHaveLength(0)
  })

  it('does NOT flag when SQL contains rollback comment', () => {
    const sql = 'CREATE TABLE foo (id UUID PRIMARY KEY);\n-- Rollback: DROP TABLE public.foo;'
    const report = runSafetyChecks(cleanInput({
      migrations: [{ name: '0099_test', sql, hasRollback: false }],
    }))
    expect(report.checks.filter((c) => c.category === 'missing_rollback')).toHaveLength(0)
  })
})

// ── Zod Coverage ─────────────────────────────────────────────────────────────

describe('Rule 6 — Zod schema validation', () => {
  it('flags new API route without Zod', () => {
    const report = runSafetyChecks(cleanInput({
      fileChanges: [{ path: 'app/api/foo/route.ts', diff: 'export async function POST(req) { const body = await req.json() }', isNew: true }],
      newApiRoutes: ['app/api/foo/route.ts'],
    }), ALL_TESTS)
    expect(report.checks.some((c) => c.category === 'schema_validation')).toBe(true)
    expect(report.checks.find((c) => c.category === 'schema_validation')?.severity).toBe('high')
  })

  it('does NOT flag route that imports from zod', () => {
    const report = runSafetyChecks(cleanInput({
      fileChanges: [{ path: 'app/api/foo/route.ts', diff: "import { z } from 'zod'\nexport async function POST() {}", isNew: true }],
      newApiRoutes: ['app/api/foo/route.ts'],
    }), ALL_TESTS)
    expect(report.checks.filter((c) => c.category === 'schema_validation')).toHaveLength(0)
  })

  it('does NOT flag nightly cron route (body-exempt)', () => {
    const report = runSafetyChecks(cleanInput({
      fileChanges: [{ path: 'app/api/knowledge/nightly/route.ts', diff: 'export async function POST() {}', isNew: true }],
      newApiRoutes: ['app/api/knowledge/nightly/route.ts'],
    }), ALL_TESTS)
    expect(report.checks.filter((c) => c.category === 'schema_validation')).toHaveLength(0)
  })
})

// ── Clean input passes all checks ─────────────────────────────────────────────

describe('clean pass', () => {
  it('returns passed=true and blocking=false for a clean input', () => {
    const report = runSafetyChecks(cleanInput({
      migrations: [{ name: '0099_test', sql: 'CREATE TABLE foo (id UUID PRIMARY KEY);\n-- Rollback: DROP TABLE public.foo;', hasRollback: false }],
      fileChanges: [{ path: 'lib/foo.ts', diff: "import { z } from 'zod'\nexport function foo() {}", isNew: true }],
    }), ALL_TESTS)
    expect(report.blocking).toBe(false)
    // medium checks (missing_test) may still fire unless suppressed by ALL_TESTS
    expect(report.passed).toBe(true)
    expect(report.blocking).toBe(false)
  })
})
