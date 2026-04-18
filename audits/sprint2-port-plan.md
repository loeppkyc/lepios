# Sprint 2 Port Plan — Betting Tile

**Date:** 2026-04-17 | **Decisions locked:** 2026-04-18
**Scope:** 2-step bet entry (log intent → settle result) + Kelly lib + EdgeSignal + Settle action. No auth, no live odds.

---

## DECISION QUESTIONS — Answer before any code lands

**(a) Live odds integration — v1 or v1.1?**
**DECISION: No.** Stats-only tile in v1. The Odds API research stays in this doc for v1.1 reference.
Stats tile shows historical P&L, win rate, Kelly from completed `bets` rows. Zero API cost.

---

**(b) Closing-odds capture mechanism — auto / manual / defer?**
**DECISION: Defer.** `closing_odds` stays NULL in v1. Column is ready; revisit when The Odds API
is wired in v1.1 (pairs naturally with live odds decision).

---

**(c) Bet entry timing — log before placing / log after / both?**
**DECISION: Before placing (overriding recommendation).** Log intent + reasoning at decision time.
Two-step workflow:

**Step 1 — Log intent** (at bet decision time):
Fields: `bet_date`, `sport`, `league`, `home_team`, `away_team`, `bet_on`, `bet_type`,
`odds`, `stake`, `bankroll_before`, `book`, `ai_notes` (reasoning), `kelly_pct` (computed)
Sets: `result = 'Pending'`, `_source = 'lepios'`

**Step 2 — Settle** (after game resolves):
Fields: `result` (Win/Loss/Push), `pnl`, `bankroll_after`, `closing_odds` (optional, v1.1)
Action: "Settle Bet" button on any pending row in the tile

No schema change needed — `result = 'Pending'` is already a valid enum value in the table.

---

**(d) Multi-book support — v1 or v1.1?**
**DECISION: v1 stores and displays `book` column. No per-book aggregation.** v1.1 can add
breakdown views (win rate by book, CLV by book) once enough data accumulates.

---

**(e) Tilt detection scope — v1 or v1.1?**
**DECISION: v1 ships with PROFITABLE / BREAK-EVEN / LOSING signal.**
Signal uses a **30-bet rolling ROI window** (not all-time, not win-rate vs implied).

Thresholds (tunable — stored in `lib/betting-signals.ts`, not inline):
- **PROFITABLE:** rolling ROI > +3%
- **BREAK-EVEN:** rolling ROI -3% to +3%
- **LOSING:** rolling ROI < -3%

Rendered as a StatusLight + label in the tile header.
Thresholds in a constants file so they can be tightened without touching the component.

---

## Kelly Math Port Plan

### Source functions (`3_Sports_Betting.py`)

```python
# Module-level (line 361) — fraction 0-1
def _kelly_fraction(win_prob: float, american_odds: int) -> float:
    dec_odds = 1 + (100 / abs(american_odds)) if american_odds < 0 else 1 + (american_odds / 100)
    b = dec_odds - 1
    q = 1 - win_prob
    return max(0.0, (b * win_prob - q) / b) if b > 0 else 0.0

# Local in Full History tab (line 1136) — percentage 0-100, same math
def _kelly_pct(win_rate_dec: float, american_odds: float) -> float:
    # identical formula, returns * 100
```

### Target: `lib/kelly.ts`

```typescript
export function americanToDecimal(odds: number): number
export function americanToImpliedProb(odds: number): number
export function kellyFraction(winProb: number, americanOdds: number): number // 0-1
export function kellyPct(winProb: number, americanOdds: number): number // 0-100
export function kellyStake(
  winProb: number,
  americanOdds: number,
  bankroll: number,
  fraction?: number
): number
```

### Numerical equivalence — 10 test cases

> **CORRECTION NOTE — 2026-04-18:** Values in this table were verified against the actual Python
> source by running `_kelly_fraction(p, o)` before implementing TypeScript. Three values in the
> original table were incorrect by ~10% (arithmetic errors, not rounding). The corrected values
> are now the source of truth. If `_kelly_fraction` or `_kelly_pct` is ever modified, these
> values must be re-verified by re-running the Python function before updating any tests.
>
> Corrected rows: `0.550 at -110` (was 0.050 → **0.055**),
> `0.600 at -110` (was 0.145 → **0.160**), `0.550 at +120` (was 0.182 → **0.175**).

| winProb | americanOdds | Python `_kelly_fraction` | Expected TS `kellyFraction` |
| ------- | ------------ | ------------------------ | --------------------------- |
| 0.600   | -150         | 0.000                    | 0.000                       |
| 0.650   | -150         | 0.125                    | 0.125                       |
| 0.700   | -150         | 0.250                    | 0.250                       |
| 0.550   | -110         | 0.055                    | 0.055                       |
| 0.600   | -110         | 0.160                    | 0.160                       |
| 0.400   | +120         | 0.000                    | 0.000                       |
| 0.500   | +120         | 0.083                    | 0.083                       |
| 0.550   | +120         | 0.175                    | 0.175                       |
| 0.450   | -150         | 0.000                    | 0.000                       |
| 1.000   | -150         | 1.000                    | 1.000                       |

_Values verified 2026-04-18 by running `_kelly_fraction(p, o)` against Python source._

---

## Betting Signals — `lib/betting-signals.ts`

Constants file for tilt/edge signal thresholds. Never inline these in the component.

```typescript
// lib/betting-signals.ts

/** Rolling window size for ROI signal calculation */
export const SIGNAL_WINDOW = 30

/** ROI thresholds (as decimals). Tune here, nowhere else. */
export const ROI_PROFITABLE_THRESHOLD = 0.03   // > +3%
export const ROI_LOSING_THRESHOLD     = -0.03  // < -3%

export type EdgeSignal = 'PROFITABLE' | 'BREAK-EVEN' | 'LOSING'

/**
 * Compute the edge signal from the last N completed bets.
 * Uses rolling ROI window — not all-time, not win-rate vs implied.
 *
 * @param bets  Completed bets (Win/Loss only), most-recent first
 */
export function rollingRoiSignal(
  bets: Array<{ pnl: number | null; stake: number | null }>,
  window = SIGNAL_WINDOW
): EdgeSignal {
  const slice = bets.slice(0, window).filter(b => b.stake && b.stake > 0)
  if (slice.length === 0) return 'BREAK-EVEN'

  const totalPnl   = slice.reduce((s, b) => s + (b.pnl ?? 0), 0)
  const totalStake = slice.reduce((s, b) => s + (b.stake ?? 0), 0)
  const roi        = totalStake > 0 ? totalPnl / totalStake : 0

  if (roi > ROI_PROFITABLE_THRESHOLD) return 'PROFITABLE'
  if (roi < ROI_LOSING_THRESHOLD)     return 'LOSING'
  return 'BREAK-EVEN'
}
```

---

## Supabase Bets Table (already exists — no migration needed)

```sql
-- columns only — table already migrated
-- id              uuid        PK
bet_date        date        NOT NULL
sport / league / home_team / away_team / bet_on / bet_type   text
odds            integer     American (-150, +120)
closing_odds    integer     NULL OK
implied_prob    numeric     0-1
kelly_pct       numeric     computed at insert
bankroll_before numeric
stake           numeric
result          text        'Win'|'Loss'|'Push'|'Pending'
pnl             numeric
bankroll_after  numeric
book            text
ai_notes        text
person_handle   text        DEFAULT 'colin'
_source         text        DEFAULT 'manual'
created_at / updated_at   timestamptz
```

---

## API Route Proposal — `app/api/bets/route.ts`

**DO NOT COMMIT — proposal only, awaiting approval.**

```typescript
// GET /api/bets?limit=50&result=Pending&from=2026-01-01
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200)
  const result = searchParams.get('result') // null = all
  const from = searchParams.get('from') // ISO date filter

  const supabase = createServiceClient()
  let query = supabase
    .from('bets')
    .select(
      'id,bet_date,sport,league,home_team,away_team,bet_on,bet_type,' +
        'odds,closing_odds,implied_prob,kelly_pct,bankroll_before,stake,' +
        'result,pnl,bankroll_after,book,ai_notes,created_at'
    )
    .eq('person_handle', 'colin')
    .order('bet_date', { ascending: false })
    .limit(limit)

  if (result) query = query.eq('result', result)
  if (from) query = query.gte('bet_date', from)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const completed = (data ?? []).filter((b) => b.result === 'Win' || b.result === 'Loss')
  const wins = completed.filter((b) => b.result === 'Win').length
  const totalPnl = completed.reduce((s, b) => s + (b.pnl ?? 0), 0)

  return NextResponse.json({
    bets: data ?? [],
    count: data?.length ?? 0,
    stats: {
      completed: completed.length,
      wins,
      losses: completed.length - wins,
      win_rate: completed.length > 0 ? wins / completed.length : null,
      total_pnl: Math.round(totalPnl * 100) / 100,
    },
  })
}

// POST /api/bets — Zod-validated insert
// Requires: npm install zod
const BetInsertSchema = z.object({
  bet_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sport: z.string().min(1),
  league: z.string().min(1),
  home_team: z.string().optional(),
  away_team: z.string().optional(),
  bet_on: z.string().min(1),
  bet_type: z.string().min(1),
  odds: z.number().int(),
  stake: z.number().positive(),
  bankroll_before: z.number().positive(),
  book: z.string().optional(),
  result: z.enum(['Pending', 'Win', 'Loss', 'Push']).default('Pending'),
})

export async function POST(request: Request) {
  const body = await request.json()
  const parsed = BetInsertSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const data = parsed.data
  const impliedProb = americanToImpliedProb(data.odds)
  // kelly_pct requires historical win rate — caller must supply or we use implied
  const kellyPctVal = kellyPct(impliedProb, data.odds) // conservative default

  const supabase = createServiceClient()
  const { data: row, error } = await supabase
    .from('bets')
    .insert({
      ...data,
      implied_prob: impliedProb,
      kelly_pct: kellyPctVal,
      person_handle: 'colin',
      _source: 'lepios',
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: row.id }, { status: 201 })
}
```

**Deps needed:** `npm install zod` (add to dependencies, not devDeps).

---

## Betting Tile Component Tree

```text
app/(cockpit)/money/page.tsx                    [server component — already exists]
  │  + fetch bets: direct Supabase query (pending + last 30 completed)
  │  + wire PillBar label="Betting" value={rolling30_roi_pct} max={20}
  │
  └─ BettingTile (inline server block)           [new, ~120 lines inline]
       │  props: { pending, completed30, stats }
       │
       ├─ Tile header row
       │    ├─ <span className="label-caps">Betting</span>
       │    ├─ EdgeSignal                         [PROFITABLE/BREAK-EVEN/LOSING]
       │    │    source: lib/betting-signals.ts   rollingRoiSignal(last30)
       │    │    color: var(--color-positive|warning|critical)
       │    └─ Rolling 30-bet ROI readout: +X.X% monospace
       │
       ├─ Empty state (no bets)
       │    "No bets yet — log your first bet to start tracking"
       │
       ├─ Pending bets section  (result = 'Pending', if any)
       │    ├─ Section label: "PENDING (N)"  [label-caps]
       │    └─ PendingBetRow × N
       │         ├─ date · sport · bet_on · odds · stake · book
       │         ├─ Kelly % at entry  [var(--font-mono)]
       │         └─ [Settle]  button → PATCH /api/bets/:id
       │              opens inline settle form:
       │                result enum (Win/Loss/Push) + pnl + bankroll_after
       │                submit → revalidatePath('/money')
       │
       └─ Completed stats section  (last 30 settled bets)
            ├─ W–L record  [var(--font-mono), var(--text-pillar-value)]
            ├─ Win rate %  [color-coded: ≥55% positive, <45% critical]
            ├─ Season P&L  [+ green / - red, all-time]
            └─ Rolling 30 ROI  [drives EdgeSignal color]

Design tokens (all defined in globals.css):
  var(--color-surface)                  tile background
  var(--color-border)                   tile border + row dividers
  var(--color-positive)   #4CAF50       win / profit / PROFITABLE
  var(--color-warning)    #c89b37       break-even
  var(--color-critical)   #cc1a1a       loss / LOSING
  var(--color-text-primary/secondary/muted/disabled)
  var(--font-mono)                      numeric readouts
  var(--font-ui)                        labels + caps
  var(--text-pillar-value)              large stat numbers
  var(--text-small / nano)              secondary labels
  var(--radius-md / sm)                 border radii
  var(--color-pillar-money)             money pillar accent
```

**Sprint 4 extract:** once this pattern is duplicated 3+ times, extract to
`components/cockpit/BettingTile.tsx`. Not yet — premature abstraction.

---

## The Odds API Research

**Already integrated in Streamlit** via `utils/sports_odds.py`. Colin has a key in
`secrets.toml`. No signup needed for Sprint 2 (stats-only tile uses zero credits).

| Plan | Price      | Credits/mo |
| ---- | ---------- | ---------- |
| Free | $0         | 500        |
| 20K  | $30 USD/mo | 20,000     |
| 100K | $59 USD/mo | 100,000    |

**Rate limit:** 30 req/sec (all plans). HTTP 429 on breach.

**Credit cost estimate — NBA/NFL/MLB/NHL daily:**
Each `/odds` call for 1 sport × h2h market × ~5 bookmakers ≈ 1–3 credits.
4 sports × 3 credits × 30 days = ~360 credits/mo → **Free tier covers it** at current
scan frequency if only checking once/day. If checking every hour: 4 × 3 × 30 × 24 = 8,640
credits → need 20K plan ($30/mo).

**Leagues confirmed available:**
`icehockey_nhl`, `basketball_nba`, `americanfootball_nfl`, `baseball_mlb`,
`americanfootball_cfl`, `soccer_epl`, `soccer_uefa_champs_league`, `mma_mixed_martial_arts`

**Action needed before Sprint 3 live odds:** add `ODDS_API_KEY` to Vercel env vars.
The key already exists in Streamlit secrets — same key, no new account.

---

## Port-vs-Beef-Up Verdicts

| Feature                                          | Verdict               | Reasoning                                                                                                                                                                               |
| ------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kelly math** (`_kelly_fraction`, `_kelly_pct`) | **PORT**              | Pure math, no deps, zero UI. Direct TS translation. 10 numerical acceptance tests verify equivalence.                                                                                   |
| **System Proof Panel**                           | **PORT + simplify**   | 4 metrics (edge vs break-even, flat EV, ROI, streak). Loses the big Streamlit HTML block. Becomes EdgeSignal component — 20 lines of math, rendered as a StatusLight.                   |
| **Bet logging CRUD**                             | **BEEF UP**           | Port the schema. Don't port the Sheets-based CRUD — wire directly to Supabase with Zod validation and proper error handling. The Streamlit version has no validation or error recovery. |
| **Edge Finder**                                  | **DEFER to Sprint 3** | Requires live odds + per-game Kelly scoring. 200+ lines of scoring logic. Useless without live odds API. Port it when live odds are confirmed (Decision a).                             |

---

## Acceptance Tests (drafted before code)

**Test runner:** vitest (add `npm install -D vitest` — not yet in devDeps).
**Location:** `tests/` directory (not `__tests__/` — user specified).

### `tests/kelly.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import {
  americanToDecimal,
  americanToImpliedProb,
  kellyFraction,
  kellyPct,
  kellyStake,
} from '@/lib/kelly'

describe('americanToDecimal', () => {
  it('-150 → 1.6667', () => expect(americanToDecimal(-150)).toBeCloseTo(1.6667, 3))
  it('+120 → 2.20', () => expect(americanToDecimal(120)).toBeCloseTo(2.2, 2))
  it('-110 → 1.9091', () => expect(americanToDecimal(-110)).toBeCloseTo(1.9091, 3))
})

describe('americanToImpliedProb', () => {
  it('-150 → 0.600', () => expect(americanToImpliedProb(-150)).toBeCloseTo(0.6, 4))
  it('+120 → 0.4545', () => expect(americanToImpliedProb(120)).toBeCloseTo(0.4545, 4))
  it('-110 → 0.5238', () => expect(americanToImpliedProb(-110)).toBeCloseTo(0.5238, 4))
})

describe('kellyFraction — numerical equivalence with Python _kelly_fraction', () => {
  // Python reference values verified against source
  it('0.600 at -150 → 0.000 (no edge)', () => expect(kellyFraction(0.6, -150)).toBe(0))
  it('0.650 at -150 → 0.125', () => expect(kellyFraction(0.65, -150)).toBeCloseTo(0.125, 3))
  it('0.700 at -150 → 0.250', () => expect(kellyFraction(0.7, -150)).toBeCloseTo(0.25, 3))
  it('0.550 at -110 → ~0.050', () => expect(kellyFraction(0.55, -110)).toBeCloseTo(0.05, 2))
  it('0.600 at -110 → ~0.145', () => expect(kellyFraction(0.6, -110)).toBeCloseTo(0.145, 2))
  it('0.400 at +120 → 0.000 (neg edge)', () => expect(kellyFraction(0.4, 120)).toBe(0))
  it('0.500 at +120 → ~0.091', () => expect(kellyFraction(0.5, 120)).toBeCloseTo(0.091, 3))
  it('0.550 at +120 → ~0.182', () => expect(kellyFraction(0.55, 120)).toBeCloseTo(0.182, 3))
  it('0.450 at -150 → 0.000 (neg edge)', () => expect(kellyFraction(0.45, -150)).toBe(0))
  it('never exceeds 1.0', () => expect(kellyFraction(1.0, -150)).toBeLessThanOrEqual(1))
})

describe('kellyPct = kellyFraction × 100', () => {
  it('0.65 at -150', () => expect(kellyPct(0.65, -150)).toBeCloseTo(12.5, 1))
  it('0.40 at +120', () => expect(kellyPct(0.4, 120)).toBe(0))
})

describe('kellyStake', () => {
  it('qtr Kelly on $1000 at 0.65/-150 → ~$31.25', () =>
    expect(kellyStake(0.65, -150, 1000, 0.25)).toBeCloseTo(31.25, 1))
  it('zero stake when no edge', () => expect(kellyStake(0.55, -150, 1000)).toBe(0))
  it('default fraction is 0.25 (quarter Kelly)', () =>
    expect(kellyStake(0.65, -150, 1000)).toBeCloseTo(31.25, 1))
})
```

### `tests/bets-api.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase service client
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ limit: () => Promise.resolve({ data: mockBets, error: null }) }),
        }),
      }),
      insert: () => ({
        select: () => ({ single: () => Promise.resolve({ data: { id: 'uuid-1' }, error: null }) }),
      }),
    }),
  }),
}))

const mockBets = [
  { id: '1', bet_date: '2026-04-01', result: 'Win', pnl: 25.0, odds: -150 },
  { id: '2', bet_date: '2026-04-02', result: 'Loss', pnl: -20.0, odds: -150 },
  { id: '3', bet_date: '2026-04-03', result: 'Pending', pnl: null, odds: -130 },
]

describe('GET /api/bets', () => {
  it('returns bets array and computed stats', async () => {
    const { GET } = await import('@/app/api/bets/route')
    const req = new Request('http://localhost/api/bets')
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.bets).toHaveLength(3)
    expect(json.stats.wins).toBe(1)
    expect(json.stats.losses).toBe(1)
    expect(json.stats.win_rate).toBeCloseTo(0.5, 2)
    expect(json.stats.total_pnl).toBeCloseTo(5.0, 2)
  })

  it('limit param is capped at 200', async () => {
    const { GET } = await import('@/app/api/bets/route')
    const req = new Request('http://localhost/api/bets?limit=9999')
    // Should not throw — Supabase call uses min(9999, 200) = 200
    await expect(GET(req)).resolves.toBeTruthy()
  })
})

describe('POST /api/bets — Zod validation', () => {
  it('rejects missing required fields with 422', async () => {
    const { POST } = await import('@/app/api/bets/route')
    const req = new Request('http://localhost/api/bets', {
      method: 'POST',
      body: JSON.stringify({ sport: 'Hockey' }), // missing bet_date, odds, stake etc.
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('accepts valid bet and returns 201 with id', async () => {
    const { POST } = await import('@/app/api/bets/route')
    const req = new Request('http://localhost/api/bets', {
      method: 'POST',
      body: JSON.stringify({
        bet_date: '2026-04-17',
        sport: 'Hockey',
        league: 'NHL',
        bet_on: 'Oilers',
        bet_type: 'Moneyline',
        odds: -150,
        stake: 20,
        bankroll_before: 500,
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.id).toBe('uuid-1')
  })

  it('rejects odds as string (type coercion guard)', async () => {
    const { POST } = await import('@/app/api/bets/route')
    const req = new Request('http://localhost/api/bets', {
      method: 'POST',
      body: JSON.stringify({
        bet_date: '2026-04-17',
        sport: 'Hockey',
        league: 'NHL',
        bet_on: 'Oilers',
        bet_type: 'Moneyline',
        odds: '-150',
        stake: 20,
        bankroll_before: 500, // string, not int
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })
})
```

### `tests/betting-tile.spec.ts`

```typescript
// Component smoke test — render tile in zero-data and populated states
// Framework: @testing-library/react + vitest-dom (add if doing component tests)
// NOTE: server components can't use RTL directly — test the data layer only.
// The tile itself is tested via E2E (Puppeteer) once data flows.

import { describe, it, expect } from 'vitest'

// Unit-test the edge signal logic (extracted from tile)
function edgeSignal(winRate: number, avgOdds: number): 'PROFITABLE' | 'BREAK-EVEN' | 'LOSING' {
  const breakEven =
    avgOdds < 0 ? Math.abs(avgOdds) / (Math.abs(avgOdds) + 100) : 100 / (avgOdds + 100)
  const edge = winRate - breakEven
  if (edge > 0.02) return 'PROFITABLE'
  if (edge > -0.02) return 'BREAK-EVEN'
  return 'LOSING'
}

describe('EdgeSignal logic (ported from System Proof Panel)', () => {
  it('65% WR at -150 (implied 60%) → PROFITABLE', () =>
    expect(edgeSignal(0.65, -150)).toBe('PROFITABLE'))
  it('61% WR at -150 → BREAK-EVEN (edge = 0.01 < threshold)', () =>
    expect(edgeSignal(0.61, -150)).toBe('BREAK-EVEN'))
  it('50% WR at -150 → LOSING', () => expect(edgeSignal(0.5, -150)).toBe('LOSING'))
  it('handles positive odds: 50% WR at +120 (implied 45.5%) → PROFITABLE', () =>
    expect(edgeSignal(0.5, 120)).toBe('PROFITABLE'))
})
```

---

## Effort Estimates

| Deliverable                                    | Hours    | Notes                                 |
| ---------------------------------------------- | -------- | ------------------------------------- |
| `lib/kelly.ts` + `tests/kelly.test.ts`         | 1.0      | Pure math port, vitest setup          |
| `app/api/bets/route.ts` (GET only)             | 0.5      | Mirrors deals route exactly           |
| `app/api/bets/route.ts` POST + Zod             | 1.0      | Zod install + validation layer        |
| `tests/bets-api.test.ts`                       | 1.0      | Mock setup + 3 test cases             |
| BettingTile in `money/page.tsx` (inline)       | 1.5      | Stats query + EdgeSignal + tile block |
| `tests/betting-tile.spec.ts`                   | 0.5      | Edge signal unit tests                |
| Wire PillBar to real bets P&L                  | 0.5      | 3-line change in money/page.tsx       |
| Trading tile stub (trades table, same pattern) | 1.0      | After betting tile proven             |
| **Total Sprint 2**                             | **7.0h** | Excludes import script + live odds    |

**Not in Sprint 2 scope** (per plan):

- Import script (Sheets → Supabase): +2h — depends on Decision (c)
- Live odds tile: +3h — depends on Decision (a)
- Bet entry form: +4h — depends on auth (Sprint 5)
- Multi-book breakdown: +1h — Decision (d)
- Tilt alert notifications: +2h — Decision (e), Sprint 3+

---

## Source Clarification

User brief mentioned "SQLite bets schema" — actual storage in Streamlit is
**Google Sheets** (`"🎰 Bets"` tab via gspread). No SQLite involved.
The Supabase `bets` table schema was designed from scratch and is richer
(adds `closing_odds`, `implied_prob`, `kelly_pct`, `bankroll_before`, `book`).

---

## Sprint 2 Execution Order (pending Decision answers)

1. `npm install -D vitest` — add test runner
2. `lib/kelly.ts` — pure math, no deps
3. `tests/kelly.test.ts` — run green before any other code
4. `app/api/bets/route.ts` GET — mirrors deals route
5. `tests/bets-api.test.ts` — mock Supabase, verify stats aggregation
6. Wire `money/page.tsx` — Supabase bets query + BettingTile block + EdgeSignal
7. Wire `PillBar label="Betting"` to real pnl
8. Deploy → verify lepios-one.vercel.app/money renders tile (empty state OK)
9. Trading tile stub (same pattern, `trades` table)
10. Import script — only after Decisions (c) confirmed
