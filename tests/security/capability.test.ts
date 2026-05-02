/**
 * Unit tests for lib/security/capability.ts
 *
 * Mocks @/lib/supabase/service — no live DB required.
 *
 * Coverage:
 *   - log_only mode: allows + audits even without a grant
 *   - enforce mode: allows when an explicit grant exists
 *   - enforce mode: throws CapabilityDeniedError when no grant
 *   - unknown capability: always throws (logs denied)
 *   - missing agent_capabilities rows: defaults to registry's enforcement mode
 *   - wildcard grant: 'db.read.*' satisfies 'db.read.agent_events'
 *   - warn mode: allows + audits
 *   - hasCapability: returns boolean, no audit trail
 *   - checkCapability: never throws
 *   - assertCapability: throws on deny (same as requireCapability)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import {
  requireCapability,
  assertCapability,
  checkCapability,
  hasCapability,
  CapabilityDeniedError,
} from '@/lib/security/capability'

// ── Chain factories ───────────────────────────────────────────────────────────

type RegistryRow = { capability: string; default_enforcement: string } | null
type GrantRow = { capability: string; enforcement_mode: string; target_pattern: string | null }

function makeRegistryChain(row: RegistryRow) {
  const maybySingle = vi.fn().mockResolvedValue({ data: row, error: null })
  const eq = vi.fn().mockReturnValue({ maybeSingle: maybySingle })
  const select = vi.fn().mockReturnValue({ eq })
  return { select, eq, maybeSingle: maybySingle }
}

function makeGrantsChain(rows: GrantRow[]) {
  const chain: Record<string, unknown> = {}
  chain['select'] = vi.fn().mockReturnValue(chain)
  chain['eq'] = vi.fn().mockResolvedValue({ data: rows, error: null })
  return chain
}

function makeInsertChain(id = 'audit-id-test') {
  const single = vi.fn().mockResolvedValue({ data: { id }, error: null })
  const select = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockReturnValue({ select })
  return { insert, select, single }
}

function setupMocks({
  registryRow,
  grantRows = [],
  auditId = 'audit-id-test',
}: {
  registryRow: RegistryRow
  grantRows?: GrantRow[]
  auditId?: string
}) {
  const insertChain = makeInsertChain(auditId)

  mockFrom.mockImplementation((table: string) => {
    if (table === 'capability_registry') return makeRegistryChain(registryRow)
    if (table === 'agent_capabilities') return makeGrantsChain(grantRows)
    if (table === 'agent_actions') return insertChain
    throw new Error(`Unexpected table in test: ${table}`)
  })

  return { insertChain }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ── log_only mode ─────────────────────────────────────────────────────────────

describe('log_only mode — no grant', () => {
  it('returns allowed=true even without a grant', async () => {
    setupMocks({
      registryRow: { capability: 'db.read.agent_events', default_enforcement: 'log_only' },
    })

    const result = await requireCapability({
      agentId: 'test-agent',
      capability: 'db.read.agent_events',
    })

    expect(result.allowed).toBe(true)
    expect(result.enforcement_mode).toBe('log_only')
  })

  it('writes audit row with result=allowed_log_only', async () => {
    const { insertChain } = setupMocks({
      registryRow: { capability: 'db.read.agent_events', default_enforcement: 'log_only' },
      auditId: 'log-only-audit',
    })

    const result = await requireCapability({
      agentId: 'test-agent',
      capability: 'db.read.agent_events',
    })

    expect(result.audit_id).toBe('log-only-audit')
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: 'test-agent',
        capability: 'db.read.agent_events',
        action_type: 'cap_check',
        result: 'allowed_log_only',
        enforcement_mode: 'log_only',
      })
    )
  })

  it('reason is unregistered_agent when agent has no grants at all', async () => {
    setupMocks({
      registryRow: { capability: 'db.read.agent_events', default_enforcement: 'log_only' },
      grantRows: [],
    })

    const result = await requireCapability({
      agentId: 'unknown-agent',
      capability: 'db.read.agent_events',
    })

    expect(result.reason).toBe('unregistered_agent')
  })

  it('reason is no_grant_for_agent when agent has some grants but not this capability', async () => {
    setupMocks({
      registryRow: { capability: 'db.read.agent_events', default_enforcement: 'log_only' },
      grantRows: [{ capability: 'fs.read', enforcement_mode: 'log_only', target_pattern: null }],
    })

    const result = await requireCapability({
      agentId: 'partial-agent',
      capability: 'db.read.agent_events',
    })

    expect(result.reason).toBe('no_grant_for_agent')
    expect(result.allowed).toBe(true) // still allowed in log_only
  })
})

// ── enforce mode — granted ────────────────────────────────────────────────────

describe('enforce mode — grant exists', () => {
  it('returns allowed=true when grant enforcement_mode=enforce', async () => {
    setupMocks({
      registryRow: { capability: 'db.migrate', default_enforcement: 'enforce' },
      grantRows: [{ capability: 'db.migrate', enforcement_mode: 'enforce', target_pattern: null }],
    })

    const result = await requireCapability({ agentId: 'builder', capability: 'db.migrate' })

    expect(result.allowed).toBe(true)
    expect(result.reason).toBe('in_scope')
    expect(result.enforcement_mode).toBe('enforce')
  })

  it('writes audit row with result=allowed', async () => {
    const { insertChain } = setupMocks({
      registryRow: { capability: 'db.migrate', default_enforcement: 'enforce' },
      grantRows: [{ capability: 'db.migrate', enforcement_mode: 'enforce', target_pattern: null }],
      auditId: 'enforce-allowed-audit',
    })

    const result = await requireCapability({ agentId: 'builder', capability: 'db.migrate' })

    expect(result.audit_id).toBe('enforce-allowed-audit')
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'allowed', enforcement_mode: 'enforce' })
    )
  })
})

// ── enforce mode — no grant ───────────────────────────────────────────────────

describe('enforce mode — no grant', () => {
  it('throws CapabilityDeniedError', async () => {
    setupMocks({
      registryRow: { capability: 'db.migrate', default_enforcement: 'enforce' },
      grantRows: [],
    })

    await expect(
      requireCapability({ agentId: 'coordinator', capability: 'db.migrate' })
    ).rejects.toBeInstanceOf(CapabilityDeniedError)
  })

  it('error includes agentId and capability', async () => {
    setupMocks({
      registryRow: { capability: 'db.migrate', default_enforcement: 'enforce' },
      grantRows: [],
    })

    const err = await requireCapability({ agentId: 'coordinator', capability: 'db.migrate' }).catch(
      (e: unknown) => e
    )

    expect(err).toBeInstanceOf(CapabilityDeniedError)
    expect((err as CapabilityDeniedError).agentId).toBe('coordinator')
    expect((err as CapabilityDeniedError).capability).toBe('db.migrate')
  })

  it('writes audit row with result=denied before throwing', async () => {
    const { insertChain } = setupMocks({
      registryRow: { capability: 'db.migrate', default_enforcement: 'enforce' },
      grantRows: [],
    })

    await requireCapability({ agentId: 'coordinator', capability: 'db.migrate' }).catch(() => {})

    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'denied', action_type: 'cap_check' })
    )
  })

  it('missing agent_capabilities row defaults to deny in enforce mode', async () => {
    setupMocks({
      registryRow: { capability: 'git.force_push', default_enforcement: 'enforce' },
      grantRows: [],
    })

    await expect(
      requireCapability({ agentId: 'anyone', capability: 'git.force_push' })
    ).rejects.toBeInstanceOf(CapabilityDeniedError)
  })
})

// ── unknown capability ────────────────────────────────────────────────────────

describe('unknown capability', () => {
  it('throws CapabilityDeniedError with reason=unknown_capability', async () => {
    setupMocks({ registryRow: null }) // not in registry

    const err = await requireCapability({
      agentId: 'coordinator',
      capability: 'made.up.cap',
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(CapabilityDeniedError)
    expect((err as CapabilityDeniedError).reason).toBe('unknown_capability')
  })

  it('writes audit row for unknown capability', async () => {
    const { insertChain } = setupMocks({ registryRow: null, auditId: 'unknown-cap-audit' })

    await requireCapability({ agentId: 'coordinator', capability: 'made.up.cap' }).catch(() => {})

    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'denied',
        reason: 'unknown_capability',
      })
    )
  })
})

// ── wildcard grant ────────────────────────────────────────────────────────────

describe('wildcard grant', () => {
  it('db.read.* satisfies db.read.agent_events', async () => {
    setupMocks({
      registryRow: { capability: 'db.read.agent_events', default_enforcement: 'enforce' },
      grantRows: [{ capability: 'db.read.*', enforcement_mode: 'log_only', target_pattern: null }],
    })

    const result = await requireCapability({
      agentId: 'coordinator',
      capability: 'db.read.agent_events',
    })

    expect(result.allowed).toBe(true)
    expect(result.reason).toBe('wildcard_grant')
  })

  it('db.* does NOT satisfy db.read.agent_events (not one segment deep)', async () => {
    setupMocks({
      registryRow: { capability: 'db.read.agent_events', default_enforcement: 'log_only' },
      grantRows: [{ capability: 'db.*', enforcement_mode: 'enforce', target_pattern: null }],
    })

    // Falls through to log_only (default) because wildcard doesn't match
    const result = await requireCapability({
      agentId: 'coordinator',
      capability: 'db.read.agent_events',
    })
    expect(result.reason).toBe('no_grant_for_agent')
  })

  it('exact match takes precedence over wildcard', async () => {
    setupMocks({
      registryRow: { capability: 'db.read.agent_events', default_enforcement: 'log_only' },
      grantRows: [
        { capability: 'db.read.*', enforcement_mode: 'log_only', target_pattern: null },
        { capability: 'db.read.agent_events', enforcement_mode: 'enforce', target_pattern: null },
      ],
    })

    const result = await requireCapability({
      agentId: 'coordinator',
      capability: 'db.read.agent_events',
    })

    expect(result.reason).toBe('in_scope')
    expect(result.enforcement_mode).toBe('enforce')
  })
})

// ── warn mode ─────────────────────────────────────────────────────────────────

describe('warn mode — no grant', () => {
  it('returns allowed=true with result=allowed_warn', async () => {
    const { insertChain } = setupMocks({
      registryRow: { capability: 'db.write.agent_events', default_enforcement: 'warn' },
      grantRows: [],
    })

    const result = await requireCapability({
      agentId: 'test-agent',
      capability: 'db.write.agent_events',
    })

    expect(result.allowed).toBe(true)
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'allowed_warn' })
    )
  })
})

// ── hasCapability ─────────────────────────────────────────────────────────────

describe('hasCapability', () => {
  it('returns true when agent has an exact grant', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_capabilities')
        return makeGrantsChain([
          { capability: 'fs.read', enforcement_mode: 'log_only', target_pattern: null },
        ])
      throw new Error(`Unexpected: ${table}`)
    })

    expect(await hasCapability('coordinator', 'fs.read')).toBe(true)
  })

  it('returns true when matched via wildcard', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_capabilities')
        return makeGrantsChain([
          { capability: 'db.read.*', enforcement_mode: 'log_only', target_pattern: null },
        ])
      throw new Error(`Unexpected: ${table}`)
    })

    expect(await hasCapability('coordinator', 'db.read.knowledge')).toBe(true)
  })

  it('returns false when no matching grant', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_capabilities') return makeGrantsChain([])
      throw new Error(`Unexpected: ${table}`)
    })

    expect(await hasCapability('coordinator', 'git.force_push')).toBe(false)
  })

  it('does NOT write to agent_actions', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_capabilities') return makeGrantsChain([])
      throw new Error(`hasCapability called unexpected table: ${table}`)
    })

    // Would throw if agent_actions was called (unexpected table handler above)
    await expect(hasCapability('coordinator', 'fs.read')).resolves.toBe(false)
  })
})

// ── checkCapability ───────────────────────────────────────────────────────────

describe('checkCapability — never throws', () => {
  it('returns CapabilityResult with allowed=false instead of throwing', async () => {
    setupMocks({
      registryRow: { capability: 'db.migrate', default_enforcement: 'enforce' },
      grantRows: [],
    })

    const result = await checkCapability({ agentId: 'coordinator', capability: 'db.migrate' })

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('unregistered_agent')
  })

  it('returns allowed=true when granted', async () => {
    setupMocks({
      registryRow: { capability: 'db.migrate', default_enforcement: 'enforce' },
      grantRows: [{ capability: 'db.migrate', enforcement_mode: 'enforce', target_pattern: null }],
    })

    const result = await checkCapability({ agentId: 'builder', capability: 'db.migrate' })

    expect(result.allowed).toBe(true)
  })
})

// ── assertCapability ──────────────────────────────────────────────────────────

describe('assertCapability', () => {
  it('resolves when allowed', async () => {
    setupMocks({
      registryRow: { capability: 'db.read.agent_events', default_enforcement: 'log_only' },
    })

    await expect(
      assertCapability({ agentId: 'test', capability: 'db.read.agent_events' })
    ).resolves.toBeUndefined()
  })

  it('throws when denied (enforce mode, no grant)', async () => {
    setupMocks({
      registryRow: { capability: 'db.migrate', default_enforcement: 'enforce' },
      grantRows: [],
    })

    await expect(
      assertCapability({ agentId: 'coordinator', capability: 'db.migrate' })
    ).rejects.toBeInstanceOf(CapabilityDeniedError)
  })
})
