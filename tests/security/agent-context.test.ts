/**
 * Tests for lib/security/agent-context.ts
 *
 * Coverage:
 *   - currentAgentId returns undefined outside any context
 *   - runWithAgentContext sets agentId for the duration of fn
 *   - Nested contexts use the innermost agentId
 *   - Context does not leak between sibling runs
 *   - Works with async functions
 */

import { describe, it, expect } from 'vitest'
import { runWithAgentContext, currentAgentId } from '@/lib/security/agent-context'

describe('currentAgentId — no context', () => {
  it('returns undefined when called outside runWithAgentContext', () => {
    expect(currentAgentId()).toBeUndefined()
  })
})

describe('runWithAgentContext — sync', () => {
  it('makes agentId available inside fn', () => {
    let captured: string | undefined
    runWithAgentContext('coordinator', () => {
      captured = currentAgentId()
    })
    expect(captured).toBe('coordinator')
  })

  it('restores undefined after fn returns', () => {
    runWithAgentContext('builder', () => {})
    expect(currentAgentId()).toBeUndefined()
  })

  it('passes different agentIds to sibling runs without leaking', () => {
    let a: string | undefined
    let b: string | undefined
    runWithAgentContext('coordinator', () => {
      a = currentAgentId()
    })
    runWithAgentContext('builder', () => {
      b = currentAgentId()
    })
    expect(a).toBe('coordinator')
    expect(b).toBe('builder')
  })

  it('inner context shadows outer context', () => {
    let inner: string | undefined
    let outer: string | undefined
    runWithAgentContext('coordinator', () => {
      outer = currentAgentId()
      runWithAgentContext('builder', () => {
        inner = currentAgentId()
      })
    })
    expect(outer).toBe('coordinator')
    expect(inner).toBe('builder')
  })

  it('outer context is restored after inner context exits', () => {
    let afterInner: string | undefined
    runWithAgentContext('coordinator', () => {
      runWithAgentContext('builder', () => {})
      afterInner = currentAgentId()
    })
    expect(afterInner).toBe('coordinator')
  })
})

describe('runWithAgentContext — async', () => {
  it('propagates agentId through async continuation', async () => {
    let captured: string | undefined
    await runWithAgentContext('harness', async () => {
      await Promise.resolve()
      captured = currentAgentId()
    })
    expect(captured).toBe('harness')
  })

  it('concurrent async runs do not cross-contaminate', async () => {
    const results: string[] = []

    const runA = runWithAgentContext('coordinator', async () => {
      await new Promise((r) => setTimeout(r, 10))
      results.push(currentAgentId() ?? 'none')
    })

    const runB = runWithAgentContext('builder', async () => {
      await new Promise((r) => setTimeout(r, 5))
      results.push(currentAgentId() ?? 'none')
    })

    await Promise.all([runA, runB])
    // runB resolves first (5ms), then runA (10ms)
    expect(results).toContain('coordinator')
    expect(results).toContain('builder')
    expect(results).toHaveLength(2)
  })
})
