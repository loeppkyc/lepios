# Acceptance Doc — AI Pick Engine Chunk C: Sports Pick Engine

**Sibling:** `ai-pick-engine-overview.md` (read first)
**Depends on:** Chunk A (schema must be live).
**Parallel-safe with:** Chunk B (independent files).
**Builder window estimate:** 3–4 hours.

---

## What ships

1. Daily cron at 8am MT (`/api/cron/sports-picks-scan`) that:
   - Pulls today's odds from The Odds API for 14 leagues
   - Filters Green tier (≤ -150 favorites)
   - Runs Claude analysis on each candidate (prompt port from `sports_coach.py`)
   - Writes top-rated picks to `predictions` table
   - Dispatches Telegram
2. Daily cron at 11pm MT (`/api/cron/sports-results-fetch`) that:
   - Fetches scores for completed games
   - Resolves matching predictions (sets `won`, `actual_result`, `actual_pnl`)
3. Weekly cron Sunday (`/api/cron/sports-weights-tune`) — **NEW: Streamlit doesn't have this.**
   - Reads last 50 settled bets / picks
   - Adjusts sports weights (max_odds, min_implied_prob, ai_rating_min)
4. `/sports` page showing today's picks + history + AI debrief on settled.
5. Library: `lib/sports/odds.ts`, `lib/sports/coach.ts`, `lib/sports/scanner.ts`, `lib/sports/learn.ts`.

---

## Builder pre-flight

```bash
# Confirm chunk A landed (predictions accepts sports rows)
psql -c "INSERT INTO predictions (domain, pick_date, grade, confidence, reason, sport, league, home_team, away_team, bet_on, odds) VALUES ('sports', CURRENT_DATE, 'B', 6, 'test', 'NHL', 'NHL', 'Edmonton Oilers', 'Calgary Flames', 'Edmonton Oilers', -160) RETURNING id;"
psql -c "DELETE FROM predictions WHERE reason='test';"

# Confirm The Odds API key is wired
test -n "$ODDS_API_KEY" && echo OK || echo MISSING

# Confirm Anthropic SDK + cron-secret helper present
test -f lib/auth/cron-secret.ts && echo OK
test -f lib/anthropic/client.ts && echo OK
```

---

## Streamlit reference (port these files)

| Streamlit                                                                | LepiOS                                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `utils/sports_odds.py`                                                   | `lib/sports/odds.ts`                                                           |
| `utils/sports_coach.py` (post-game debrief, daily picks, monthly review) | `lib/sports/coach.ts`                                                          |
| `tools/sports_predictions.py`                                            | `lib/sports/scanner.ts` + scan cron                                            |
| Sheet: `Sports_Picks_Log`                                                | `predictions` table (chunk A)                                                  |
| Sheet: `📊 Odds Snapshots`                                               | new optional column on predictions OR separate `odds_snapshots` table — see Q1 |
| **NOT IN STREAMLIT**                                                     | `lib/sports/learn.ts` + tune cron — net new                                    |

---

## League list (port verbatim from `sports_odds.py`)

```typescript
// lib/sports/leagues.ts
export const LEAGUES = [
  { key: 'icehockey_nhl', display: 'NHL', sport: 'Hockey' },
  { key: 'americanfootball_cfl', display: 'CFL', sport: 'Football' },
  { key: 'basketball_nba', display: 'NBA', sport: 'Basketball' },
  { key: 'americanfootball_nfl', display: 'NFL', sport: 'Football' },
  { key: 'baseball_mlb', display: 'MLB', sport: 'Baseball' },
  { key: 'soccer_usa_mls', display: 'MLS', sport: 'Soccer' },
  { key: 'soccer_epl', display: 'EPL', sport: 'Soccer' },
  { key: 'soccer_uefa_champs_league', display: 'UCL', sport: 'Soccer' },
  { key: 'mma_mixed_martial_arts', display: 'MMA', sport: 'MMA' },
  { key: 'tennis_atp_singles', display: 'ATP', sport: 'Tennis' },
  { key: 'tennis_wta_singles', display: 'WTA', sport: 'Tennis' },
  { key: 'golf_pga_championship_winner', display: 'PGA', sport: 'Golf' },
] as const
```

(Streamlit list has 14; trim duplicates here. Confirm exact set.)

---

## Odds layer — `lib/sports/odds.ts`

Port `utils/sports_odds.py` to TypeScript:

```typescript
export type Game = {
  game_id: string
  sport: string
  league: string
  commence_time: string // ISO
  home_team: string
  away_team: string
  home_odds: number // American
  away_odds: number
  num_books: number
  favorite: 'home' | 'away'
  fav_odds: number
  dog_odds: number
  implied_prob: number // 0-1
}

export async function getTodaysGames(opts: { dateMT?: Date }): Promise<Game[]>
export function filterFavorites(games: Game[], maxOdds: number): Game[]
export function americanToImpliedProb(odds: number): number
export function oddsToPayout(odds: number, stake: number): number
```

**Cache:** 15 minutes per league key (Streamlit pattern). Use existing `lib/cache/index.ts`.

**Rate limit:** Odds API free tier is 500 req/month. With 14 leagues × 1 daily call = 420/month — leaves headroom. Add a counter to `agent_events` so we can see usage; alert at 90%.

---

## AI coach layer — `lib/sports/coach.ts`

Port `utils/sports_coach.py` three functions:

1. **`analyzePick(game: Game, marketContext): Promise<PickAnalysis>`** — daily picks prompt:

   > _"Game: {home} @ {away}. Odds: {fav}@{fav_odds}. Implied prob: {implied_pct}. Recent form / known injuries / back-to-back: {context}. Rate this bet 1–10 PURELY ON VALUE — not on whether it will win. Identify 2–3 key factors. State one trap signal. Return JSON: { rating: number, key_factors: string[], trap_flag: string | null, confidence_review: string }."_

2. **`generateDebrief(prediction: Prediction, outcome): Promise<DebriefAnalysis>`** — post-game (called from sports-results-fetch cron):

   > _"Bet on {bet_on} at {odds}. Result: {result}. PnL: {pnl}. Why did this {win/lose}? Rate process quality 1–10 (NOT outcome). One sharp lesson. Return JSON: { summary, key_factors, lesson, rating }."_

3. **`monthlyReview(month: Date): Promise<MonthlyReview>`** — runs first of each month:
   > _"Last month performance: {win_rate}, ROI {roi}, breakdown by league {league_table}. Identify what's working, what's not, suggest one specific adjustment. Return JSON."_

**Model:** Claude Sonnet 4.6 default (matches Streamlit). Configurable via `harness_config.SPORTS_COACH_MODEL`.

**Cost guardrail:** ~10 picks/day × 1 prompt each = 10 calls/day. Cache identical game prompts 24h.

---

## Scanner — `lib/sports/scanner.ts`

```typescript
export async function scanSports(): Promise<ScoredSportsPick[]> {
  const games = await getTodaysGames()
  const greens = filterFavorites(games, weights.max_odds) // -150 default
  const analyzed = await Promise.all(
    greens.map(async (g) => ({
      ...g,
      analysis: await analyzePick(g, await marketContext(g)),
    }))
  )
  return analyzed
    .filter((g) => g.analysis.rating >= weights.ai_rating_min) // 7.0 default
    .map((g) => ({
      ticker: undefined,
      sport: g.sport,
      league: g.league,
      game_id: g.game_id,
      home_team: g.home_team,
      away_team: g.away_team,
      bet_on: g.favorite === 'home' ? g.home_team : g.away_team,
      odds: g.fav_odds,
      implied_prob: g.implied_prob,
      ai_rating: g.analysis.rating,
      grade: gradeFromRating(g.analysis.rating), // A 9+, B+ 8, B 7, C <7
      confidence: g.analysis.rating,
      reason: g.analysis.confidence_review,
      tier: 'green',
    }))
}
```

---

## Daily scan cron — `/api/cron/sports-picks-scan/route.ts`

8am MT daily (`0 14 * * *` UTC):

1. `requireCronSecret` (F22)
2. `scanSports()` → predictions array
3. INSERT into `predictions`
4. Telegram dispatch via `outbound_notifications` (one message, all picks formatted)

---

## Daily resolve cron — `/api/cron/sports-results-fetch/route.ts`

11pm MT daily (`0 5 * * *` UTC, next-day):

1. Find unresolved predictions where `domain='sports'` and `pick_date < CURRENT_DATE` (i.e., yesterday and earlier).
2. For each league, fetch scores from Odds API `/scores` endpoint.
3. Match game_id → outcome.
4. UPDATE prediction:
   - `won = (winner == bet_on)`
   - `actual_result = won ? 'win' : 'loss'` (handle push for spreads later)
   - `actual_pnl = oddsToPayout(odds, stake) if won else -stake` (assume $100 flat for paper, see Q3)
   - `resolved_at = now()`
5. For each resolved prediction, call `generateDebrief()` → store in `ai_notes` JSONB.
6. Trigger `trust_state` recompute (DB function or RPC).

---

## Weekly tune cron — `/api/cron/sports-weights-tune/route.ts` (NEW)

Sundays 10pm MT (`0 4 * * 1` UTC):

1. Read last 50 settled `predictions` where `domain='sports'`.
2. Compute league-by-league win rate, odds-bucket win rate (-100 to -130, -130 to -150, -150 to -200, -200+).
3. Send to Claude:
   > _"Sports picks performance, last 50 bets. Adjust scoring parameters: max_odds (currently {x}), min_implied_prob (currently {y}), ai_rating_min (currently {z}). If a bucket consistently wins above breakeven, loosen filters there. If a league consistently loses, tighten or exclude. Return JSON only."_
4. Validate, INSERT new `prediction_weights` row, flip `is_active`.
5. Telegram summary.

This is the **net-new sports learning loop** that Streamlit lacks.

---

## Sports page — `app/(cockpit)/sports/page.tsx`

1. **Status header:** `PAPER` / `LIVE` badge. Sub-line: "37/50 bets, 58% Green-tier win rate, +1.2% ROI. Gate: 2/5 thresholds met."
2. **Today's picks:** card grid. Each card:
   - League badge + game time
   - "{Bet on Edmonton} @ -165 (62% implied)" headline
   - AI rating chip (7.5/10)
   - Grade (A/B+/B)
   - 2-3 key factors as bullets
   - Trap flag (if any) — yellow warning
   - "Log this bet →" pre-fills LogBetForm with prediction_id
3. **History (last 30 days):** sortable table. Date, League, Pick, Odds, Rating, Outcome, P&L. AI debrief expandable per row.
4. **League calibration mini-table:** for each league with ≥10 bets, win rate vs implied prob breakeven. Highlights underperforming leagues.

---

## Tests required

### Unit

- `tests/sports/odds.test.ts` — americanToImpliedProb edge cases (+100, -100, +200, -200), filterFavorites threshold
- `tests/sports/coach.test.ts` — JSON schema validation, missing field handling
- `tests/sports/scanner.test.ts` — full pipeline with mocked Odds API + mocked Claude

### Integration

- `tests/api/cron/sports-picks-scan.test.ts`
- `tests/api/cron/sports-results-fetch.test.ts` — match game_id → resolve correctly
- `tests/api/cron/sports-weights-tune.test.ts`

### Architecture

- F22 on all 3 crons
- F-N5 on user-facing routes

### E2E

- Navigate to `/sports`, picks visible, status header reflects trust_state

---

## Acceptance criteria

### AC-C1: Daily scan returns Green-tier picks only

Mock Odds API with mixed odds (-110, -150, -180, +200). Run scan. Only picks with `odds <= -150` appear in predictions, AND with `ai_rating >= 7.0`.

### AC-C2: Resolve cron matches and updates

Insert mock prediction, mock scores endpoint to return that game's outcome. Run resolve cron. Prediction row has `won`, `actual_pnl`, `resolved_at`, and `ai_notes` populated.

### AC-C3: AI rating distribution is sane

Across a week of scans, rating distribution shouldn't be all 8s. If Claude is collapsing to a constant rating, flag the prompt as broken (Streamlit had this issue once — sanity-check during build).

### AC-C4: Weight tune produces valid output

Mock 50 settled predictions with controlled win/loss pattern (e.g., -180 odds losing more than -130). Run tune. New weights row narrows the odds range (e.g., max_odds tightens from -150 to -140). Validation: each parameter within configured min/max.

### AC-C5: Sports page renders all sections

Today's picks (or "No picks today"), history table, league calibration mini-table all visible without errors.

### AC-C6: Telegram dispatch

After scan, `outbound_notifications` has queued message. After drain, message arrives in `loeppky_daily_bot` chat.

### AC-C7: F22 + F-N5 + F20 compliance (same as chunk B)

### AC-C8: Cost cap respected

Odds API call counter in `agent_events` shows < 30 calls per scan run. Claude calls ≤ N picks (typically 5–15/day).

---

## Open questions for Colin

1. **Odds snapshots** — Streamlit logs every game's odds even when not picked (for closing-line value calc later). Keep this? Adds rows to `predictions` even for non-picks, OR a separate `odds_snapshots` table. Recommend separate table to avoid muddying the prediction calibration data.
2. **League list** — confirm the 12-14 leagues exactly. Drop any you don't bet (Tennis ATP/WTA were "tracking only" in Streamlit?).
3. **Stake assumption for paper PnL** — Streamlit uses $100 flat. Want flat $100 for calibration math, or use Kelly-sized stake from `lib/kelly.ts` so paper PnL matches what real PnL would have been?
4. **Push handling** — sports moneyline rarely pushes (only on certain spreads). Assume win/loss only for v1, or wire push detection now?
5. **Spread / total bets** — v1 is moneyline only? Streamlit was -150 favorites, which is moneyline by definition. Confirm.
