# Acceptance Doc — AI Pick Engine Chunk B: Trading Pick Engine

**Sibling:** `ai-pick-engine-overview.md` (read first)
**Depends on:** Chunk A (schema must be live).
**Parallel-safe with:** Chunk C (independent files).
**Builder window estimate:** 3–4 hours (one session, may need a second for tests).

---

## What ships

1. Daily cron at 7am MT (`/api/cron/trading-picks-scan`) that:
   - Pulls market data via yfinance equivalent for ~14 instruments
   - Runs the 5-factor scoring engine (port from Streamlit)
   - Writes top picks to `predictions` table
   - Dispatches Telegram via `outbound_notifications`
2. Weekly cron Sunday night (`/api/cron/trading-weights-tune`) that:
   - Reads last 20 closed trades
   - Calls Claude to propose new weight values
   - Writes new row to `prediction_weights`, flips `is_active`
3. `/trading` page showing today's picks + last 30 days history.
4. `/api/predictions/[id]/resolve` to close out a prediction with actual outcome.
5. Library code: `lib/trading/scanner.ts`, `lib/trading/scoring.ts`, `lib/trading/market-data.ts`, `lib/trading/learn.ts`.

---

## Builder pre-flight

```bash
# Confirm chunk A landed
psql -c "SELECT count(*) FROM predictions WHERE domain='trading';"
psql -c "SELECT * FROM prediction_weights WHERE domain='trading' AND is_active=true;"

# Confirm cron-secret helper exists
test -f lib/auth/cron-secret.ts && echo OK

# Confirm outbound_notifications drain works
curl -X POST $LEPIOS_URL/api/harness/notifications-drain \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

## Streamlit reference (port these files)

| Streamlit                                            | LepiOS                                                                |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| `tools/trading_predictions.py`                       | `lib/trading/scanner.ts` + `app/api/cron/trading-picks-scan/route.ts` |
| `utils/market_data.py` (yfinance)                    | `lib/trading/market-data.ts`                                          |
| `tools/trading_predictions.py` `analyze_and_learn()` | `lib/trading/learn.ts` + `app/api/cron/trading-weights-tune/route.ts` |
| Sheet: `Trading_Predictions`                         | `predictions` table (chunk A)                                         |
| Sheet: `Trading_Predictions_Learning`                | `prediction_weights` table (chunk A)                                  |

---

## Instrument list (port from Streamlit verbatim)

```typescript
// lib/trading/instruments.ts
export const INSTRUMENTS = [
  // Futures (Streamlit MES/M2K group)
  { ticker: 'ES=F', name: 'S&P 500', type: 'future', pointValue: 50 },
  { ticker: 'NQ=F', name: 'Nasdaq 100', type: 'future', pointValue: 20 },
  { ticker: 'RTY=F', name: 'Russell 2000', type: 'future', pointValue: 50 },
  { ticker: 'GC=F', name: 'Gold', type: 'commodity', pointValue: 100 },
  { ticker: 'CL=F', name: 'Crude Oil', type: 'commodity', pointValue: 1000 },
  { ticker: 'SI=F', name: 'Silver', type: 'commodity', pointValue: 5000 },
  // Equities
  { ticker: 'TSLA', name: 'Tesla', type: 'stock', pointValue: 1 },
  { ticker: 'NVDA', name: 'Nvidia', type: 'stock', pointValue: 1 },
  { ticker: 'AAPL', name: 'Apple', type: 'stock', pointValue: 1 },
  { ticker: 'AMZN', name: 'Amazon', type: 'stock', pointValue: 1 },
  { ticker: 'MSFT', name: 'Microsoft', type: 'stock', pointValue: 1 },
  { ticker: 'META', name: 'Meta', type: 'stock', pointValue: 1 },
  { ticker: 'AMD', name: 'AMD', type: 'stock', pointValue: 1 },
  { ticker: 'GOOG', name: 'Google', type: 'stock', pointValue: 1 },
] as const
```

Note: Streamlit's MES/M2K (micro futures) replaced with full ES/RTY here for data availability — Colin still trades the micros, but signals are equivalent. Confirm or override.

---

## Market data layer

`lib/trading/market-data.ts`:

- Use `yahoo-finance2` npm package (active fork of yfinance for Node)
- Functions to port from Streamlit `utils/market_data.py`:
  - `getDailySnapshot(tickers: string[])` — latest OHLCV (5-min cache)
  - `getOHLCV(ticker: string, days: number)` — daily bars (10-min cache)
  - `getATR(ticker: string, period: number = 14)` — Average True Range
  - `getRSI(ticker: string, period: number = 14)` — Relative Strength Index
  - `getMA(ticker: string, period: number)` — moving average for trend signal
- Cache via `lib/cache/index.ts` (existing) or simple in-memory Map keyed by `ticker:fn:date`.
- Error handling: if yfinance fails for a ticker, log to `agent_events` and skip — don't crash the whole scan.

---

## Scoring engine (5 factors, port verbatim)

`lib/trading/scoring.ts`:

```typescript
import type { OhlcvBar } from './market-data'
import type { TradingWeights } from './weights'

export type FactorScores = {
  trend: number // 0-3 raw, MA alignment
  rsi: number // 0-2 raw, RSI 30-70 confirmation
  volume: number // 0-2 raw, volume vs average
  momentum: number // 0-2 raw, 5-day price momentum
  level: number // 0-2 raw, distance from key support/resistance
}

export type ScoredPick = {
  ticker: string
  direction: 'long' | 'short'
  rawScore: number // sum of factor scores, max ~12
  weightedScore: number // factors × weights
  grade: 'A' | 'B+' | 'B' | 'C'
  factors: FactorScores
  entryPrice: number
  stopPrice: number // entry ± atr * atr_stop_mult
  targetPrice: number // entry ± atr * atr_target_mult
  atr: number
  riskReward: number
  reason: string // human-readable explanation
}

export function scoreInstrument(bars: OhlcvBar[], weights: TradingWeights): ScoredPick | null {
  /* port from trading_predictions.py */
}

export function gradeFromScore(weighted: number): 'A' | 'B+' | 'B' | 'C' {
  if (weighted >= 10) return 'A'
  if (weighted >= 8) return 'B+'
  if (weighted >= 6) return 'B'
  return 'C'
}
```

**Grade thresholds** (from Streamlit, line ~71): A ≥ 10, B+ ≥ 8, B ≥ 6, C < 6 (filtered out below `min_score_threshold`).

---

## Daily cron — `/api/cron/trading-picks-scan/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret' // F22
import { scanInstruments } from '@/lib/trading/scanner'
import { writePredictions } from '@/lib/trading/persist'
import { dispatchTelegram } from '@/lib/notifications'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const auth = await requireCronSecret(request)
  if (auth) return auth

  const picks = await scanInstruments() // returns top N picks
  const written = await writePredictions(picks)
  await dispatchTelegram({
    bot: 'loeppky_daily_bot',
    template: 'trading-morning-picks',
    data: { picks: written, generatedAt: new Date().toISOString() },
  })

  return NextResponse.json({
    ok: true,
    scanned: picks.length,
    written: written.length,
    grades: picks.reduce((acc, p) => ({ ...acc, [p.grade]: (acc[p.grade] ?? 0) + 1 }), {}),
  })
}
```

**Vercel cron entry** (`vercel.json`): `0 13 * * 1-5` UTC = 7am MT, weekdays only (markets closed weekends — no point scanning Saturday).

---

## Weekly weight-tuning cron — `/api/cron/trading-weights-tune/route.ts`

Runs Sunday night (`0 4 * * 1` UTC = 9pm Sunday MT):

1. Read last 20 closed trades from `predictions` where `domain='trading'` and `resolved_at IS NOT NULL`.
2. Compute summary: win rate, avg R-multiple, factor correlation matrix (which factor scores correlate with wins).
3. Send to Claude with prompt mirroring Streamlit `analyze_and_learn`:
   > _"You are a multi-instrument trading system optimizer. Last 20 trades summarized below. Adjust scoring weights by 0.05–0.2 per factor. If stops hit too often: increase atr_stop_mult. If targets rarely reached: decrease atr_target_mult. If a factor correlates with wins, increase its weight. Return JSON only."_
4. Validate Claude's response with Zod schema (each weight in valid range, see Streamlit lines).
5. Insert into `prediction_weights`, set new row `is_active=true`, flip old to `false` (atomic transaction).
6. Telegram summary to Colin: "Weights tuned. Trend 1.0→1.15, RSI 1.0→0.95, ..."

Per F19: % delta in scoring accuracy (unit: hit-rate %) logged to `agent_events`, surfaced in morning_digest.

---

## Trading page — `app/(cockpit)/trading/page.tsx`

Layout (single page, no tabs):

1. **Status header:** `PAPER` badge (orange) or `LIVE` badge (green). Sub-line: "30/30 trades, 58% win rate, +0.7 R, 70% A-grade hit. Gate: OPEN — go live?" with button. (Disabled until thresholds met. Status pulled from `trust_state`.)
2. **Today's picks (top of page):** card grid, one per pick. Each card:
   - Ticker + direction badge (long/short)
   - Grade chip (A / B+ / B)
   - Entry / Stop / Target prices
   - R:R ratio
   - Confidence bar (0-10)
   - Reason text (from Claude or template)
   - "Log this trade →" button (links to /trades/new with prediction_id pre-filled)
3. **Last 30 days table:** all predictions, sortable. Columns: Date, Ticker, Grade, Direction, Entry, Stop, Target, Outcome, P&L, R-multiple. Outcome blank if unresolved.
4. **Active weights snapshot (collapsible):** the JSON from `prediction_weights.weights` so Colin can see what the engine is using. Last tune date + reasoning.

**Components:**

- Use existing `Gauge`, `PillBar`, `StatusLight` primitives where possible (per Design Council §4.2 — no freelancing).
- All chart components use shadcn/ui Chart + Recharts (per F20).
- No inline `style={}` (per F20).

---

## API: prediction resolution

`POST /api/predictions/[id]/resolve`

```typescript
// Authenticated only (auth.getUser per F-N5)
// Body: { exit_price?: number, won?: boolean, actual_pnl?: number, exit_reason?: string }
// Updates predictions.{resolved_at, won, actual_pnl, exit_price, actual_result}
// Triggers trust_state recompute via DB trigger or post-update RPC
```

For trades, resolution typically happens when Colin closes the position in TradingView and logs the result. For sports (chunk C), resolution can be auto via score-fetch cron.

---

## Tests required

### Unit

- `tests/trading/scoring.test.ts` — 8 cases: each grade boundary, both directions, missing data, low-volume skip
- `tests/trading/market-data.test.ts` — yfinance error handling, cache hit/miss
- `tests/trading/learn.test.ts` — weight adjustment within range bounds, JSON validation

### Integration

- `tests/api/cron/trading-picks-scan.test.ts` — full cron: mock yfinance, expect N predictions written, expect Telegram queued
- `tests/api/cron/trading-weights-tune.test.ts` — mock Claude, expect new active weights row

### Architecture

- F22 enforcement: scan + tune both gated by `requireCronSecret`
- F-N5: `/api/predictions/[id]/resolve` calls `auth.getUser()`

### E2E (Puppeteer)

- Navigate to `/trading`, expect today's picks visible, expect status header showing PAPER

---

## Acceptance criteria

### AC-B1: Cron runs end-to-end

Manual trigger:

```bash
curl -X POST $LEPIOS_URL/api/cron/trading-picks-scan \
  -H "Authorization: Bearer $CRON_SECRET"
```

Returns 200 with `{ ok: true, scanned: 14, written: N }`. New rows visible in `predictions` table.

### AC-B2: Top picks selected, low-score filtered

Of 14 instruments scanned, only those with `weighted_score >= min_score_threshold (5.0)` are written. Re-running with all weights set to 0 writes 0 picks.

### AC-B3: Telegram delivered

After cron runs, `outbound_notifications` has a queued row. After drain, Telegram bot receives a message with grade-sorted picks.

### AC-B4: Weight tuning produces valid output

Mock 20 closed trades with known win/loss patterns. Run tune cron. New `prediction_weights` row with `is_active=true` is present, weights are within configured ranges, old row flipped `is_active=false`.

### AC-B5: Trading page renders

Navigate to `/trading`, page renders without errors. Today's picks visible if any exist; "no picks today" message otherwise. Status header pulls from `trust_state`.

### AC-B6: Resolve flow updates prediction

POST `/api/predictions/[id]/resolve` with body, prediction row updates correctly, `trust_state` rolling stats recomputed.

### AC-B7: F22 + F-N5 compliance

Architecture tests pass. No inline cron-secret checks in app/api/. No unauthenticated routes that read user data.

### AC-B8: F20 design compliance

Grep `app/(cockpit)/trading/` for `style=` returns 0 matches. All components use shadcn/Tailwind.

---

## Open questions for Colin (answer before chunk B starts)

1. **Instrument list** — replace MES/M2K (Streamlit) with ES/RTY here? Or wire micros directly via continuous contract symbol?
2. **Cron time** — 7am MT weekdays only confirmed?
3. **Claude model for tuning** — Sonnet 4.6 (Streamlit's choice) or Opus 4.7 for the weekly weight-tune? Opus reasons more thoroughly; cost is ~5× per call but only 52 calls/year.
4. **Position sizing** — Streamlit hardcodes 1% account risk. Surface as a `trust_state` field, or hardcode? Recommend: store in `trust_state` so you can adjust without redeploying.
