/**
 * tests/harness/f19/optimizer.test.ts
 *
 * AT1 — Optimizer respects min_gain_pct floor.
 */

import { describe, it, expect } from 'vitest'
import { StubOptimizer } from '@/lib/harness/f19/optimizer'

describe('StubOptimizer — AT1: respects min_gain_pct floor', () => {
  const optimizer = new StubOptimizer()

  it('AT1a — returns [] when min_gain_pct (60) exceeds stub expected_gain_pct (50)', async () => {
    const result = await optimizer.propose({
      target: 'harness:process_efficiency',
      min_gain_pct: 60,
    })
    expect(result).toEqual([])
  })

  it('AT1b — returns 1 candidate when min_gain_pct (20) is below stub expected_gain_pct (50)', async () => {
    const result = await optimizer.propose({
      target: 'harness:process_efficiency',
      min_gain_pct: 20,
    })
    expect(result).toHaveLength(1)
    expect(result[0].expected_gain_pct).toBe(50)
  })

  it('uses default min_gain_pct of 20 when not specified', async () => {
    const result = await optimizer.propose({
      target: 'harness:process_efficiency',
    })
    expect(result).toHaveLength(1)
    expect(result[0].expected_gain_pct).toBe(50)
  })

  it('returns candidate with all required CandidatePath fields', async () => {
    const result = await optimizer.propose({
      target: 'harness:process_efficiency',
      min_gain_pct: 20,
    })
    expect(result).toHaveLength(1)
    const candidate = result[0]
    expect(typeof candidate.id).toBe('string')
    expect(candidate.id.length).toBeGreaterThan(0)
    expect(typeof candidate.target).toBe('string')
    expect(typeof candidate.summary).toBe('string')
    expect(typeof candidate.expected_gain_pct).toBe('number')
    expect(typeof candidate.metric_key).toBe('string')
    expect(candidate.proposed_change).toBeDefined()
    expect(['code', 'config', 'process', 'schema']).toContain(candidate.proposed_change.kind)
    expect(typeof candidate.proposed_change.diff_summary).toBe('string')
    expect(typeof candidate.rationale).toBe('string')
  })

  it('returns candidate targeting queue_depth metric', async () => {
    const result = await optimizer.propose({
      target: 'harness:process_efficiency',
      min_gain_pct: 20,
    })
    expect(result[0].metric_key).toBe('queue_depth')
  })

  it('returns candidate with summary about spawning coordinator at queue depth >= 2', async () => {
    const result = await optimizer.propose({
      target: 'harness:process_efficiency',
      min_gain_pct: 20,
    })
    expect(result[0].summary).toContain('queue depth')
  })

  it('returns exactly [] at the boundary: min_gain_pct = 51 (above 50)', async () => {
    const result = await optimizer.propose({
      target: 'harness:process_efficiency',
      min_gain_pct: 51,
    })
    expect(result).toEqual([])
  })

  it('returns candidate at the boundary: min_gain_pct = 50 (equal to stub gain)', async () => {
    const result = await optimizer.propose({
      target: 'harness:process_efficiency',
      min_gain_pct: 50,
    })
    expect(result).toHaveLength(1)
  })
})
