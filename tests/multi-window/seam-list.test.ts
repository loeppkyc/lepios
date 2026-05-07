import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Load the live SEAM regex from .husky/commit-msg so tests fail if the regex is
// edited without updating the contract — F-N8 prevention companion.
function loadSeamRegex(): RegExp {
  const path = join(process.cwd(), '.husky', 'commit-msg')
  const src = readFileSync(path, 'utf8')
  const match = src.match(/^SEAM='([^']+)'/m)
  if (!match) throw new Error('Could not find SEAM= line in .husky/commit-msg')
  // The shell uses `grep -E` so the regex is ERE. JS RegExp is close enough for
  // the patterns used here (no shell-only escapes in play).
  return new RegExp(match[1])
}

const SEAM = loadSeamRegex()

describe('seam-list — files that MUST require [seam-approved]', () => {
  const seamed = [
    // App-boundary files
    'package.json',
    'package-lock.json',
    'app/layout.tsx',
    'middleware.ts',
    'next.config.ts',
    'next.config.mjs',
    'tailwind.config.js',
    'tailwind.config.ts',
    'tsconfig.json',
    '.env.example',
    'eslint.config.mjs',
    'eslint.config.js',
    '.gitignore',
    'supabase/seed.sql',
    // Multi-window protocol files (added by P0-3)
    '.claude/CLAUDE.md',
    'scripts/window-start.mjs',
    'scripts/window-end.mjs',
    'scripts/window-status.mjs',
    'scripts/window-scope-check.mjs',
    'scripts/lib/window-claim.mjs',
    '.husky/pre-commit',
    '.husky/commit-msg',
    '.husky/prepare-commit-msg',
    '.husky/post-merge',
  ]

  for (const f of seamed) {
    it(`${f} matches the seam regex`, () => {
      expect(SEAM.test(f)).toBe(true)
    })
  }
})

describe('seam-list — files that MUST NOT match (false-positive guard)', () => {
  const notSeamed = [
    // Regular app code
    'app/(cockpit)/diet/page.tsx',
    'lib/diet/helpers.ts',
    'tests/diet/helpers.test.ts',
    // Non-seam scripts
    'scripts/backfill-amazon-orders.ts',
    'scripts/ai-review.mjs',
    'scripts/ingest-claude-md.ts',
    // Other lib files
    'scripts/lib/window-other.mjs',
    // Non-seam claude files
    '.claude/active-windows/feat__diet-port.json',
    '.claude/migration-claims.json',
    '.claude/agents/builder.md',
    // Non-seam husky internals (the junctioned subdir)
    '.husky/_/husky.sh',
    // Other configs that look similar
    'app/api/admin/route.ts',
    'lib/auth/cron-secret.ts',
    'README.md',
  ]

  for (const f of notSeamed) {
    it(`${f} does NOT match the seam regex`, () => {
      expect(SEAM.test(f)).toBe(false)
    })
  }
})
