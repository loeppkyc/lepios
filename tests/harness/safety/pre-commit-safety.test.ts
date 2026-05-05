/**
 * Unit tests for scripts/pre-commit-safety.mjs.
 *
 * Background: docs/follow-ups/2026-05-05-safety-hook-truncate-false-positive.md
 *
 * The script's earlier version matched /\bTRUNCATE\b/ on the uppercased
 * full-diff additions, which fired on Tailwind's `truncate` class. These
 * tests pin down the new behaviour:
 *   1. SQL patterns only fire inside SQL-context paths (.sql, migrations, .py,
 *      lib/orb/tools/*, scripts/*).
 *   2. SQL patterns require syntactic context — `TRUNCATE TABLE? <name>`,
 *      `DELETE FROM <name>`, `DROP <kind> <name>`.
 *   3. harness_config write check fires on .ts/.js code only.
 *   4. force-push-to-main check fires on script/sh files only.
 */

import { describe, it, expect } from 'vitest'
import {
  isAllowlistedPath,
  isSqlContextPath,
  isCodePath,
  isScriptPath,
  parseStagedDiff,
  scanStagedFiles,
} from '../../../scripts/pre-commit-safety.mjs'

// ── Allowlist (self-referencing safety files) ────────────────────────────────

describe('isAllowlistedPath', () => {
  it('matches the safety system files themselves', () => {
    expect(isAllowlistedPath('scripts/pre-commit-safety.mjs')).toBe(true)
    expect(isAllowlistedPath('tests/harness/safety/pre-commit-safety.test.ts')).toBe(true)
    expect(isAllowlistedPath('lib/harness/safety/static.ts')).toBe(true)
    expect(isAllowlistedPath('tests/harness/safety/static.test.ts')).toBe(true)
  })
  it('does not match unrelated paths', () => {
    expect(isAllowlistedPath('scripts/deploy.sh')).toBe(false)
    expect(isAllowlistedPath('lib/foo.ts')).toBe(false)
  })
})

describe('scanStagedFiles — allowlist short-circuits self-referencing files', () => {
  it('does not block when the safety script itself contains its own patterns', () => {
    const out = scanStagedFiles([
      {
        path: 'scripts/pre-commit-safety.mjs',
        additions:
          "if (/\\bTRUNCATE\\s+\\w+/.test(upper)) findings.push({ rule: 'TRUNCATE statement' })",
      },
    ])
    expect(out.severity).toBe('pass')
  })
})

// ── Path classifiers ──────────────────────────────────────────────────────────

describe('isSqlContextPath', () => {
  it('matches .sql files', () => {
    expect(isSqlContextPath('supabase/migrations/0123_add_table.sql')).toBe(true)
    expect(isSqlContextPath('queries/report.sql')).toBe(true)
  })
  it('matches python files (bookkeeping ingester writes raw SQL)', () => {
    expect(isSqlContextPath('scripts/bookkeeping/ingest-bank-csv.py')).toBe(true)
  })
  it('matches lib/orb/tools/* (raw SQL strings inside tool defs)', () => {
    expect(isSqlContextPath('lib/orb/tools/query-db.ts')).toBe(true)
  })
  it('rejects TSX components', () => {
    expect(isSqlContextPath('app/(cockpit)/chat/_components/ChatClient.tsx')).toBe(false)
  })
  it('rejects markdown', () => {
    expect(isSqlContextPath('docs/follow-ups/x.md')).toBe(false)
  })
})

describe('isCodePath', () => {
  it('matches ts/tsx/js/mjs', () => {
    expect(isCodePath('lib/foo.ts')).toBe(true)
    expect(isCodePath('app/page.tsx')).toBe(true)
    expect(isCodePath('scripts/x.mjs')).toBe(true)
  })
  it('rejects sql/md/py', () => {
    expect(isCodePath('migrations/x.sql')).toBe(false)
    expect(isCodePath('docs/x.md')).toBe(false)
    expect(isCodePath('scripts/x.py')).toBe(false)
  })
})

describe('isScriptPath', () => {
  it('matches husky hooks and scripts dir', () => {
    expect(isScriptPath('.husky/pre-commit')).toBe(true)
    expect(isScriptPath('scripts/deploy.sh')).toBe(true)
    expect(isScriptPath('scripts/check.mjs')).toBe(true)
  })
  it('rejects app pages', () => {
    expect(isScriptPath('app/page.tsx')).toBe(false)
  })
})

// ── Diff parser ───────────────────────────────────────────────────────────────

describe('parseStagedDiff', () => {
  it('extracts per-file additions from a unified diff', () => {
    const diff = [
      'diff --git a/a.txt b/a.txt',
      'index 0000000..1111111 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -0,0 +1,2 @@',
      '+hello',
      '+world',
      'diff --git a/b.txt b/b.txt',
      'index 0000000..2222222 100644',
      '--- a/b.txt',
      '+++ b/b.txt',
      '@@ -0,0 +1,1 @@',
      '+only b',
    ].join('\n')

    const out = parseStagedDiff(diff)
    expect(out).toEqual([
      { path: 'a.txt', additions: 'hello\nworld' },
      { path: 'b.txt', additions: 'only b' },
    ])
  })

  it('handles empty diff', () => {
    expect(parseStagedDiff('')).toEqual([])
  })
})

// ── End-to-end scan: false-positive guards (the bcbef8c case) ────────────────

describe('scanStagedFiles — Tailwind `truncate` does NOT trigger TRUNCATE rule', () => {
  it('passes a TSX file with className="block truncate"', () => {
    const out = scanStagedFiles([
      {
        path: 'app/(cockpit)/chat/_components/ChatClient.tsx',
        additions: '<span className="block truncate">{conv.title}</span>',
      },
    ])
    expect(out.severity).toBe('pass')
    expect(out.findings).toEqual([])
  })

  it('passes a markdown doc that mentions the word truncate in prose', () => {
    const out = scanStagedFiles([
      {
        path: 'docs/follow-ups/safety-truncate.md',
        additions: 'Tailwind `truncate` would otherwise be matched by /\\bTRUNCATE\\b/.',
      },
    ])
    expect(out.severity).toBe('pass')
  })
})

// ── End-to-end scan: real destructive SQL still blocks ───────────────────────

describe('scanStagedFiles — real destructive SQL blocks', () => {
  it('blocks TRUNCATE TABLE in a migration', () => {
    const out = scanStagedFiles([
      {
        path: 'supabase/migrations/0125_purge.sql',
        additions: 'TRUNCATE TABLE conversations;',
      },
    ])
    expect(out.severity).toBe('block')
    expect(out.findings.some((f) => f.rule === 'TRUNCATE statement')).toBe(true)
  })

  it('blocks bare TRUNCATE accounts (no TABLE keyword)', () => {
    const out = scanStagedFiles([{ path: 'queries/wipe.sql', additions: 'TRUNCATE accounts;' }])
    expect(out.severity).toBe('block')
  })

  it('blocks DELETE FROM without WHERE', () => {
    const out = scanStagedFiles([
      { path: 'migrations/0126_clean.sql', additions: 'DELETE FROM agent_events;' },
    ])
    expect(out.severity).toBe('block')
    expect(out.findings.some((f) => f.rule === 'DELETE without WHERE')).toBe(true)
  })

  it('allows DELETE FROM with WHERE', () => {
    const out = scanStagedFiles([
      {
        path: 'migrations/0127_clean_old.sql',
        additions: "DELETE FROM agent_events WHERE created_at < '2026-01-01';",
      },
    ])
    expect(out.severity).toBe('pass')
  })

  it('blocks DROP TABLE', () => {
    const out = scanStagedFiles([
      { path: 'migrations/0128.sql', additions: 'DROP TABLE messages;' },
    ])
    expect(out.severity).toBe('block')
    expect(out.findings.some((f) => f.rule === 'DROP statement')).toBe(true)
  })

  it('passes a python file that builds parameterized SQL with TRUNCATE in a comment', () => {
    // Comment-only TRUNCATE should still match the syntactic context — this
    // confirms the regex is keyword-based, not comment-aware. We allow it
    // through if the keyword is followed by a name (matches actual usage).
    const out = scanStagedFiles([
      {
        path: 'scripts/bookkeeping/x.py',
        additions: '# TRUNCATE accounts',
      },
    ])
    expect(out.severity).toBe('block')
  })
})

// ── End-to-end scan: harness_config write detection (code-only) ──────────────

describe('scanStagedFiles — harness_config write', () => {
  it('blocks db.from("harness_config").update(...) in a TS file', () => {
    const out = scanStagedFiles([
      {
        path: 'lib/foo.ts',
        additions: 'await db.from("harness_config").update({ value: "x" }).eq("key", "y")',
      },
    ])
    expect(out.severity).toBe('block')
    expect(out.findings.some((f) => f.rule === 'harness_config write in code')).toBe(true)
  })

  it('does NOT fire on a markdown doc explaining the rule', () => {
    const out = scanStagedFiles([
      {
        path: 'docs/x.md',
        additions:
          "Don't write `db.from('harness_config').update(...)` — use the SQL migration path.",
      },
    ])
    expect(out.severity).toBe('pass')
  })

  it('does NOT fire on a SELECT-only read', () => {
    const out = scanStagedFiles([
      {
        path: 'lib/bar.ts',
        additions: 'const { data } = await db.from("harness_config").select("*")',
      },
    ])
    expect(out.severity).toBe('pass')
  })
})

// ── End-to-end scan: force-push detection (script-only) ──────────────────────

describe('scanStagedFiles — git force-push to main', () => {
  it('blocks git push --force ... main in a shell script', () => {
    const out = scanStagedFiles([
      { path: 'scripts/wipe.sh', additions: 'git push --force origin main' },
    ])
    expect(out.severity).toBe('block')
    expect(out.findings.some((f) => f.rule === 'git force-push to main')).toBe(true)
  })

  it('does NOT fire in markdown explaining what NOT to do', () => {
    const out = scanStagedFiles([
      {
        path: 'docs/incident.md',
        additions: 'Never run `git push --force origin main` to recover from a bad merge.',
      },
    ])
    expect(out.severity).toBe('pass')
  })

  it('passes a vanilla `git push` (no --force)', () => {
    const out = scanStagedFiles([{ path: 'scripts/deploy.sh', additions: 'git push origin main' }])
    expect(out.severity).toBe('pass')
  })
})
