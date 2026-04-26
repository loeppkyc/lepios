/**
 * Tests for lib/harness/component-bump.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockInsert, mockFrom } = vi.hoisted(() => {
  const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockFrom = vi.fn()
  return { mockInsert, mockFrom }
})

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { parseBumpDirectives, applyBumps, type BumpDirective } from '@/lib/harness/component-bump'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInsertBuilder() {
  return { insert: mockInsert }
}

function makeUpdateBuilder(rows: Array<{ id: string }>, error: null | { message: string } = null) {
  const selectResult = vi.fn().mockResolvedValue({ data: rows, error })
  const eqFn = vi.fn().mockReturnValue({ select: selectResult })
  return { update: vi.fn().mockReturnValue({ eq: eqFn }) }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ── parseBumpDirectives — pure function ───────────────────────────────────────

describe('parseBumpDirectives', () => {
  it('returns empty array when text has no BUMP lines', () => {
    expect(parseBumpDirectives('')).toEqual([])
    expect(parseBumpDirectives('feat: normal commit\n\nsome description')).toEqual([])
  })

  it('parses a single valid BUMP directive', () => {
    const result = parseBumpDirectives('BUMP: harness:smoke_test_framework=90')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('harness:smoke_test_framework')
    expect(result[0].pct).toBe(90)
    expect(result[0].raw).toBe('BUMP: harness:smoke_test_framework=90')
  })

  it('parses multiple BUMP directives from multi-line text', () => {
    const text = [
      'feat: auto-bump harness components on PR merge',
      '',
      'Adds bump sweep to deploy-gate-runner.',
      '',
      'BUMP: harness:smoke_test_framework=90',
      'BUMP: harness:prestaged_tasks=66',
    ].join('\n')

    const result = parseBumpDirectives(text)
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('harness:smoke_test_framework')
    expect(result[0].pct).toBe(90)
    expect(result[1].id).toBe('harness:prestaged_tasks')
    expect(result[1].pct).toBe(66)
  })

  it('normalizes hyphens to underscores in slug', () => {
    const result = parseBumpDirectives('BUMP: harness:smoke-test-framework=75')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('harness:smoke_test_framework')
    expect(result[0].raw).toBe('BUMP: harness:smoke-test-framework=75')
  })

  it('ignores BUMP lines with pct > 100', () => {
    const result = parseBumpDirectives('BUMP: harness:twin_ollama=101')
    expect(result).toHaveLength(0)
  })

  it('accepts pct = 0 and pct = 100 as valid boundaries', () => {
    const r1 = parseBumpDirectives('BUMP: harness:twin_ollama=0')
    const r2 = parseBumpDirectives('BUMP: harness:twin_ollama=100')
    expect(r1).toHaveLength(1)
    expect(r1[0].pct).toBe(0)
    expect(r2).toHaveLength(1)
    expect(r2[0].pct).toBe(100)
  })

  it('ignores malformed lines — missing colon separator', () => {
    const result = parseBumpDirectives('BUMP harness:twin_ollama=50')
    expect(result).toHaveLength(0)
  })

  it('ignores malformed lines — missing = sign', () => {
    const result = parseBumpDirectives('BUMP: harness:twin_ollama 50')
    expect(result).toHaveLength(0)
  })

  it('ignores malformed lines — non-harness namespace', () => {
    const result = parseBumpDirectives('BUMP: foo:bar=50')
    expect(result).toHaveLength(0)
  })

  it('handles leading/trailing whitespace on BUMP line', () => {
    const result = parseBumpDirectives('  BUMP: harness:twin_ollama=50  ')
    expect(result).toHaveLength(1)
    expect(result[0].pct).toBe(50)
  })

  it('is case-insensitive for the BUMP keyword', () => {
    const lower = parseBumpDirectives('bump: harness:twin_ollama=50')
    expect(lower).toHaveLength(1)
  })
})

// ── applyBumps — DB integration ───────────────────────────────────────────────

describe('applyBumps — empty directives', () => {
  it('returns empty array and makes no DB calls when directives is empty', async () => {
    const result = await applyBumps([], 'abc1234')
    expect(result).toEqual([])
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

describe('applyBumps — successful update', () => {
  it('updates completion_pct and logs harness_component_bumped on success', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_components') {
        return makeUpdateBuilder([{ id: 'harness:smoke_test_framework' }])
      }
      return makeInsertBuilder() // agent_events
    })

    const directives: BumpDirective[] = [
      { id: 'harness:smoke_test_framework', pct: 90, raw: 'BUMP: harness:smoke_test_framework=90' },
    ]

    const result = await applyBumps(directives, 'abc1234')

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('harness:smoke_test_framework')
    expect(result[0].pct).toBe(90)
    expect(result[0].success).toBe(true)
    expect(result[0].error).toBeUndefined()

    // agent_events insert: harness_component_bumped
    const bumpedInsert = mockInsert.mock.calls.find((c: unknown[]) => {
      const row = c[0] as Record<string, unknown>
      return row.action === 'harness_component_bumped'
    })
    expect(bumpedInsert).toBeDefined()
    const row = bumpedInsert![0] as Record<string, unknown>
    expect(row.status).toBe('success')
    expect(row.domain).toBe('harness')
    expect((row.meta as Record<string, unknown>).id).toBe('harness:smoke_test_framework')
    expect((row.meta as Record<string, unknown>).pct).toBe(90)
    expect((row.meta as Record<string, unknown>).commit_sha).toBe('abc1234')
  })
})

describe('applyBumps — nonexistent slug', () => {
  it('logs harness_component_bump_failed when update matches 0 rows', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_components') {
        return makeUpdateBuilder([]) // 0 rows matched
      }
      return makeInsertBuilder()
    })

    const directives: BumpDirective[] = [
      { id: 'harness:does_not_exist', pct: 50, raw: 'BUMP: harness:does_not_exist=50' },
    ]

    const result = await applyBumps(directives, 'deadbeef')

    expect(result[0].success).toBe(false)
    expect(result[0].error).toContain('no_rows_updated')

    const failedInsert = mockInsert.mock.calls.find((c: unknown[]) => {
      const row = c[0] as Record<string, unknown>
      return row.action === 'harness_component_bump_failed'
    })
    expect(failedInsert).toBeDefined()
    const row = failedInsert![0] as Record<string, unknown>
    expect(row.status).toBe('error')
    expect((row.meta as Record<string, unknown>).id).toBe('harness:does_not_exist')
  })

  it('logs harness_component_bump_failed when Supabase returns an error', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_components') {
        return makeUpdateBuilder([], { message: 'connection refused' })
      }
      return makeInsertBuilder()
    })

    const directives: BumpDirective[] = [
      { id: 'harness:twin_ollama', pct: 50, raw: 'BUMP: harness:twin_ollama=50' },
    ]

    const result = await applyBumps(directives, 'sha123')

    expect(result[0].success).toBe(false)
    expect(result[0].error).toBe('connection refused')
  })
})

describe('applyBumps — multiple directives', () => {
  it('applies all directives and returns one result per directive', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_components') {
        return makeUpdateBuilder([{ id: 'harness:any' }])
      }
      return makeInsertBuilder()
    })

    const directives: BumpDirective[] = [
      { id: 'harness:smoke_test_framework', pct: 90, raw: 'BUMP: harness:smoke_test_framework=90' },
      { id: 'harness:prestaged_tasks', pct: 66, raw: 'BUMP: harness:prestaged_tasks=66' },
    ]

    const result = await applyBumps(directives, 'multicommit')

    expect(result).toHaveLength(2)
    expect(result[0].success).toBe(true)
    expect(result[1].success).toBe(true)
    expect(result[1].id).toBe('harness:prestaged_tasks')
  })

  it('continues processing remaining directives when one fails', async () => {
    let callCount = 0
    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_components') {
        callCount++
        // First directive fails (0 rows), second succeeds
        return makeUpdateBuilder(callCount === 1 ? [] : [{ id: 'harness:twin_ollama' }])
      }
      return makeInsertBuilder()
    })

    const directives: BumpDirective[] = [
      { id: 'harness:missing_one', pct: 10, raw: 'BUMP: harness:missing_one=10' },
      { id: 'harness:twin_ollama', pct: 50, raw: 'BUMP: harness:twin_ollama=50' },
    ]

    const result = await applyBumps(directives, 'mixedsha')

    expect(result).toHaveLength(2)
    expect(result[0].success).toBe(false)
    expect(result[1].success).toBe(true)
  })
})

describe('applyBumps — DB insert errors are non-fatal', () => {
  it('still returns success even when the agent_events insert throws', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_components') {
        return makeUpdateBuilder([{ id: 'harness:smoke_test_framework' }])
      }
      // agent_events insert throws
      return { insert: vi.fn().mockRejectedValue(new Error('db down')) }
    })

    const directives: BumpDirective[] = [
      { id: 'harness:smoke_test_framework', pct: 90, raw: 'BUMP: harness:smoke_test_framework=90' },
    ]

    const result = await applyBumps(directives, 'sha')
    // Update succeeded — result is success even if event log fails
    expect(result[0].success).toBe(true)
  })
})
