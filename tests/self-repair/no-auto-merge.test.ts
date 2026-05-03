/**
 * tests/self-repair/no-auto-merge.test.ts
 *
 * Spec acceptance: §J (hard "no auto-merge" assertion)
 *
 * Reads all source files in lib/harness/self-repair/ and asserts that none
 * contain auto-merge GitHub API call patterns.
 *
 * This test enforces AD2: NEVER auto-merge in slice 1.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const SELF_REPAIR_DIR = join(process.cwd(), 'lib/harness/self-repair')

// Patterns that would indicate an auto-merge GitHub API call.
// These are specific API patterns — words like "merge" in comments explaining
// why auto-merge is forbidden are NOT caught by these patterns.
const FORBIDDEN_PATTERNS: { pattern: RegExp; description: string }[] = [
  {
    pattern: /\/repos\/[^'"]+\/pulls\/[^'"]*\/merge/,
    description: 'GitHub PR merge endpoint: /repos/.../pulls/.../merge',
  },
  {
    pattern: /PUT[^]*\/merge/,
    description: 'PUT request to /merge endpoint',
  },
  {
    pattern: /\.automerge\s*=/,
    description: 'auto_merge property assignment',
  },
  {
    pattern: /merge_method\s*:/,
    description: 'merge_method payload field (squash/merge/rebase)',
  },
  {
    pattern: /enablePullRequestAutoMerge/,
    description: 'GitHub GraphQL enablePullRequestAutoMerge mutation',
  },
]

describe('AC-J: no auto-merge API calls in self_repair modules', () => {
  it('lib/harness/self-repair/ contains no auto-merge GitHub API patterns', () => {
    const files = readdirSync(SELF_REPAIR_DIR).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts')
    )

    expect(files.length).toBeGreaterThan(0)

    const violations: string[] = []

    for (const file of files) {
      if (file === 'no-auto-merge.test.ts') continue // skip if test file ends up here

      const content = readFileSync(join(SELF_REPAIR_DIR, file), 'utf8')

      for (const { pattern, description } of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(`${file}: found forbidden pattern "${description}"`)
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `AD2 violation: auto-merge patterns found in self_repair modules:\n${violations.join('\n')}\n\nAD2: self_repair NEVER auto-merges. PRs must be reviewed and merged by a human.`
      )
    }
  })

  it('pr-opener.ts contains the AD2 documentation comment', () => {
    const content = readFileSync(join(SELF_REPAIR_DIR, 'pr-opener.ts'), 'utf8')
    expect(content).toContain('auto-merge')
    // The comment explaining AD2 should exist — confirms the constraint is documented
    expect(content.toLowerCase()).toContain('never auto-merge')
  })

  it('no file uses squash-merge or rebase-merge GitHub API endpoints', () => {
    const files = readdirSync(SELF_REPAIR_DIR).filter((f) => f.endsWith('.ts'))

    for (const file of files) {
      const content = readFileSync(join(SELF_REPAIR_DIR, file), 'utf8')

      // These would be the actual GitHub REST API paths for merge methods
      expect(content).not.toMatch(/\/pulls\/\d+\/merge/)
    }
  })
})
