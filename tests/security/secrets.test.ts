/**
 * Tests for lib/security/secrets.ts
 *
 * Mocks:
 *   - requireCapability  (@/lib/security/capability)
 *   - currentAgentId     (@/lib/security/agent-context)
 *   - createClient       (@supabase/supabase-js) — intercepts the bootstrap client mkDb()
 *
 * Coverage:
 *   - Calls requireCapability with secret.read.{key} + resolved agentId
 *   - agentId resolution: AsyncLocalStorage > opts.agentId > 'harness'
 *   - Returns harness_config value when row exists
 *   - Falls back to process.env when harness_config returns no row
 *   - Throws when neither source has a value
 *   - Fire-and-forget access tracking: updates last_accessed_at + access_count
 *   - Access tracking failure does not throw
 *   - Re-throws CapabilityDeniedError when requireCapability throws
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock requireCapability ────────────────────────────────────────────────────

const { mockRequireCapability } = vi.hoisted(() => ({
  mockRequireCapability: vi.fn(),
}))

vi.mock('@/lib/security/capability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/capability')>()
  return { ...actual, requireCapability: mockRequireCapability }
})

// ── Mock agent-context ────────────────────────────────────────────────────────

const { mockCurrentAgentId } = vi.hoisted(() => ({
  mockCurrentAgentId: vi.fn<[], string | undefined>(),
}))

vi.mock('@/lib/security/agent-context', () => ({
  currentAgentId: mockCurrentAgentId,
  runWithAgentContext: vi.fn(),
}))

// ── Mock @supabase/supabase-js ────────────────────────────────────────────────
// Intercepts the bootstrap mkDb() call inside secrets.ts

const { mockSelect, mockUpdate } = vi.hoisted(() => {
  const mockUpdate = vi.fn()
  const mockSelect = vi.fn()
  return { mockSelect, mockUpdate }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'harness_config') {
        return {
          select: mockSelect,
          update: mockUpdate,
        }
      }
      return { select: vi.fn(), update: vi.fn() }
    }),
  })),
}))

import { getSecret } from '@/lib/security/secrets'
import { CapabilityDeniedError } from '@/lib/security/capability'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCapAllowed() {
  mockRequireCapability.mockResolvedValue({
    allowed: true,
    reason: 'in_scope',
    enforcement_mode: 'log_only',
    audit_id: 'test-audit-id',
  })
}

function makeSelectReturn(value: string | null) {
  const chain = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: value !== null ? { value, access_count: 3 } : null,
      error: null,
    }),
  }
  mockSelect.mockReturnValue(chain)
  return chain
}

function makeUpdateChain() {
  const chain = {
    eq: vi.fn().mockResolvedValue({ error: null }),
  }
  mockUpdate.mockReturnValue(chain)
  return chain
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockCurrentAgentId.mockReturnValue(undefined)
  makeCapAllowed()
  makeSelectReturn(null)
  makeUpdateChain()
})

afterEach(() => {
  delete process.env.TEST_SECRET_KEY
})

// ── agentId resolution ────────────────────────────────────────────────────────

describe('getSecret — agentId resolution', () => {
  it('uses AsyncLocalStorage agentId when available', async () => {
    mockCurrentAgentId.mockReturnValue('coordinator')
    makeSelectReturn('val')

    await getSecret('TEST_SECRET_KEY')

    expect(mockRequireCapability).toHaveBeenCalledWith({
      agentId: 'coordinator',
      capability: 'secret.read.TEST_SECRET_KEY',
    })
  })

  it('falls back to opts.agentId when AsyncLocalStorage returns undefined', async () => {
    mockCurrentAgentId.mockReturnValue(undefined)
    makeSelectReturn('val')

    await getSecret('TEST_SECRET_KEY', { agentId: 'builder' })

    expect(mockRequireCapability).toHaveBeenCalledWith({
      agentId: 'builder',
      capability: 'secret.read.TEST_SECRET_KEY',
    })
  })

  it('defaults to harness when neither AsyncLocalStorage nor opts.agentId is set', async () => {
    mockCurrentAgentId.mockReturnValue(undefined)
    makeSelectReturn('val')

    await getSecret('TEST_SECRET_KEY')

    expect(mockRequireCapability).toHaveBeenCalledWith({
      agentId: 'harness',
      capability: 'secret.read.TEST_SECRET_KEY',
    })
  })

  it('AsyncLocalStorage agentId takes priority over opts.agentId', async () => {
    mockCurrentAgentId.mockReturnValue('coordinator')
    makeSelectReturn('val')

    await getSecret('TEST_SECRET_KEY', { agentId: 'builder' })

    expect(mockRequireCapability).toHaveBeenCalledWith({
      agentId: 'coordinator',
      capability: 'secret.read.TEST_SECRET_KEY',
    })
  })
})

// ── Capability gate ───────────────────────────────────────────────────────────

describe('getSecret — capability gate', () => {
  it('calls requireCapability with secret.read.{key} capability', async () => {
    makeSelectReturn('val')

    await getSecret('SUPABASE_SERVICE_ROLE_KEY')

    expect(mockRequireCapability).toHaveBeenCalledOnce()
    expect(mockRequireCapability).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'secret.read.SUPABASE_SERVICE_ROLE_KEY' })
    )
  })

  it('re-throws CapabilityDeniedError when capability is denied', async () => {
    mockRequireCapability.mockRejectedValue(
      new CapabilityDeniedError('harness', 'secret.read.TEST_SECRET_KEY', 'no_grant_for_agent')
    )

    await expect(getSecret('TEST_SECRET_KEY')).rejects.toThrow(CapabilityDeniedError)
  })
})

// ── Value resolution ──────────────────────────────────────────────────────────

describe('getSecret — value resolution', () => {
  it('returns harness_config value when row exists', async () => {
    makeSelectReturn('db-secret-value')

    const result = await getSecret('TEST_SECRET_KEY')

    expect(result).toBe('db-secret-value')
  })

  it('falls back to process.env when harness_config has no row', async () => {
    makeSelectReturn(null)
    process.env.TEST_SECRET_KEY = 'env-value'

    const result = await getSecret('TEST_SECRET_KEY')

    expect(result).toBe('env-value')
  })

  it('throws when neither harness_config nor process.env has the value', async () => {
    makeSelectReturn(null)
    delete process.env.TEST_SECRET_KEY

    await expect(getSecret('TEST_SECRET_KEY')).rejects.toThrow(/TEST_SECRET_KEY/)
  })

  it('prefers harness_config value over process.env when both exist', async () => {
    makeSelectReturn('db-wins')
    process.env.TEST_SECRET_KEY = 'env-loses'

    const result = await getSecret('TEST_SECRET_KEY')

    expect(result).toBe('db-wins')
  })
})

// ── Access tracking ───────────────────────────────────────────────────────────

describe('getSecret — access tracking', () => {
  it('fires update to last_accessed_at and access_count when harness_config row exists', async () => {
    makeSelectReturn('db-value')
    const updateChain = makeUpdateChain()

    await getSecret('TEST_SECRET_KEY')

    // Allow the fire-and-forget update to settle
    await new Promise((r) => setTimeout(r, 10))

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        last_accessed_at: expect.any(String),
        access_count: 4, // 3 (from fixture) + 1
      })
    )
    expect(updateChain.eq).toHaveBeenCalledWith('key', 'TEST_SECRET_KEY')
  })

  it('does not update harness_config when falling back to process.env', async () => {
    makeSelectReturn(null)
    process.env.TEST_SECRET_KEY = 'env-value'

    await getSecret('TEST_SECRET_KEY')
    await new Promise((r) => setTimeout(r, 10))

    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('does not throw when access tracking update fails', async () => {
    makeSelectReturn('db-value')
    mockUpdate.mockReturnValue({
      eq: vi.fn().mockRejectedValue(new Error('DB down')),
    })

    await expect(getSecret('TEST_SECRET_KEY')).resolves.toBe('db-value')
  })
})
