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
})
