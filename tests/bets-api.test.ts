/**
 * Acceptance tests for POST /api/bets and GET /api/bets.
 *
 * Mocks @/lib/supabase/server so next/headers is never imported in the
 * test environment. The mock exposes getUser() and from() as vi.fn()s that
 * each test configures independently.
 *
 * RLS enforcement (row-level security) is NOT unit-testable — it requires
 * a real Supabase connection. See the "Manual verification" note at the bottom.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase server client ───────────────────────────────────────────────
// vi.mock() is hoisted to top of file before const declarations.
// vi.hoisted() ensures these fns are initialised before the factory runs.

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}))

// ── Route import (after mock declaration) ────────────────────────────────────

import { GET, POST } from '@/app/api/bets/route'

// ── Shared fixtures ───────────────────────────────────────────────────────────

const mockUser = { id: 'user-123', email: 'colin@example.com' }

const mockBets = [
  {
    id: 'bet-1',
    bet_date: '2026-04-01',
    sport: 'Hockey',
    league: 'NHL',
    bet_on: 'Oilers',
    bet_type: 'moneyline',
    odds: -150,
    stake: 25,
    bankroll_before: 500,
    result: 'win',
    pnl: 16.67,
    created_at: '2026-04-01T20:00:00Z',
    updated_at: '2026-04-01T20:00:00Z',
  },
  {
    id: 'bet-2',
    bet_date: '2026-04-02',
    sport: 'Basketball',
    league: 'NBA',
    bet_on: 'Raptors',
    bet_type: 'spread',
    odds: -110,
    stake: 20,
    bankroll_before: 516.67,
    result: 'loss',
    pnl: -20,
    created_at: '2026-04-02T19:00:00Z',
    updated_at: '2026-04-02T19:00:00Z',
  },
]

const mockInsertedBet = {
  id: 'bet-new',
  bet_date: '2026-04-18',
  sport: 'Hockey',
  league: 'NHL',
  bet_on: 'Oilers',
  bet_type: 'moneyline',
  odds: -150,
  stake: 25,
  bankroll_before: 500,
  implied_prob: 0.6,
  kelly_pct: 12.5,
  result: 'pending',
  pnl: null,
  person_handle: 'colin',
  _source: 'lepios',
  created_at: '2026-04-18T12:00:00Z',
  updated_at: '2026-04-18T12:00:00Z',
}

const validBetPayload = {
  bet_date: '2026-04-18',
  sport: 'Hockey',
  league: 'NHL',
  bet_on: 'Oilers',
  bet_type: 'moneyline',
  odds: -150,
  stake: 25,
  bankroll_before: 500,
}

// ── Mock builder factories ────────────────────────────────────────────────────

function makeGetBuilder(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  }
}

function makePostBuilder(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result)
  const selectAfterInsert = vi.fn().mockReturnValue({ single })
  const insertFn = vi.fn().mockReturnValue({ select: selectAfterInsert })
  return { insert: insertFn, _single: single, _selectAfterInsert: selectAfterInsert }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null })
})

// ── Auth: unauthenticated → 401 ───────────────────────────────────────────────

describe('unauthenticated requests → 401', () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
  })

  it('GET without session returns 401', async () => {
    const res = await GET(new Request('http://localhost/api/bets'))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBeDefined()
  })

  it('POST without session returns 401', async () => {
    const res = await POST(
      new Request('http://localhost/api/bets', {
        method: 'POST',
        body: JSON.stringify(validBetPayload),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBeDefined()
  })
})

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/bets', () => {
  it('returns bets array and count for authenticated user', async () => {
    mockFrom.mockReturnValue(makeGetBuilder({ data: mockBets, error: null }))

    const res = await GET(new Request('http://localhost/api/bets'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.bets).toHaveLength(2)
    expect(json.count).toBe(2)
    expect(json.bets[0].id).toBe('bet-1')
  })

  it('returns empty array when no bets exist', async () => {
    mockFrom.mockReturnValue(makeGetBuilder({ data: [], error: null }))

    const res = await GET(new Request('http://localhost/api/bets'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.bets).toHaveLength(0)
    expect(json.count).toBe(0)
  })

  it('applies from/to date range filters (calls gte and lte)', async () => {
    const builder = makeGetBuilder({ data: mockBets, error: null })
    mockFrom.mockReturnValue(builder)

    await GET(new Request('http://localhost/api/bets?from=2026-01-01&to=2026-04-18'))

    expect(builder.gte).toHaveBeenCalledWith('bet_date', '2026-01-01')
    expect(builder.lte).toHaveBeenCalledWith('bet_date', '2026-04-18')
  })

  it('from-only filter: calls gte, does not call lte', async () => {
    const builder = makeGetBuilder({ data: mockBets, error: null })
    mockFrom.mockReturnValue(builder)

    await GET(new Request('http://localhost/api/bets?from=2026-01-01'))

    expect(builder.gte).toHaveBeenCalledWith('bet_date', '2026-01-01')
    expect(builder.lte).not.toHaveBeenCalled()
  })

  it('invalid from date format returns 400', async () => {
    const res = await GET(new Request('http://localhost/api/bets?from=April-18'))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeDefined()
  })

  it('invalid to date format returns 400', async () => {
    const res = await GET(new Request('http://localhost/api/bets?to=2026/04/18'))
    expect(res.status).toBe(400)
  })

  it('limit is capped at 200', async () => {
    const builder = makeGetBuilder({ data: [], error: null })
    mockFrom.mockReturnValue(builder)

    await GET(new Request('http://localhost/api/bets?limit=9999'))
    expect(builder.limit).toHaveBeenCalledWith(200)
  })
})

// ── POST — Zod validation ─────────────────────────────────────────────────────

describe('POST /api/bets — Zod validation', () => {
  it('missing bet_date returns 400', async () => {
    const { bet_date: _, ...noDate } = validBetPayload
    const res = await POST(
      new Request('http://localhost/api/bets', {
        method: 'POST',
        body: JSON.stringify(noDate),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.issues).toBeDefined()
  })

  it('missing odds returns 400', async () => {
    const { odds: _, ...noOdds } = validBetPayload
    const res = await POST(
      new Request('http://localhost/api/bets', {
        method: 'POST',
        body: JSON.stringify(noOdds),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('invalid bet_date format returns 400', async () => {
    const res = await POST(
      new Request('http://localhost/api/bets', {
        method: 'POST',
        body: JSON.stringify({ ...validBetPayload, bet_date: '18/04/2026' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('invalid bet_type enum returns 400', async () => {
    const res = await POST(
      new Request('http://localhost/api/bets', {
        method: 'POST',
        body: JSON.stringify({ ...validBetPayload, bet_type: 'Moneyline' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('invalid result enum returns 400', async () => {
    const res = await POST(
      new Request('http://localhost/api/bets', {
        method: 'POST',
        body: JSON.stringify({ ...validBetPayload, result: 'Win' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('odds as string (type coercion guard) returns 400', async () => {
    const res = await POST(
      new Request('http://localhost/api/bets', {
        method: 'POST',
        body: JSON.stringify({ ...validBetPayload, odds: '-150' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
  })
})

// ── POST — success path ───────────────────────────────────────────────────────

describe('POST /api/bets — success path', () => {
  it('valid payload inserts bet and returns 201 with created row', async () => {
    const builder = makePostBuilder({ data: mockInsertedBet, error: null })
    mockFrom.mockReturnValue(builder)

    const res = await POST(
      new Request('http://localhost/api/bets', {
        method: 'POST',
        body: JSON.stringify(validBetPayload),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.bet).toBeDefined()
    expect(json.bet.id).toBe('bet-new')
    expect(json.bet.created_at).toBeDefined()
  })

  it('result defaults to "pending" when not provided', async () => {
    const builder = makePostBuilder({ data: { ...mockInsertedBet, result: 'pending' }, error: null })
    mockFrom.mockReturnValue(builder)

    const noResult = validBetPayload // validBetPayload has no result field
    const res = await POST(
      new Request('http://localhost/api/bets', {
        method: 'POST',
        body: JSON.stringify(noResult),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(res.status).toBe(201)

    // Verify the insert was called with result='pending'
    const insertedPayload = builder.insert.mock.calls[0][0]
    expect(insertedPayload.result).toBe('pending')
  })

  it('person_handle is always "colin" — not accepted from request body', async () => {
    const builder = makePostBuilder({ data: mockInsertedBet, error: null })
    mockFrom.mockReturnValue(builder)

    // Attempt to inject a different person_handle
    const res = await POST(
      new Request('http://localhost/api/bets', {
        method: 'POST',
        body: JSON.stringify({ ...validBetPayload, person_handle: 'other_user' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(res.status).toBe(201)

    const insertedPayload = builder.insert.mock.calls[0][0]
    expect(insertedPayload.person_handle).toBe('colin')
  })

  it('_source is set to "lepios" — not accepted from request body', async () => {
    const builder = makePostBuilder({ data: mockInsertedBet, error: null })
    mockFrom.mockReturnValue(builder)

    await POST(
      new Request('http://localhost/api/bets', {
        method: 'POST',
        body: JSON.stringify(validBetPayload),
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const insertedPayload = builder.insert.mock.calls[0][0]
    expect(insertedPayload._source).toBe('lepios')
  })

  it('implied_prob and kelly_pct are computed server-side and inserted', async () => {
    const builder = makePostBuilder({ data: mockInsertedBet, error: null })
    mockFrom.mockReturnValue(builder)

    await POST(
      new Request('http://localhost/api/bets', {
        method: 'POST',
        body: JSON.stringify(validBetPayload), // odds: -150
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const insertedPayload = builder.insert.mock.calls[0][0]
    // -150 → implied_prob = 0.6000
    expect(insertedPayload.implied_prob).toBeCloseTo(0.6, 4)
    // kelly_pct at implied_prob≈0.6 / odds=-150 ≈ 0% (no edge); float noise ~1e-14
    expect(insertedPayload.kelly_pct).toBeCloseTo(0, 8)
  })
})

/*
 * Manual verification required in Supabase before Chunk 3:
 *
 * 1. RLS policy on bets table: confirm that the anon key client (server.ts)
 *    can only SELECT/INSERT rows where person_handle matches the session user.
 *    Test: log in as colin, attempt to read rows with person_handle='other' — should return 0 rows.
 *
 * 2. person_handle mapping: currently hardcoded to 'colin'. Sprint 5 will replace
 *    this with a user_id → person_handle lookup. Before Sprint 5, confirm that
 *    the only Supabase user is colin's account and that bets written via this
 *    route always get person_handle='colin'.
 *
 * 3. RLS INSERT policy: confirm that insert is blocked if person_handle does not
 *    match the session user (DB-level enforcement even if route strips the field).
 */
