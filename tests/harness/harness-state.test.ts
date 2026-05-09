/**
 * Tests for lib/harness/harness-state.ts
 *
 * Covers:
 *   - computeHarnessState() pure function — all 4 state transitions
 *   - HALTED takes priority over all other states
 */

import { describe, it, expect } from 'vitest'
import { computeHarnessState, type HarnessState } from '@/lib/harness/harness-state'

describe('computeHarnessState', () => {
  it('returns HALTED when halted=true regardless of queue', () => {
    expect(computeHarnessState({ halted: true, running: 0, queued: 0 })).toBe<HarnessState>(
      'HALTED'
    )
    expect(computeHarnessState({ halted: true, running: 2, queued: 3 })).toBe<HarnessState>(
      'HALTED'
    )
    expect(computeHarnessState({ halted: true, running: 0, queued: 5 })).toBe<HarnessState>(
      'HALTED'
    )
  })

  it('returns RUNNING when not halted and running > 0', () => {
    expect(computeHarnessState({ halted: false, running: 1, queued: 0 })).toBe<HarnessState>(
      'RUNNING'
    )
    expect(computeHarnessState({ halted: false, running: 3, queued: 5 })).toBe<HarnessState>(
      'RUNNING'
    )
  })

  it('returns STALLED when not halted, running = 0, queued > 0', () => {
    expect(computeHarnessState({ halted: false, running: 0, queued: 1 })).toBe<HarnessState>(
      'STALLED'
    )
    expect(computeHarnessState({ halted: false, running: 0, queued: 10 })).toBe<HarnessState>(
      'STALLED'
    )
  })

  it('returns IDLE when not halted, running = 0, queued = 0', () => {
    expect(computeHarnessState({ halted: false, running: 0, queued: 0 })).toBe<HarnessState>('IDLE')
  })
})
