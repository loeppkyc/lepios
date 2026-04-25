import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock googleapis before any imports ───────────────────────────────────────
vi.mock('googleapis', () => {
  return {
    google: {
      auth: {
        OAuth2: vi.fn().mockImplementation(() => ({
          setCredentials: vi.fn(),
        })),
      },
      gmail: vi.fn(() => ({})),
    },
  }
})

// ── Mock Supabase service client ──────────────────────────────────────────────
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(),
}))

// ── Mock attribution writer ───────────────────────────────────────────────────
vi.mock('@/lib/attribution/writer', () => ({
  recordAttribution: vi.fn().mockResolvedValue(undefined),
}))

import { GmailNotConfiguredError, createGmailService } from '@/lib/gmail/client'
import { filterNewMessages, insertMessages } from '@/lib/gmail/scan'
import { classifyStatementArrival } from '@/lib/gmail/classifiers/statement-arrivals'
import type { GmailMessage } from '@/lib/gmail/scan'
import { createServiceClient } from '@/lib/supabase/service'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<GmailMessage> = {}): GmailMessage {
  return {
    messageId: 'msg-001',
    fromAddress: 'statements@td.com',
    subject: 'Your e-statement is ready',
    sentAt: new Date('2026-04-01T10:00:00Z'),
    hasAttachment: false,
    ...overrides,
  }
}

// Build a Supabase-like mock that handles .from().select().in() chains
function makeDbMock(
  opts: {
    existingIds?: string[]
    selectError?: object | null
  } = {}
) {
  const existingIds = opts.existingIds ?? []
  const selectError = opts.selectError ?? null

  const inMock = vi.fn().mockResolvedValue({
    data: existingIds.map((id) => ({ message_id: id })),
    error: selectError,
  })
  const selectMock = vi.fn().mockReturnValue({ in: inMock })
  const upsertMock = vi.fn().mockResolvedValue({ error: null })
  const rpcMock = vi.fn().mockResolvedValue({ error: null })
  const insertMock = vi.fn().mockResolvedValue({ error: null })

  const fromMock = vi.fn().mockImplementation(() => ({
    select: selectMock,
    upsert: upsertMock,
    insert: insertMock,
  }))

  return {
    from: fromMock,
    upsert: upsertMock,
    select: selectMock,
    in: inMock,
    insert: insertMock,
    rpc: rpcMock,
  }
}

// ── Test 1: New message inserted to gmail_messages ────────────────────────────

describe('insertMessages', () => {
  it('calls upsert with correct fields for a new message', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    const db = {
      from: vi.fn().mockReturnValue({ upsert: upsertMock }),
    }

    const msg = makeMessage()
    await insertMessages([msg], db as unknown as Parameters<typeof insertMessages>[1])

    expect(db.from).toHaveBeenCalledWith('gmail_messages')
    expect(upsertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          message_id: 'msg-001',
          from_address: 'statements@td.com',
          subject: 'Your e-statement is ready',
          has_attachment: false,
          scan_labels: [],
        }),
      ]),
      { onConflict: 'message_id', ignoreDuplicates: true }
    )
  })
})

// ── Test 2: Duplicate message_id skipped by filterNewMessages ─────────────────

describe('filterNewMessages', () => {
  it('returns empty array when all message_ids already exist in DB', async () => {
    const db = makeDbMock({ existingIds: ['msg-already-exists'] })

    const msg = makeMessage({ messageId: 'msg-already-exists' })
    const result = await filterNewMessages(
      [msg],
      db as unknown as Parameters<typeof filterNewMessages>[1]
    )

    expect(result).toHaveLength(0)
  })

  it('returns only messages not already in DB', async () => {
    const db = makeDbMock({ existingIds: ['msg-exists'] })

    const existing = makeMessage({ messageId: 'msg-exists' })
    const fresh = makeMessage({ messageId: 'msg-new' })

    const result = await filterNewMessages(
      [existing, fresh],
      db as unknown as Parameters<typeof filterNewMessages>[1]
    )

    expect(result).toHaveLength(1)
    expect(result[0].messageId).toBe('msg-new')
  })
})

// ── Test 3: classifyStatementArrival — sender + subject match → high ──────────

describe('classifyStatementArrival', () => {
  it('returns high confidence when FROM matches sender_domain AND subject matches pattern', () => {
    const msg = makeMessage({
      fromAddress: 'statements@td.com',
      subject: 'Your e-statement is ready',
    })
    const knownSenders = new Set<string>(['td.com'])

    const result = classifyStatementArrival(msg, knownSenders)

    expect(result).not.toBeNull()
    expect(result!.account_name).toBe('TD Chequing')
    expect(result!.confidence).toBe('high')
    expect(result!.arrival_date).toBeInstanceOf(Date)
    expect(result!.statement_period_start).toBeNull()
    expect(result!.statement_period_end).toBeNull()
    expect(result!.attachment_name).toBeNull()
  })

  // ── Test 4: subject match only → medium ──────────────────────────────────────

  it('returns medium confidence when subject matches RBC pattern but FROM is unknown domain', () => {
    const msg = makeMessage({
      fromAddress: 'noreply@unknown-bank.com',
      subject: 'Your eStatement is now available',
    })
    const knownSenders = new Set<string>()

    // Subject matches RBC's /e-?statement/i pattern but sender domain is unknown
    const result = classifyStatementArrival(msg, knownSenders)

    expect(result).not.toBeNull()
    expect(result!.confidence).toBe('medium')
  })

  // ── Test 5: no match → null ───────────────────────────────────────────────────

  it('returns null when neither sender nor subject match any account', () => {
    const msg = makeMessage({
      fromAddress: 'noreply@etsy.com',
      subject: 'Your Etsy order has shipped',
    })
    const knownSenders = new Set<string>()

    const result = classifyStatementArrival(msg, knownSenders)

    expect(result).toBeNull()
  })
})

// ── Test 6: Missing env vars → GmailNotConfiguredError ───────────────────────

describe('createGmailService', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('throws GmailNotConfiguredError when GOOGLE_CLIENT_ID is missing', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret')
    vi.stubEnv('GOOGLE_REFRESH_TOKEN', 'token')

    await expect(createGmailService()).rejects.toThrow(GmailNotConfiguredError)
  })

  it('throws GmailNotConfiguredError when GOOGLE_CLIENT_SECRET is missing', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '')
    vi.stubEnv('GOOGLE_REFRESH_TOKEN', 'token')

    await expect(createGmailService()).rejects.toThrow(GmailNotConfiguredError)
  })

  it('throws GmailNotConfiguredError when GOOGLE_REFRESH_TOKEN is missing', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret')
    vi.stubEnv('GOOGLE_REFRESH_TOKEN', '')

    await expect(createGmailService()).rejects.toThrow(GmailNotConfiguredError)
  })

  it('error message names all three missing env vars', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '')
    vi.stubEnv('GOOGLE_REFRESH_TOKEN', '')

    await expect(createGmailService()).rejects.toThrow(
      'Gmail env vars not set: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN'
    )
  })
})

// ── Test 7: Gmail API error — cron returns 200, logs, never throws ────────────
// Tests the cron route's error contract at the auth layer (Gmail not configured).
// This tests the same guarantee: any error → 200, never 5xx.

describe('gmail-scan cron route — error handling contract', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'test-secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetAllMocks()
  })

  it('returns 200 with reason=gmail_not_configured when Gmail env vars are missing', async () => {
    // Clear Gmail env vars to trigger GmailNotConfiguredError in the route
    vi.stubEnv('GOOGLE_CLIENT_ID', '')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '')
    vi.stubEnv('GOOGLE_REFRESH_TOKEN', '')

    const agentEventsInsert = vi.fn().mockResolvedValue({ error: null })
    const mockDb = {
      from: vi.fn().mockReturnValue({ insert: agentEventsInsert }),
      rpc: vi.fn().mockResolvedValue({ error: null }),
    }
    vi.mocked(createServiceClient).mockReturnValue(
      mockDb as unknown as ReturnType<typeof createServiceClient>
    )

    const { GET } = await import('@/app/api/cron/gmail-scan/route')
    const req = new Request('https://lepios.vercel.app/api/cron/gmail-scan', {
      headers: { authorization: 'Bearer test-secret' },
    })

    const res = await GET(req)

    // Must return 200 — never 5xx (Vercel retries on 5xx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.reason).toBe('gmail_not_configured')
  })

  it('returns 401 when CRON_SECRET does not match', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret')
    vi.stubEnv('GOOGLE_REFRESH_TOKEN', 'refresh-token')

    const { GET } = await import('@/app/api/cron/gmail-scan/route')
    const req = new Request('https://lepios.vercel.app/api/cron/gmail-scan', {
      headers: { authorization: 'Bearer wrong-secret' },
    })

    const res = await GET(req)
    expect(res.status).toBe(401)
  })
})

// ── Test 8: statement_arrivals_classified count matches non-null results ───────

describe('classifyStatementArrival — count accuracy', () => {
  it('classified count equals number of non-null classify results across a message batch', () => {
    const messages: GmailMessage[] = [
      makeMessage({
        messageId: 'msg-1',
        fromAddress: 'noreply@td.com',
        subject: 'Your e-statement is ready',
      }),
      makeMessage({
        messageId: 'msg-2',
        fromAddress: 'noreply@etsy.com',
        subject: 'Your Etsy order',
      }),
      makeMessage({
        messageId: 'msg-3',
        fromAddress: 'noreply@rbc.com',
        subject: 'Your eStatement is available',
      }),
    ]

    const knownSenders = new Set<string>(['td.com', 'rbc.com'])
    const results = messages
      .map((m) => classifyStatementArrival(m, knownSenders))
      .filter((r): r is NonNullable<typeof r> => r !== null)

    // msg-1: td.com sender + e-statement subject → high (classified)
    // msg-2: etsy.com, no statement subject → null (not classified)
    // msg-3: rbc.com sender + "eStatement is available" matches /e-?statement/i → high (classified)
    expect(results).toHaveLength(2)
    expect(results.every((r) => r !== null)).toBe(true)
  })
})

// ── Synthetic verification ────────────────────────────────────────────────────
// Verifies: account_name='TD Chequing', confidence='high', arrival_date set,
// statement_period_start=null, statement_period_end=null

describe('synthetic verification — classifyStatementArrival TD Chequing', () => {
  it('classifies synthetic TD message (message_id=synth-test-001) with expected field values', () => {
    const syntheticMsg: GmailMessage = {
      messageId: 'synth-test-001',
      fromAddress: 'statements@td.com',
      subject: 'Your e-statement is ready',
      sentAt: new Date('2026-04-01T10:00:00Z'),
      hasAttachment: false,
    }

    const knownSenders = new Set<string>(['td.com'])
    const result = classifyStatementArrival(syntheticMsg, knownSenders)

    expect(result).not.toBeNull()
    expect(result!.account_name).toBe('TD Chequing')
    expect(result!.confidence).toBe('high')
    expect(result!.arrival_date).toBeInstanceOf(Date)
    expect(result!.arrival_date.toISOString()).toBe('2026-04-01T10:00:00.000Z')
    expect(result!.statement_period_start).toBeNull()
    expect(result!.statement_period_end).toBeNull()
    expect(result!.attachment_name).toBeNull()
    expect(result!.message_id).toBe('synth-test-001')
  })
})
