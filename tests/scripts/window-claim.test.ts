/**
 * F-N10 fix tests for scripts/lib/window-claim.mjs.
 *
 * The hasOtherWorktrees() helper must:
 *   - Return false when there's only the main checkout
 *   - Return true when one or more linked worktrees exist
 *
 * Tests run git directly via execSync against a temp repo so they exercise
 * the real `git worktree list --porcelain` parsing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

import { hasOtherWorktrees } from '../../scripts/lib/window-claim.mjs'

let tmpRoot: string
let mainCheckout: string
let originalCwd: string

function git(cwd: string, cmd: string): string {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8' })
}

beforeAll(() => {
  originalCwd = process.cwd()
  tmpRoot = mkdtempSync(join(tmpdir(), 'lepios-wc-'))
  mainCheckout = join(tmpRoot, 'main')
  mkdirSync(mainCheckout, { recursive: true })
  git(mainCheckout, 'init -q -b main')
  git(mainCheckout, 'config user.email t@t')
  git(mainCheckout, 'config user.name t')
  writeFileSync(join(mainCheckout, 'README.md'), '# t')
  git(mainCheckout, 'add .')
  git(mainCheckout, 'commit -q -m init')
})

afterAll(() => {
  process.chdir(originalCwd)
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('hasOtherWorktrees', () => {
  it('returns false when only main checkout exists', () => {
    process.chdir(mainCheckout)
    expect(hasOtherWorktrees()).toBe(false)
  })

  it('returns true when one linked worktree exists', () => {
    process.chdir(mainCheckout)
    git(mainCheckout, 'branch feat/x')
    git(mainCheckout, `worktree add "${join(tmpRoot, 'wt-x')}" feat/x`)
    expect(hasOtherWorktrees()).toBe(true)
    // Cleanup so this test doesn't poison the next.
    git(mainCheckout, `worktree remove "${join(tmpRoot, 'wt-x')}" --force`)
  })

  it('returns true even when called from inside the linked worktree', () => {
    git(mainCheckout, 'branch feat/y')
    git(mainCheckout, `worktree add "${join(tmpRoot, 'wt-y')}" feat/y`)
    process.chdir(join(tmpRoot, 'wt-y'))
    expect(hasOtherWorktrees()).toBe(true)
    process.chdir(mainCheckout)
    git(mainCheckout, `worktree remove "${join(tmpRoot, 'wt-y')}" --force`)
  })

  it('returns false when only agent worktrees (locked "claude agent ...") exist', () => {
    // Simulate a Claude Code Agent tool worktree: path under .claude/worktrees/,
    // lock file starting with "claude agent".
    process.chdir(mainCheckout)
    const agentWtPath = join(mainCheckout, '.claude', 'worktrees', 'agent-abc123')
    git(mainCheckout, 'branch worktree-agent-abc123')
    git(mainCheckout, `worktree add "${agentWtPath}" worktree-agent-abc123`)
    // Write the lock file (git worktree add doesn't auto-lock; simulate Agent tool behavior)
    const lockFile = join(mainCheckout, '.git', 'worktrees', 'agent-abc123', 'locked')
    writeFileSync(lockFile, 'claude agent agent-abc123 (pid 99999)')
    try {
      expect(hasOtherWorktrees()).toBe(false)
    } finally {
      // Locked worktrees require double-force (-f -f) to remove.
      git(mainCheckout, `worktree remove "${agentWtPath}" -f -f`)
    }
  })

  it('returns true when a real (non-agent) worktree and an agent worktree both exist', () => {
    process.chdir(mainCheckout)
    const agentWtPath = join(mainCheckout, '.claude', 'worktrees', 'agent-def456')
    git(mainCheckout, 'branch worktree-agent-def456')
    git(mainCheckout, `worktree add "${agentWtPath}" worktree-agent-def456`)
    writeFileSync(
      join(mainCheckout, '.git', 'worktrees', 'agent-def456', 'locked'),
      'claude agent agent-def456 (pid 99999)'
    )
    git(mainCheckout, 'branch feat/real')
    git(mainCheckout, `worktree add "${join(tmpRoot, 'wt-real')}" feat/real`)
    try {
      expect(hasOtherWorktrees()).toBe(true)
    } finally {
      git(mainCheckout, `worktree remove "${join(tmpRoot, 'wt-real')}" --force`)
      git(mainCheckout, `worktree remove "${agentWtPath}" -f -f`)
    }
  })
})
