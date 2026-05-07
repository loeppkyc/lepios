import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// We import from the .mjs lib via Vitest's loader. The lib reads
// LEPIOS_ACTIVE_DIR_OVERRIDE at *call time*, not import time, so we can flip it
// per-test by mutating process.env before each invocation.
const lib = await import('../../scripts/lib/window-claim.mjs')

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'lepios-window-claim-'))
  process.env.LEPIOS_ACTIVE_DIR_OVERRIDE = tempDir
})

afterEach(() => {
  delete process.env.LEPIOS_ACTIVE_DIR_OVERRIDE
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

describe('getActiveDir', () => {
  it('honors LEPIOS_ACTIVE_DIR_OVERRIDE', () => {
    expect(lib.getActiveDir()).toBe(tempDir)
  })

  it('returns the main-checkout .claude/active-windows when override is unset', () => {
    delete process.env.LEPIOS_ACTIVE_DIR_OVERRIDE
    const dir = lib.getActiveDir()
    // git common-dir resolves to <main-checkout>/.git; parent is the main checkout.
    const commonDir = execSync('git rev-parse --git-common-dir').toString().trim()
    const expected = resolve(commonDir, '..', '.claude', 'active-windows')
    expect(resolve(dir)).toBe(expected)
  })
})

describe('claim I/O via override', () => {
  it('writes, lists, loads, and deletes a claim', () => {
    const claim = {
      branch: 'feat/example',
      scope: ['lib/example/**'],
      started_at: '2026-05-07T00:00:00.000Z',
      last_heartbeat: '2026-05-07T00:00:00.000Z',
      pid: 12345,
      note: null,
    }

    const writePath = lib.writeClaim(claim)
    expect(writePath).toBe(join(tempDir, 'feat__example.json'))
    expect(readdirSync(tempDir)).toContain('feat__example.json')

    const all = lib.loadAllClaims()
    expect(all).toHaveLength(1)
    expect(all[0].branch).toBe('feat/example')
    expect(all[0].scope).toEqual(['lib/example/**'])

    const single = lib.loadClaimForBranch('feat/example')
    expect(single?.branch).toBe('feat/example')

    const deleted = lib.deleteClaim('feat/example')
    expect(deleted).toBe(writePath)
    expect(lib.loadClaimForBranch('feat/example')).toBeNull()
    expect(lib.loadAllClaims()).toHaveLength(0)
  })

  it('loadClaimForBranch returns null for unknown branch', () => {
    expect(lib.loadClaimForBranch('feat/never-claimed')).toBeNull()
  })

  it('flattens slashes in branch names to filename', () => {
    expect(lib.branchToFilename('harness/task-99')).toBe('harness__task-99.json')
    expect(lib.branchToFilename('a/b/c')).toBe('a__b__c.json')
  })
})

describe('pruneStaleClaims', () => {
  it('deletes claims older than STALE_MS', () => {
    const stale = new Date(Date.now() - lib.STALE_MS - 1000).toISOString()
    const fresh = new Date().toISOString()

    lib.writeClaim({
      branch: 'feat/stale',
      scope: ['x/**'],
      started_at: stale,
      last_heartbeat: stale,
      pid: 1,
      note: null,
    })
    lib.writeClaim({
      branch: 'feat/fresh',
      scope: ['y/**'],
      started_at: fresh,
      last_heartbeat: fresh,
      pid: 2,
      note: null,
    })

    const pruned = lib.pruneStaleClaims()
    expect(pruned).toHaveLength(1)
    expect(pruned[0]).toContain('feat__stale')

    const remaining = lib.loadAllClaims()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].branch).toBe('feat/fresh')
  })
})

describe('isMainCheckout', () => {
  it('returns a boolean — invariants honored in current process', () => {
    // We can't reliably assert true/false without controlling the test env's worktree
    // layout, but the function should never throw and must return a boolean.
    delete process.env.LEPIOS_ACTIVE_DIR_OVERRIDE
    const result = lib.isMainCheckout()
    expect(typeof result).toBe('boolean')
  })

  it('distinguishes a worktree from its main checkout', () => {
    // Build a throwaway repo with one worktree and assert isMainCheckout in each.
    const repoRoot = mkdtempSync(join(tmpdir(), 'lepios-isMainCheckout-'))
    const worktreeRoot = `${repoRoot}-wt`
    // Node ESM loader on Windows requires file:// URLs for absolute paths.
    const libUrl = `file:///${process.cwd().replace(/\\/g, '/')}/scripts/lib/window-claim.mjs`
    const probeScript = `import('${libUrl}').then(m => process.stdout.write(String(m.isMainCheckout())))`
    try {
      execSync('git init -q', { cwd: repoRoot })
      execSync('git config user.email test@example.com', { cwd: repoRoot })
      execSync('git config user.name test', { cwd: repoRoot })
      execSync('git commit -q --allow-empty -m init', { cwd: repoRoot })
      execSync(`git worktree add -q -b wt-branch "${worktreeRoot}"`, { cwd: repoRoot })

      const inMain = execSync(`node -e "${probeScript}"`, { cwd: repoRoot }).toString().trim()
      const inWorktree = execSync(`node -e "${probeScript}"`, { cwd: worktreeRoot })
        .toString()
        .trim()

      expect(inMain).toBe('true')
      expect(inWorktree).toBe('false')
    } finally {
      try {
        execSync(`git worktree remove -f "${worktreeRoot}"`, { cwd: repoRoot })
      } catch {
        // best-effort
      }
      rmSync(repoRoot, { recursive: true, force: true })
      if (existsSync(worktreeRoot)) rmSync(worktreeRoot, { recursive: true, force: true })
    }
  })
})
