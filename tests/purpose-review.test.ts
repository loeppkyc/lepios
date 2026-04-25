import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase service client ──────────────────────────────────────────────
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(),
}))

// ── Mock attribution writer ───────────────────────────────────────────────────
vi.mock('@/lib/attribution/writer', () => ({
  recordAttribution: vi.fn().mockResolvedValue(undefined),
}))

// ── Mock Ollama client ────────────────────────────────────────────────────────
vi.mock('@/lib/ollama/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ollama/client')>()
  return {
    ...actual,
    generate: vi.fn(),
    autoSelectModel: vi.fn().mockReturnValue('qwen2.5:32b'),
  }
})

// ── Mock fs (readFileSync) ────────────────────────────────────────────────────
vi.mock('fs', () => ({
  readFileSync: vi
    .fn()
    .mockReturnValue(
      [
        'import streamlit as st',
        'import pandas as pd',
        '"""Main module for Amazon scanning."""',
        '',
        'class AmazonScanner:',
        '    pass',
      ].join('\n')
    ),
}))

// ── Mock path (join) ──────────────────────────────────────────────────────────
vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>()
  return {
    ...actual,
    join: vi.fn((...args: string[]) => args.join('/')),
  }
})

import { generateModuleSummary, formatReviewMessage } from '@/lib/purpose-review/summary'
import { OllamaUnreachableError, generate, autoSelectModel } from '@/lib/ollama/client'
import {
  parsePurposeReviewCallback,
  handlePurposeReviewCallback,
  handlePurposeReviewTextReply,
} from '@/lib/purpose-review/handler'
import { checkPurposeReviewTimeouts } from '@/lib/purpose-review/timeout'
import { recordAttribution } from '@/lib/attribution/writer'

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function makeDbMock(
  opts: {
    taskRow?: Record<string, unknown> | null
    insertError?: object | null
    updateError?: object | null
    timedOutRows?: Array<{ id: string; metadata: Record<string, unknown> }>
  } = {}
) {
  const taskRow =
    opts.taskRow !== undefined
      ? opts.taskRow
      : {
          id: VALID_UUID,
          metadata: {
            module_path: 'pages/amazon_scan.py',
            classification: 'page',
            suggested_tier: '2',
            purpose_review: 'pending_notes',
          },
        }

  const insertMock = vi.fn().mockResolvedValue({ error: opts.insertError ?? null })
  const updateMock = vi.fn().mockResolvedValue({ error: opts.updateError ?? null })
  const singleMock = vi.fn().mockResolvedValue({ data: taskRow, error: null })
  const maybeSingleMock = vi.fn().mockResolvedValue({ data: taskRow, error: null })

  const streamlitRow = {
    path: 'pages/amazon_scan.py',
    classification: 'page',
    suggested_tier: '2',
    f17_signal: 'amazon_scan_event',
    f18_metric_candidate: 'scan_latency',
    lines: 350,
    external_deps: ['keepa', 'spapi'],
    notes: 'Amazon scan and list page',
  }
  const streamlitSingleMock = vi.fn().mockResolvedValue({ data: streamlitRow, error: null })

  const mockChain: Record<string, unknown> = {}
  const chainOf = (returnVal: unknown) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    maybeSingle: maybeSingleMock,
    single: singleMock,
  })

  const db = {
    from: vi.fn((table: string) => {
      if (table === 'task_queue') {
        const timedOutRows = opts.timedOutRows
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              lt: vi.fn().mockResolvedValue({ data: timedOutRows ?? null, error: null }),
              maybeSingle: maybeSingleMock,
            }),
            maybeSingle: maybeSingleMock,
          }),
          update: vi.fn().mockReturnValue({
            eq: updateMock,
          }),
          insert: insertMock,
        }
      }
      if (table === 'streamlit_modules') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: streamlitSingleMock,
            }),
          }),
        }
      }
      if (table === 'agent_events') {
        return {
          insert: insertMock,
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        insert: insertMock,
        update: vi.fn().mockReturnValue({ eq: updateMock }),
      }
    }),
  }

  return { db, insertMock, updateMock, maybeSingleMock }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Summary generation — 5 bullets present, fits in 4096 chars
// ─────────────────────────────────────────────────────────────────────────────

describe('purpose-review: summary generation', () => {
  beforeEach(() => {
    vi.mocked(generate).mockResolvedValue({
      text: 'Use a server component with SP-API polling instead of Streamlit session state.',
      confidence: 0.85,
      model: 'qwen2.5:32b',
      tokens_used: 120,
    })
  })

  it('generates a message with 5 bullets and under 4096 chars', async () => {
    const { db } = makeDbMock()
    const msg = await generateModuleSummary('pages/amazon_scan.py', db as never)

    // All 5 bullet labels must be present
    expect(msg).toContain('(a) Does:')
    expect(msg).toContain('(b) Goal:')
    expect(msg).toContain('(c) Issues:')
    expect(msg).toContain('(d) Baked in:')
    expect(msg).toContain('(e) Could instead:')

    // Must fit in Telegram limit
    expect(msg.length).toBeLessThanOrEqual(4096)

    // Must contain the module path header
    expect(msg).toContain('pages/amazon_scan.py')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Ollama fallback — when generate throws OllamaUnreachableError, Claude is called
// ─────────────────────────────────────────────────────────────────────────────

describe('purpose-review: Ollama fallback to Claude haiku', () => {
  it('calls Claude haiku API when Ollama throws OllamaUnreachableError', async () => {
    vi.mocked(generate).mockRejectedValueOnce(new OllamaUnreachableError('circuit open'))

    // Stub ANTHROPIC_API_KEY so the fallback path doesn't short-circuit
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-for-fallback')

    // Mock fetch for Claude API
    const claudeText = 'Use a dedicated Next.js API route with caching instead.'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: claudeText }],
        }),
      })
    )

    const { db } = makeDbMock()
    const msg = await generateModuleSummary('pages/amazon_scan.py', db as never)

    // (e) bullet must contain the Claude haiku response
    expect(msg).toContain('(e) Could instead:')
    expect(msg).toContain('Next.js API route')

    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Callback parse — approve/revise/skip extracted from callback_data
// ─────────────────────────────────────────────────────────────────────────────

describe('purpose-review: callback parse', () => {
  it('parses approve callback', () => {
    const result = parsePurposeReviewCallback(`purpose_review:approve:${VALID_UUID}`)
    expect(result).not.toBeNull()
    expect(result?.action).toBe('approve')
    expect(result?.taskQueueId).toBe(VALID_UUID)
  })

  it('parses revise callback', () => {
    const result = parsePurposeReviewCallback(`purpose_review:revise:${VALID_UUID}`)
    expect(result).not.toBeNull()
    expect(result?.action).toBe('revise')
    expect(result?.taskQueueId).toBe(VALID_UUID)
  })

  it('parses skip callback', () => {
    const result = parsePurposeReviewCallback(`purpose_review:skip:${VALID_UUID}`)
    expect(result).not.toBeNull()
    expect(result?.action).toBe('skip')
    expect(result?.taskQueueId).toBe(VALID_UUID)
  })

  it('returns null for unknown prefix', () => {
    expect(parsePurposeReviewCallback('tf:up:some-id')).toBeNull()
    expect(parsePurposeReviewCallback('')).toBeNull()
    expect(parsePurposeReviewCallback('purpose_review:badaction:' + VALID_UUID)).toBeNull()
  })

  it('returns null for invalid UUID', () => {
    expect(parsePurposeReviewCallback('purpose_review:approve:not-a-uuid')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: Revise flow — text reply stores purpose_notes, status=claimed, event logged
// ─────────────────────────────────────────────────────────────────────────────

describe('purpose-review: revise flow (text reply)', () => {
  it('stores purpose_notes, sets status=claimed, logs agent_event', async () => {
    const { db, insertMock, updateMock } = makeDbMock()

    // Stub fetch for editMessage
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

    await handlePurposeReviewTextReply({
      taskQueueId: VALID_UUID,
      text: 'Skip the Google Sheets dependency, use Supabase instead.',
      chatId: 123456,
      messageId: 789,
      originalText: '📋 Port Review — pages/amazon_scan.py',
      db: db as never,
    })

    // updateMock was called (for status=claimed + metadata update)
    // The chain is .update({...}).eq('id', taskQueueId)
    expect(updateMock).toHaveBeenCalledWith('id', VALID_UUID)

    // insertMock was called for agent_events
    expect(insertMock).toHaveBeenCalled()
    const eventCall = insertMock.mock.calls.find((c: unknown[]) => {
      const arg = c[0] as Record<string, unknown>
      return arg.action === 'purpose_review.approved_with_notes'
    })
    expect(eventCall).toBeDefined()
    const eventArg = eventCall![0] as Record<string, unknown>
    const eventMeta = eventArg.meta as Record<string, unknown>
    expect(eventMeta.purpose_notes).toBe('Skip the Google Sheets dependency, use Supabase instead.')

    // recordAttribution was called
    expect(recordAttribution).toHaveBeenCalledWith(
      expect.objectContaining({ actor_type: 'colin', actor_id: 'telegram' }),
      expect.objectContaining({ type: 'task_queue', id: VALID_UUID }),
      'purpose_reviewed',
      expect.objectContaining({ action: 'approved_with_notes' })
    )

    vi.unstubAllGlobals()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: Skip flow — task status=cancelled, agent_event logged
// ─────────────────────────────────────────────────────────────────────────────

describe('purpose-review: skip flow', () => {
  it('sets status=cancelled and logs agent_event with action=purpose_review.skipped', async () => {
    const { db, insertMock, updateMock } = makeDbMock()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

    await handlePurposeReviewCallback({
      action: 'skip',
      taskQueueId: VALID_UUID,
      chatId: 123456,
      messageId: 789,
      originalText: '📋 Port Review — pages/amazon_scan.py',
      db: db as never,
    })

    // updateMock called (chain is .update({...}).eq('id', taskQueueId))
    expect(updateMock).toHaveBeenCalledWith('id', VALID_UUID)

    // agent_events insert with action=purpose_review.skipped
    expect(insertMock).toHaveBeenCalled()
    const eventCall = insertMock.mock.calls.find((c: unknown[]) => {
      const arg = c[0] as Record<string, unknown>
      return arg.action === 'purpose_review.skipped'
    })
    expect(eventCall).toBeDefined()

    // recordAttribution called with actor_type='colin' and action='skip'
    const recordAttr = recordAttribution as ReturnType<typeof vi.fn>
    const attrCall = recordAttr.mock.calls.find((c: unknown[]) => {
      const ctx = c[0] as { actor_type: string }
      const details = c[3] as { action: string }
      return ctx.actor_type === 'colin' && details.action === 'skip'
    })
    expect(attrCall).toBeDefined()

    vi.unstubAllGlobals()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: Timeout — 73h old task gets status=review_timeout, alert fired
// ─────────────────────────────────────────────────────────────────────────────

describe('purpose-review: timeout checker', () => {
  it('sets status=review_timeout and fires Telegram alert for tasks 73h old', async () => {
    const alertFetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', alertFetchMock)
    vi.stubEnv('TELEGRAM_ALERTS_BOT_TOKEN', 'test-alerts-token')
    vi.stubEnv('TELEGRAM_CHAT_ID', '123456')

    const timedOutRows = [
      {
        id: VALID_UUID,
        metadata: {
          module_path: 'pages/expenses.py',
          classification: 'page',
          purpose_review: 'pending_notes',
        },
      },
    ]

    const { db, updateMock } = makeDbMock({ timedOutRows })

    const count = await checkPurposeReviewTimeouts(db as never)

    // Should have processed 1 row
    expect(count).toBe(1)

    // update was called on task_queue (chain is .update({...}).eq('id', taskQueueId))
    expect(updateMock).toHaveBeenCalledWith('id', VALID_UUID)

    // Telegram alert was fired
    const alertCall = alertFetchMock.mock.calls.find((c: unknown[]) => {
      const url = c[0] as string
      return typeof url === 'string' && url.includes('sendMessage')
    })
    expect(alertCall).toBeDefined()

    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('returns 0 when no timed-out rows exist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    const { db } = makeDbMock({ timedOutRows: [] })
    const count = await checkPurposeReviewTimeouts(db as never)
    expect(count).toBe(0)
    vi.unstubAllGlobals()
  })
})
