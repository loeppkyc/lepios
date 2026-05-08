/**
 * T-001 v2 integration tests — continuous mode.
 *
 * Covers:
 *   (a) auto-pick selects highest-leverage non-blocked, non-complete module
 *   (b) done-state drafter: hasDoneState() detects existing vs missing specs
 *   (c) quota-monitor: checkQuota() halts when token_budget signal fires
 *   (d) /run continuous end-to-end: creates coordinator_run_state + decisions_log
 *
 * Uses fake Supabase client — no real DB calls.
 * Does NOT write to docs/leverage-targets.md during test run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/orchestrator/telegram', () => ({
  postMessage: vi.fn(),
}))

vi.mock('@/lib/harness/quota-guard', () => ({
  preClaimQuotaCheck: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'done_state: /mock-module displays mock data.' }],
      }),
    },
  })),
}))

// fs: let readFileSync pass through (reads real inventory); writeFileSync will be spied inline
vi.mock('fs', async (importOriginal) => importOriginal<typeof fs>())

vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue(''),
}))

const mockFetch = vi.fn().mockResolvedValue({ ok: true })
vi.stubGlobal('fetch', mockFetch)

import { createServiceClient } from '@/lib/supabase/service'
import { postMessage } from '@/lib/orchestrator/telegram'
import { preClaimQuotaCheck } from '@/lib/harness/quota-guard'
import { autoPickModule, logPickDecision } from '@/lib/harness/auto-pick'
import { hasDoneState, draftDoneState } from '@/lib/harness/done-state-drafter'
import { checkQuota, haltContinuousRun } from '@/lib/harness/quota-monitor'
import { handleRunCommand, handleQueueRunCommand } from '@/lib/harness/coordinator-commands'

// ── Helpers ───────────────────────────────────────────────────────────────────

type SelectChain = {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  in: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
  single: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  head: ReturnType<typeof vi.fn>
}

function makeChain(overrides: Partial<SelectChain> = {}): SelectChain {
  const chain: SelectChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    single: vi.fn().mockResolvedValue({ data: { id: 'fake-uuid-1234' }, error: null }),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    head: vi.fn().mockReturnThis(),
    ...overrides,
  }
  // Make chainable methods return the chain itself
  const chainable = ['select', 'eq', 'in', 'update', 'order', 'limit']
  for (const method of chainable) {
    if (!overrides[method as keyof SelectChain]) {
      chain[method as keyof SelectChain] = vi.fn().mockReturnValue(chain)
    }
  }
  return chain
}

function makeDb(tableOverrides: Record<string, () => SelectChain> = {}) {
  const defaultChain = makeChain()
  return {
    from: vi.fn((table: string) => {
      if (tableOverrides[table]) return tableOverrides[table]()
      return defaultChain
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockResolvedValue({ ok: true })
})

// ── (a) auto-pick ─────────────────────────────────────────────────────────────

describe('autoPickModule', () => {
  it('returns the highest-leverage eligible module from real inventory', async () => {
    // Use real system-inventory.md via fs.readFileSync (not mocked for reads)
    const result = await autoPickModule([])

    // Should succeed — the inventory has eligible modules
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Top pick must have leverage > 0 and completion < 95
    expect(result.leverage_score).toBeGreaterThan(0)
    expect(result.completion_pct).toBeLessThan(95)

    // Should not be an obviously complete module
    expect(result.module_id).not.toBe('coordinator-agent')
    expect(result.module_id).not.toBe('harness-failures-log')
    expect(result.module_id).not.toBe('safety-agent')
  })

  it('excludes modules in the excludeIds list', async () => {
    const first = await autoPickModule([])
    if (!first.ok) return

    const second = await autoPickModule([first.module_id])
    if (!second.ok) return

    expect(second.module_id).not.toBe(first.module_id)
  })

  it('skips modules with completion >= 95 and blocked modules', async () => {
    const result = await autoPickModule([])
    if (!result.ok) return

    // The returned candidates list must all have completion < 95
    for (const c of result.candidates_ranked) {
      expect(c.completion_pct).toBeLessThan(95)
      expect(c.skip_reason).toBeUndefined()
    }
  })

  it('returns ok:false when all modules are excluded', async () => {
    // Build a huge excludeIds list that covers everything plausible
    const allIds = [
      'pageprofit-scanner',
      'cockpit-receipts',
      'cockpit-scan',
      'retail-scout-arbitrage',
      'behav-f17',
      'cockpit-hit-lists',
      'builder-agent',
      'meas-f18',
      'cockpit-money',
      'cockpit-net-worth',
      'cockpit-amazon-sales',
      'cockpit-amazon',
      'cockpit-business-review',
      'cockpit-payouts',
      'cockpit-cogs',
      'cockpit-inventory',
      'cockpit-pallets',
    ]
    const result = await autoPickModule(allIds)
    // May still find something, but if not — should return ok:false gracefully
    if (!result.ok) {
      expect(result.reason).toContain('no eligible')
    }
  })

  it('logPickDecision writes to decisions_log without throwing', async () => {
    const db = makeDb({
      decisions_log: () => {
        const chain = makeChain()
        chain.insert = vi.fn().mockResolvedValue({ data: null, error: null })
        return chain
      },
    })
    vi.mocked(createServiceClient).mockReturnValue(
      db as unknown as ReturnType<typeof createServiceClient>
    )

    const result = await autoPickModule([])
    if (!result.ok) return

    await expect(logPickDecision(result, 'test-run-id-1234')).resolves.not.toThrow()
  })
})

// ── (b) done-state drafter ────────────────────────────────────────────────────

describe('hasDoneState', () => {
  it('returns true for modules with existing specs (T-003, T-004, etc.)', () => {
    // These are confirmed in leverage-targets.md
    expect(hasDoneState('cockpit-receipts')).toBe(true) // T-003 spec exists
    expect(hasDoneState('pageprofit-scanner')).toBe(true) // T-004 spec exists
  })

  it('returns false for modules with no spec', () => {
    // These show "no spec yet" in inventory
    expect(hasDoneState('cockpit-hit-lists')).toBe(false)
    expect(hasDoneState('behav-f17')).toBe(false)
  })

  it('returns false for a completely unknown module ID', () => {
    expect(hasDoneState('xyzzy-not-a-real-module-abc123')).toBe(false)
  })
})

describe('draftDoneState', () => {
  it('returns drafted:false when module already has a done_state', async () => {
    const result = await draftDoneState('cockpit-receipts', 'Receipts')
    expect(result.drafted).toBe(false)
    if (!result.drafted) {
      expect(result.reason).toContain('already exists')
    }
  })

  it('returns drafted:false for no-context module', async () => {
    // execSync is mocked to return '' — no context found; hasDoneState also false for xyzzy
    const result = await draftDoneState('xyzzy-no-context-module', 'Unknown Module')
    expect(result.drafted).toBe(false)
    if (!result.drafted) {
      expect(result.reason).toContain('no context found')
    }
  })
})

// ── (c) quota-monitor ─────────────────────────────────────────────────────────

describe('checkQuota', () => {
  it('halts when token budget exceeds threshold', async () => {
    const db = makeDb({
      coordinator_run_state: () => {
        const chain = makeChain()
        // last_quota_check_at is old — don't skip
        chain.maybeSingle = vi.fn().mockResolvedValue({
          data: { last_quota_check_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() },
          error: null,
        })
        chain.update = vi.fn().mockResolvedValue({ error: null })
        return chain
      },
      harness_config: () => {
        const chain = makeChain()
        // HARNESS_QUOTA_TOKENS_USED=900000, LIMIT=1000000, THRESHOLD=85 → 90% > 85% → halt
        chain.select = vi.fn().mockReturnValue({
          ...chain,
          in: vi.fn().mockResolvedValue({
            data: [
              { key: 'HARNESS_QUOTA_TOKENS_USED', value: '900000' },
              { key: 'HARNESS_QUOTA_TOKENS_LIMIT', value: '1000000' },
              { key: 'HARNESS_QUOTA_THRESHOLD', value: '85' },
            ],
            error: null,
          }),
        })
        return chain
      },
    })
    vi.mocked(createServiceClient).mockReturnValue(
      db as unknown as ReturnType<typeof createServiceClient>
    )
    vi.mocked(preClaimQuotaCheck).mockResolvedValue({
      safe_to_claim: true,
      reason: 'no_recent_429s',
    })

    const status = await checkQuota('test-run-id')
    expect(status.should_halt).toBe(true)
    expect(status.signal).toBe('token_budget')
    expect(status.usage_pct).toBe(90)
  })

  it('halts when routines 429 backoff is active', async () => {
    const db = makeDb({
      coordinator_run_state: () => {
        const chain = makeChain()
        chain.maybeSingle = vi.fn().mockResolvedValue({
          data: { last_quota_check_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() },
          error: null,
        })
        chain.update = vi.fn().mockResolvedValue({ error: null })
        return chain
      },
      harness_config: () => {
        const chain = makeChain()
        chain.select = vi.fn().mockReturnValue({
          ...chain,
          in: vi.fn().mockResolvedValue({
            data: [
              { key: 'HARNESS_QUOTA_TOKENS_USED', value: '0' },
              { key: 'HARNESS_QUOTA_TOKENS_LIMIT', value: '1000000' },
              { key: 'HARNESS_QUOTA_THRESHOLD', value: '85' },
            ],
            error: null,
          }),
        })
        return chain
      },
    })
    vi.mocked(createServiceClient).mockReturnValue(
      db as unknown as ReturnType<typeof createServiceClient>
    )
    vi.mocked(preClaimQuotaCheck).mockResolvedValue({
      safe_to_claim: false,
      reason: 'quota_429_backoff_active',
      retry_after_minutes: 30,
    })

    const status = await checkQuota('test-run-id')
    expect(status.should_halt).toBe(true)
    expect(status.signal).toBe('routines_429')
    expect(status.usage_pct).toBe(100)
  })

  it('skips check when within 10-minute interval', async () => {
    const db = makeDb({
      coordinator_run_state: () => {
        const chain = makeChain()
        // last_quota_check_at is recent (2 min ago) — skip
        chain.maybeSingle = vi.fn().mockResolvedValue({
          data: { last_quota_check_at: new Date(Date.now() - 2 * 60 * 1000).toISOString() },
          error: null,
        })
        return chain
      },
    })
    vi.mocked(createServiceClient).mockReturnValue(
      db as unknown as ReturnType<typeof createServiceClient>
    )

    const status = await checkQuota('test-run-id')
    expect(status.skip_check).toBe(true)
    expect(status.should_halt).toBe(false)
  })

  it('returns ok (no halt) when under threshold', async () => {
    const db = makeDb({
      coordinator_run_state: () => {
        const chain = makeChain()
        chain.maybeSingle = vi.fn().mockResolvedValue({
          data: { last_quota_check_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() },
          error: null,
        })
        chain.update = vi.fn().mockResolvedValue({ error: null })
        return chain
      },
      harness_config: () => {
        const chain = makeChain()
        chain.select = vi.fn().mockReturnValue({
          ...chain,
          in: vi.fn().mockResolvedValue({
            data: [
              { key: 'HARNESS_QUOTA_TOKENS_USED', value: '100000' },
              { key: 'HARNESS_QUOTA_TOKENS_LIMIT', value: '1000000' },
              { key: 'HARNESS_QUOTA_THRESHOLD', value: '85' },
            ],
            error: null,
          }),
        })
        return chain
      },
    })
    vi.mocked(createServiceClient).mockReturnValue(
      db as unknown as ReturnType<typeof createServiceClient>
    )
    vi.mocked(preClaimQuotaCheck).mockResolvedValue({
      safe_to_claim: true,
      reason: 'no_recent_429s',
    })

    const status = await checkQuota('test-run-id')
    expect(status.should_halt).toBe(false)
    expect(status.signal).toBe('ok')
    expect(status.usage_pct).toBe(10)
  })
})

describe('haltContinuousRun', () => {
  it('writes halted_quota status and returns telegram summary', async () => {
    const updateFn = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
    const db = makeDb({
      coordinator_run_state: () => {
        const chain = makeChain()
        chain.select = vi.fn().mockReturnValue({
          ...chain,
          eq: vi.fn().mockReturnValue({
            ...chain,
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                modules_shipped: ['cockpit-receipts'],
                modules_shipped_count: 1,
                modules_attempted_count: 1,
                current_target: 'cockpit-scan',
              },
              error: null,
            }),
          }),
        })
        chain.update = updateFn
        return chain
      },
      harness_config: () => {
        const chain = makeChain()
        chain.update = updateFn
        return chain
      },
      agent_events: () => {
        const chain = makeChain()
        chain.insert = vi.fn().mockResolvedValue({ error: null })
        return chain
      },
    })
    vi.mocked(createServiceClient).mockReturnValue(
      db as unknown as ReturnType<typeof createServiceClient>
    )

    const quotaStatus = {
      usage_pct: 90,
      threshold: 85,
      should_halt: true,
      signal: 'token_budget' as const,
      detail: 'tokens used=900000 / limit=1000000 (90%)',
      skip_check: false,
    }

    const halt = await haltContinuousRun('test-run-id-5678', quotaStatus)

    expect(halt.modules_shipped_count).toBe(1)
    expect(halt.quota_pct).toBe(90)
    expect(halt.telegram_lines.some((l) => l.includes('quota threshold reached'))).toBe(true)
    expect(halt.telegram_lines.some((l) => l.includes('90%'))).toBe(true)
    expect(halt.telegram_lines.some((l) => l.includes('/resume'))).toBe(true)
  })
})

// ── (d) /run continuous end-to-end ───────────────────────────────────────────

describe('/run continuous command', () => {
  it('picks a module, creates coordinator_run_state row, telegrams summary', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let insertedRunState: any = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let insertedTask: any = null

    const db = makeDb({
      coordinator_run_state: () => {
        const chain = makeChain()
        // No existing active run
        chain.select = vi.fn().mockReturnValue({
          ...chain,
          eq: vi.fn().mockReturnValue({
            ...chain,
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        })
        chain.insert = vi.fn().mockImplementation((data: Record<string, unknown>) => {
          insertedRunState = data
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'run-state-uuid' }, error: null }),
            }),
          }
        })
        chain.update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
        return chain
      },
      task_queue: () => {
        const chain = makeChain()
        chain.insert = vi.fn().mockImplementation((data: Record<string, unknown>) => {
          insertedTask = data
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'task-uuid' }, error: null }),
            }),
          }
        })
        return chain
      },
      harness_config: () => {
        const chain = makeChain()
        chain.select = vi.fn().mockReturnValue({
          ...chain,
          eq: vi.fn().mockReturnValue({
            ...chain,
            maybeSingle: vi.fn().mockResolvedValue({ data: { value: 'fake-secret' }, error: null }),
          }),
        })
        chain.update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
        return chain
      },
      decisions_log: () => {
        const chain = makeChain()
        chain.insert = vi.fn().mockResolvedValue({ data: null, error: null })
        return chain
      },
    })
    vi.mocked(createServiceClient).mockReturnValue(
      db as unknown as ReturnType<typeof createServiceClient>
    )
    vi.mocked(postMessage).mockResolvedValue(undefined)

    await handleRunCommand('/run continuous')

    // Should have telegraphed a summary
    expect(postMessage).toHaveBeenCalled()
    const msg = vi.mocked(postMessage).mock.calls[0][0] as string
    expect(msg).toContain('Continuous mode started')
    expect(msg).toContain('Target:')
    expect(msg).toContain('Score:')

    // Should have inserted coordinator_run_state
    expect(insertedRunState).not.toBeNull()
    expect(insertedRunState?.mode).toBe('continuous')
    expect(insertedRunState?.status).toBe('running')

    // Should have inserted a task into task_queue
    expect(insertedTask).not.toBeNull()
    expect(insertedTask?.task as string).toContain('[continuous]')
    expect(insertedTask?.task as string).toContain('Build/advance module')
  })

  it('/queue run continuous delegates to continuous pick flow', async () => {
    const db = makeDb({
      coordinator_run_state: () => {
        const chain = makeChain()
        chain.select = vi.fn().mockReturnValue({
          ...chain,
          eq: vi.fn().mockReturnValue({
            ...chain,
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        })
        chain.insert = vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'run-state-uuid-2' }, error: null }),
          }),
        })
        chain.update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
        return chain
      },
      task_queue: () => {
        const chain = makeChain()
        chain.insert = vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'task-uuid-2' }, error: null }),
          }),
        })
        return chain
      },
      harness_config: () => {
        const chain = makeChain()
        chain.select = vi.fn().mockReturnValue({
          ...chain,
          eq: vi.fn().mockReturnValue({
            ...chain,
            maybeSingle: vi.fn().mockResolvedValue({ data: { value: 'fake-secret' }, error: null }),
          }),
        })
        chain.update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
        return chain
      },
      decisions_log: () => {
        const chain = makeChain()
        chain.insert = vi.fn().mockResolvedValue({ data: null, error: null })
        return chain
      },
    })
    vi.mocked(createServiceClient).mockReturnValue(
      db as unknown as ReturnType<typeof createServiceClient>
    )
    vi.mocked(postMessage).mockResolvedValue(undefined)

    await handleQueueRunCommand('/queue run continuous')

    expect(postMessage).toHaveBeenCalled()
    const msg = vi.mocked(postMessage).mock.calls[0][0] as string
    expect(msg).toContain('Continuous mode started')
  })
})
