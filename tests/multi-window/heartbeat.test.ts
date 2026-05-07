/**
 * Tests for the heartbeat + always-prune behavior shipped in P5-3.
 *
 * - heartbeat() bumps last_heartbeat on the current branch's claim.
 * - pruneStaleClaims() removes claims older than STALE_MS.
 * - Pre-commit (window-scope-check.mjs) now runs prune BEFORE the
 *   empty-staged early-return — covered indirectly by pruneStaleClaims tests.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const lib = await import('../../scripts/lib/window-claim.mjs')

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'lepios-heartbeat-'))
  process.env.LEPIOS_ACTIVE_DIR_OVERRIDE = tempDir
})

afterEach(() => {
  delete process.env.LEPIOS_ACTIVE_DIR_OVERRIDE
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

describe('heartbeat()', () => {
  it('bumps last_heartbeat on existing claim', async () => {
    const start = new Date('2026-05-07T20:00:00.000Z').toISOString()
    lib.writeClaim({
      branch: 'feat/example',
      scope: ['x/**'],
      started_at: start,
      last_heartbeat: start,
      pid: 123,
      note: null,
    })

    await new Promise((r) => setTimeout(r, 10))

    const result = lib.heartbeat('feat/example')
    expect(result).toBe(true)

    const reloaded = lib.loadClaimForBranch('feat/example')
    expect(reloaded?.last_heartbeat).not.toBe(start)
    expect(new Date(reloaded?.last_heartbeat as string).getTime()).toBeGreaterThan(
      new Date(start).getTime()
    )
  })

  it('returns false when no claim exists for branch', () => {
    const result = lib.heartbeat('feat/never-claimed')
    expect(result).toBe(false)
  })

  it('preserves all other claim fields when bumping heartbeat', () => {
    const claim = {
      branch: 'feat/preserve',
      scope: ['preserve/**', 'tests/**'],
      started_at: '2026-05-07T20:00:00.000Z',
      last_heartbeat: '2026-05-07T20:00:00.000Z',
      pid: 12345,
      note: 'preservation test',
    }
    lib.writeClaim(claim)
    lib.heartbeat('feat/preserve')

    const reloaded = lib.loadClaimForBranch('feat/preserve')
    expect(reloaded?.branch).toBe('feat/preserve')
    expect(reloaded?.scope).toEqual(['preserve/**', 'tests/**'])
    expect(reloaded?.started_at).toBe('2026-05-07T20:00:00.000Z')
    expect(reloaded?.pid).toBe(12345)
    expect(reloaded?.note).toBe('preservation test')
  })

  it('does NOT leak the _path internal field back into the JSON', () => {
    lib.writeClaim({
      branch: 'feat/no-leak',
      scope: ['y/**'],
      started_at: '2026-05-07T20:00:00.000Z',
      last_heartbeat: '2026-05-07T20:00:00.000Z',
      pid: 1,
      note: null,
    })
    lib.heartbeat('feat/no-leak')

    const path = join(tempDir, 'feat__no-leak.json')
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    expect(raw._path).toBeUndefined()
  })
})

describe('always-prune behavior (regression for P5-3)', () => {
  it('pruneStaleClaims is idempotent on an already-clean store', () => {
    lib.writeClaim({
      branch: 'feat/fresh',
      scope: ['x/**'],
      started_at: new Date().toISOString(),
      last_heartbeat: new Date().toISOString(),
      pid: 1,
      note: null,
    })
    expect(lib.pruneStaleClaims()).toEqual([])
    expect(lib.pruneStaleClaims()).toEqual([])
  })

  it('catches a stale claim that would have been missed by old window-scope-check (empty staged)', () => {
    const stale = new Date(Date.now() - lib.STALE_MS - 5_000).toISOString()
    lib.writeClaim({
      branch: 'feat/dead-window',
      scope: ['x/**'],
      started_at: stale,
      last_heartbeat: stale,
      pid: 9999,
      note: 'dead window — process exited 31min ago',
    })
    const pruned = lib.pruneStaleClaims()
    expect(pruned).toHaveLength(1)
    expect(pruned[0]).toContain('feat__dead-window')
  })
})
