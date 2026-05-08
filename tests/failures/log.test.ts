/**
 * Tests for lib/failures/log.ts (logFailure, recurrence detection).
 *
 * Mocked DB. Validates: insert path, recurrence path (matching fixed row),
 * F-N number allocation, error path.
 *
 * The integration test against a real Supabase project lives in
 * tests/api/failures-log-integration.test.ts (Phase 1a final gate).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { logFailure, markFixed, findMatchingFailures } from '@/lib/failures/log'
import { buildSignature } from '@/lib/failures/signature'

beforeEach(() => {
  mockFrom.mockReset()
})

// ── builder helpers ─────────────────────────────────────────────────────────

function makeFixedMatchSelect(
  rows: Array<{
    id: string
    occurrence_count: number
    failure_number: string | null
    pattern_signature: unknown
  }>
) {
  return {
    select: () => ({
      eq: () => ({
        contains: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: rows, error: null }),
          }),
        }),
      }),
    }),
  }
}

function makeNextFailureNumberSelect(rows: Array<{ failure_number: string | null }>) {
  return {
    select: () => ({
      like: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: rows, error: null }),
        }),
      }),
    }),
  }
}

function makeInsertReturning(row: { id: string; failure_number: string; status: string }) {
  return {
    insert: () => ({
      select: () => ({
        single: () => Promise.resolve({ data: row, error: null }),
      }),
    }),
  }
}

function makeInsertError(message: string) {
  return {
    insert: () => ({
      select: () => ({
        single: () => Promise.resolve({ data: null, error: { message } }),
      }),
    }),
  }
}

function makeUpdateOk() {
  return {
    update: () => ({
      eq: () => Promise.resolve({ data: null, error: null }),
    }),
  }
}

function makeFindContains(rows: Array<unknown>) {
  return {
    select: () => ({
      contains: () => ({
        order: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: rows, error: null }),
          }),
        }),
      }),
    }),
  }
}

// ── tests ───────────────────────────────────────────────────────────────────

describe('logFailure — fresh insert', () => {
  it('inserts a new row and returns the failure number', async () => {
    mockFrom
      // findFixedMatch — no matches
      .mockReturnValueOnce(makeFixedMatchSelect([]))
      // nextFailureNumber — no existing F-N rows
      .mockReturnValueOnce(makeNextFailureNumberSelect([]))
      // insert
      .mockReturnValueOnce(
        makeInsertReturning({ id: 'uuid-1', failure_number: 'F-N1', status: 'open' })
      )

    const result = await logFailure({
      title: 'Test failure',
      trigger_context: 'manual',
      what_happened: 'Something broke during test',
      pattern_signature: buildSignature({ type: 'test-fail', files: ['tests/foo.test.ts'] }),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.is_recurrence).toBe(false)
      expect(result.failure_number).toBe('F-N1')
      expect(result.status).toBe('open')
    }
  })

  it('allocates next F-N number after existing entries', async () => {
    mockFrom
      .mockReturnValueOnce(makeFixedMatchSelect([]))
      .mockReturnValueOnce(
        makeNextFailureNumberSelect([
          { failure_number: 'F-N15' },
          { failure_number: 'F-N7' },
          { failure_number: null },
        ])
      )
      .mockReturnValueOnce(
        makeInsertReturning({ id: 'uuid-2', failure_number: 'F-N16', status: 'open' })
      )

    const result = await logFailure({
      title: 'Another failure',
      trigger_context: 'self_repair',
      what_happened: 'Detector caught a regression',
      pattern_signature: buildSignature({ type: 'silent-skip' }),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.failure_number).toBe('F-N16')
    }
  })

  it('returns error when insert fails', async () => {
    mockFrom
      .mockReturnValueOnce(makeFixedMatchSelect([]))
      .mockReturnValueOnce(makeNextFailureNumberSelect([]))
      .mockReturnValueOnce(makeInsertError('check constraint violation'))

    const result = await logFailure({
      title: 'X',
      trigger_context: 'manual',
      what_happened: 'Y',
      pattern_signature: buildSignature({ type: 'manual' }),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('check constraint violation')
    }
  })
})

describe('logFailure — recurrence detection', () => {
  it('updates existing fixed row when signature matches', async () => {
    const sig = buildSignature({
      type: 'route-500',
      files: ['app/api/foo/route.ts'],
      error_message: 'TypeError: undefined.x',
    })

    mockFrom
      // findFixedMatch returns a matching row
      .mockReturnValueOnce(
        makeFixedMatchSelect([
          {
            id: 'fixed-uuid',
            occurrence_count: 1,
            failure_number: 'F-N5',
            pattern_signature: sig,
          },
        ])
      )
      // recurrence update
      .mockReturnValueOnce(makeUpdateOk())

    const result = await logFailure({
      title: 'Same failure again',
      trigger_context: 'pr',
      what_happened: 'It came back',
      pattern_signature: sig,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.is_recurrence).toBe(true)
      expect(result.id).toBe('fixed-uuid')
      expect(result.failure_number).toBe('F-N5')
      expect(result.status).toBe('recurring')
    }
  })

  it('does NOT match when signatures differ even slightly (different keyword sets)', async () => {
    const sigA = buildSignature({
      type: 'route-500',
      error_message: 'TypeError: distinctword',
    })
    const sigB = buildSignature({
      type: 'route-500',
      error_message: 'TypeError: differentword',
    })

    mockFrom
      // findFixedMatch returns a row with sigB; but our incoming is sigA
      .mockReturnValueOnce(
        makeFixedMatchSelect([
          {
            id: 'fixed-uuid',
            occurrence_count: 1,
            failure_number: 'F-N1',
            pattern_signature: sigB,
          },
        ])
      )
      // since sig doesn't equal, falls through to fresh insert
      .mockReturnValueOnce(makeNextFailureNumberSelect([{ failure_number: 'F-N1' }]))
      .mockReturnValueOnce(
        makeInsertReturning({ id: 'new-uuid', failure_number: 'F-N2', status: 'open' })
      )

    const result = await logFailure({
      title: 'Different failure',
      trigger_context: 'pr',
      what_happened: 'Other thing',
      pattern_signature: sigA,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.is_recurrence).toBe(false)
      expect(result.failure_number).toBe('F-N2')
    }
  })
})

describe('markFixed', () => {
  it('updates status to fixed with commit sha', async () => {
    mockFrom.mockReturnValueOnce(makeUpdateOk())

    const result = await markFixed({
      id: 'uuid-1',
      fix_commit_sha: 'abc1234',
      lesson: 'Always validate input',
    })

    expect(result.ok).toBe(true)
  })

  it('returns error when DB update fails', async () => {
    mockFrom.mockReturnValueOnce({
      update: () => ({
        eq: () => Promise.resolve({ data: null, error: { message: 'row not found' } }),
      }),
    })

    const result = await markFixed({ id: 'missing', fix_commit_sha: 'def5678' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('row not found')
  })
})

describe('findMatchingFailures', () => {
  it('returns rows whose signature is contained-by the input', async () => {
    mockFrom.mockReturnValueOnce(
      makeFindContains([
        { id: 'a', failure_number: 'F-N1', status: 'open', severity: 'high' },
        { id: 'b', failure_number: 'F-N2', status: 'recurring', severity: 'critical' },
      ])
    )

    const result = await findMatchingFailures({ type: 'route-500' })
    expect(result).toHaveLength(2)
    expect(result[0].failure_number).toBe('F-N1')
  })

  it('returns empty array when no matches', async () => {
    mockFrom.mockReturnValueOnce(makeFindContains([]))
    const result = await findMatchingFailures({ type: 'manual' })
    expect(result).toEqual([])
  })
})
