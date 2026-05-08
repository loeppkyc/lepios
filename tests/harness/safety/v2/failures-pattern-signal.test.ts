/**
 * Unit tests for lib/harness/safety/v2/signals/failures-pattern.ts.
 *
 * Tests use a mocked Supabase client to assert query construction + finding
 * shape without hitting the DB. The DB-shape assertions document the exact
 * .or() string the production query depends on — schema drift will break here.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  detectFailuresPattern,
  signatureFromDiff,
  findMatchingFailures,
} from '@/lib/harness/safety/v2/signals/failures-pattern'
import type { PRDiffInput } from '@/lib/harness/safety/v2/types'
import type { PatternSignature } from '@/lib/failures/signature'

type MockRow = {
  id: string
  failure_number: string | null
  title: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  status: 'open' | 'fixing' | 'fixed' | 'recurring'
  pattern_signature: PatternSignature
}

/**
 * Build a chainable mock that records the .or() call and returns a fixed result.
 * The chain matches: from(t).select(c).in(c, vals).or(parts).order(...).limit(n).
 */
function makeMockClient(rows: MockRow[]) {
  const calls: { table?: string; orParts?: string } = {}
  const chain = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    or: vi.fn(function (this: unknown, parts: string) {
      calls.orParts = parts
      return chain
    }),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  }
  return {
    client: {
      from: vi.fn(function (table: string) {
        calls.table = table
        return chain
      }),
    } as unknown as Parameters<typeof findMatchingFailures>[0],
    calls,
  }
}

function makeInput(overrides: Partial<PRDiffInput> = {}): PRDiffInput {
  return {
    unified_diff: '',
    files_changed: ['lib/foo.ts'],
    loc_added: 10,
    loc_removed: 0,
    migration_files: [],
    new_files: [],
    plan_loc: null,
    commit_message: 'fix timeout in foo handler',
    ...overrides,
  }
}

describe('signatureFromDiff', () => {
  it('classifies migration PRs as migration-error', () => {
    const sig = signatureFromDiff(
      makeInput({ migration_files: [{ path: 'supabase/migrations/0163_x.sql', sql: '' }] })
    )
    expect(sig.type).toBe('migration-error')
  })

  it('classifies app/api PRs as route-500', () => {
    const sig = signatureFromDiff(makeInput({ files_changed: ['app/api/foo/route.ts'] }))
    expect(sig.type).toBe('route-500')
  })

  it('falls back to manual for general lib changes', () => {
    const sig = signatureFromDiff(makeInput({ files_changed: ['lib/foo.ts'] }))
    expect(sig.type).toBe('manual')
  })

  it('extracts keywords from commit message', () => {
    const sig = signatureFromDiff(
      makeInput({ commit_message: 'fix timeout in dropbox handler crash' })
    )
    expect(sig.keywords).toContain('timeout')
    expect(sig.keywords).toContain('dropbox')
  })

  it('caps touched_files at 5', () => {
    const sig = signatureFromDiff(
      makeInput({
        files_changed: [
          'lib/a.ts',
          'lib/b.ts',
          'lib/c.ts',
          'lib/d.ts',
          'lib/e.ts',
          'lib/f.ts',
          'lib/g.ts',
        ],
      })
    )
    expect(sig.touched_files?.length).toBeLessThanOrEqual(5)
  })
})

describe('findMatchingFailures — query shape', () => {
  it('builds an OR query with one entry per touched_file + keyword', async () => {
    const { client, calls } = makeMockClient([])
    await findMatchingFailures(client as Parameters<typeof findMatchingFailures>[0], {
      type: 'manual',
      touched_files: ['lib/foo.ts', 'lib/bar.ts'],
      keywords: ['timeout', 'crash'],
    })
    expect(calls.table).toBe('failures_log')
    // 2 files + 2 keywords = 4 OR parts.
    expect(calls.orParts!.split(',').length).toBe(4)
    expect(calls.orParts).toContain('touched_files')
    expect(calls.orParts).toContain('keywords')
  })

  it('returns empty when signature has no fields to match', async () => {
    const { client } = makeMockClient([])
    const out = await findMatchingFailures(client as Parameters<typeof findMatchingFailures>[0], {
      type: 'manual',
    })
    expect(out).toEqual([])
  })

  it('includes file_glob when set', async () => {
    const { client, calls } = makeMockClient([])
    await findMatchingFailures(client as Parameters<typeof findMatchingFailures>[0], {
      type: 'manual',
      file_glob: 'lib/foo/**',
    })
    expect(calls.orParts).toContain('file_glob')
  })
})

describe('detectFailuresPattern — finding selection', () => {
  const baseRow: MockRow = {
    id: 'aaa',
    failure_number: 'F-N42',
    title: 'X',
    severity: 'medium',
    status: 'open',
    pattern_signature: { type: 'manual', keywords: ['timeout'] },
  }

  it('returns no finding when no matches', async () => {
    const { client } = makeMockClient([])
    const out = await detectFailuresPattern(makeInput(), client as never)
    expect(out).toHaveLength(0)
  })

  it('emits LOW finding for medium-severity match', async () => {
    const { client } = makeMockClient([{ ...baseRow, severity: 'medium' }])
    const out = await detectFailuresPattern(makeInput(), client as never)
    expect(out).toHaveLength(1)
    expect(out[0].weight_key).toBe('SAFETY_WEIGHT_FAILURE_PATTERN_LOW')
  })

  it('emits LOW finding for low-severity match', async () => {
    const { client } = makeMockClient([{ ...baseRow, severity: 'low' }])
    const out = await detectFailuresPattern(makeInput(), client as never)
    expect(out[0].weight_key).toBe('SAFETY_WEIGHT_FAILURE_PATTERN_LOW')
  })

  it('emits HIGH finding for high-severity match', async () => {
    const { client } = makeMockClient([{ ...baseRow, severity: 'high' }])
    const out = await detectFailuresPattern(makeInput(), client as never)
    expect(out[0].weight_key).toBe('SAFETY_WEIGHT_FAILURE_PATTERN_HIGH')
  })

  it('emits HIGH finding for critical-severity match', async () => {
    const { client } = makeMockClient([{ ...baseRow, severity: 'critical' }])
    const out = await detectFailuresPattern(makeInput(), client as never)
    expect(out[0].weight_key).toBe('SAFETY_WEIGHT_FAILURE_PATTERN_HIGH')
  })

  it('top match wins by severity (critical > high > medium > low)', async () => {
    const { client } = makeMockClient([
      { ...baseRow, id: 'low', severity: 'low' },
      { ...baseRow, id: 'crit', severity: 'critical' },
      { ...baseRow, id: 'med', severity: 'medium' },
    ])
    const out = await detectFailuresPattern(makeInput(), client as never)
    expect(out[0].weight_key).toBe('SAFETY_WEIGHT_FAILURE_PATTERN_HIGH')
  })

  it('evidence includes match count when multiple', async () => {
    const { client } = makeMockClient([
      { ...baseRow, id: 'a' },
      { ...baseRow, id: 'b' },
      { ...baseRow, id: 'c' },
    ])
    const out = await detectFailuresPattern(makeInput(), client as never)
    expect(out[0].evidence).toContain('3 matches')
  })

  it('evidence uses failure_number when present', async () => {
    const { client } = makeMockClient([{ ...baseRow, failure_number: 'F-N42' }])
    const out = await detectFailuresPattern(makeInput(), client as never)
    expect(out[0].evidence).toContain('F-N42')
  })
})
