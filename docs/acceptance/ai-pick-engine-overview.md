# Acceptance Doc — AI Pick Engine + Trust Gate (Overview)

**Status:** Proposal for Colin's review. Override of ARCHITECTURE.md §3.1 + §7.4 has been ratified verbally (2026-05-06) and applied. Trust thresholds below are **proposed defaults** — adjust before chunks ship.

**Source material:**

- `streamlit_app/tools/trading_predictions.py` — full self-tuning trading signal engine (~200 LOC)
- `streamlit_app/utils/market_data.py` — yfinance market data wrapper (~28KB)
- `streamlit_app/tools/sports_predictions.py` — sports picks bot (~150 LOC)
- `streamlit_app/utils/sports_odds.py` — The Odds API integration, 14 leagues (~28KB)
- `streamlit_app/utils/sports_coach.py` — Claude post-game debrief (~191 LOC)
- `streamlit_app/pages/2_Trading_Journal.py` — manual trade journal (Sheets-backed)
- `streamlit_app/pages/3_Sports_Betting.py` — bet logging UI

**LepiOS targets:**

- New: `app/(cockpit)/trading/page.tsx`, `app/(cockpit)/sports/page.tsx`, `app/(cockpit)/calibration/page.tsx`
- Existing extended: `bets` table (add `mode`), Betting tile (paper/live indicator)

---

## Goal in plain English

Colin opens LepiOS and sees:

1. Today's AI trading picks (which stocks/futures to consider, with grade and reasoning).
2. Today's AI sports picks (who's playing, who to bet on, with confidence and reasoning).
3. A calibration page showing — for both domains — how often the AI has been right, broken down by confidence grade.
4. A clear status: **PAPER** until rolling stats cross thresholds → unlock **GO LIVE** button.

The AI runs every day whether Colin acts on it or not. Each pick is a logged prediction. Each settled outcome closes the loop and feeds back into next-cycle weight tuning. Once the AI has demonstrated profitability across a sample size you trust, you flip to live.

---

## The four chunks

| Chunk                               | File                                    | What ships                                                                                                                                         |
| ----------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — Schema + paper mode**         | `ai-pick-engine-chunk-a-schema.md`      | Migrations: `trades` table, `predictions` table, `mode` column on `bets`/`trades`, `trust_state` table, RLS policies. No UI.                       |
| **B — Trading pick engine**         | `ai-pick-engine-chunk-b-trading.md`     | Daily cron: scan instruments → generate signals → write predictions → Telegram dispatch. `/trading` page. Auto-tuning weights port from Streamlit. |
| **C — Sports pick engine**          | `ai-pick-engine-chunk-c-sports.md`      | Daily cron: pull odds → AI analysis → write predictions → Telegram. `/sports` page. **Sports learning loop (new — Streamlit doesn't have this).**  |
| **D — Calibration UI + trust gate** | `ai-pick-engine-chunk-d-calibration.md` | `/calibration` page: hit rate by grade, calibration plot, drawdown, Trust Gate state machine, "Go Live" button.                                    |

Build order: A → (B and C in parallel) → D.

---

## Proposed trust thresholds (defaults — adjust here)

### Trading paper → live

All five must be green to unlock the "Go Live" button.

| Metric                | Threshold            | Rationale                                                                                 |
| --------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| Min sample size       | **30 closed trades** | Below this, win rate is noise                                                             |
| Rolling win rate      | **≥ 55%**            | At Streamlit's default 1:2 R:R (1.5×ATR stop / 3×ATR target), 55% wins ≈ +1.6 R per cycle |
| Avg R-multiple        | **≥ +0.5R**          | Catches "wins often, small; loses big"                                                    |
| Grade-A pick win rate | **≥ 65%**            | Calibration check: best picks must beat average picks, else grading is broken             |
| Max paper drawdown    | **< 15%**            | If paper bankroll dropped >15%, the real one will too                                     |

### Sports paper → live

| Metric                          | Threshold                                | Rationale                                                         |
| ------------------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| Min sample size                 | **50 settled bets**                      | Sports has more variance than trading; need more data             |
| Win rate on Green tier (≤ -150) | **≥ 62%**                                | Breakeven at -150 = 60%. 62% gives 2 points of edge over book vig |
| ROI on Green tier               | **≥ +3%**                                | Direct profitability check (not just hit rate)                    |
| AI rating ≥ 7 calibration       | **picks rated 7+ win ≥ 65% of the time** | High-confidence picks must outperform                             |
| Max paper bankroll drawdown     | **< 20%**                                | Sports drawdowns run deeper than trading                          |

Thresholds are stored in `trust_state` table (chunk A). Editable via a settings UI in chunk D — no redeploy needed.

---

## How the loop works (data flow)

```
┌──────────────────┐
│ Daily cron (AM)  │  ← Vercel cron, requireCronSecret auth
└────────┬─────────┘
         │
    ┌────┴─────┐
    │          │
    ▼          ▼
┌────────┐  ┌────────────┐
│Trading │  │ Sports     │
│scanner │  │ scanner    │
│(yfin)  │  │ (Odds API) │
└────┬───┘  └─────┬──────┘
     │            │
     ▼            ▼
┌─────────────────────────┐
│ Score + grade picks     │  ← Streamlit weights, ported
│ (Claude or local logic) │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ INSERT into predictions │  ← chunk A schema
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ Telegram dispatch       │  ← outbound_notifications queue
└─────────────────────────┘

       . . . later . . .

┌──────────────────────────┐
│ Outcome resolves         │
│ (Colin settles bet OR    │
│  Vercel cron fetches     │
│  scores/closes trades)   │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ UPDATE predictions       │  ← actual_result, pnl, won
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ Recompute trust_state    │  ← rolling stats, threshold check
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ Weekly: analyze_and_learn│  ← Claude reads last 20-50 outcomes,
│ adjusts scoring weights  │     emits new weights row
└──────────────────────────┘
```

---

## Architecture compliance

This work overrides the prior ARCHITECTURE.md positions:

- §3.1 Trading Agent: _"Does not generate trade signals"_ — **REMOVED** as of 2026-05-06. Replaced with explicit signal-generation responsibility + trust-gated paper/live mode.
- §7.4 Trading Journal _"deferred to v3+"_ — **PULLED FORWARD** into AI Pick Engine sprint.
- New: §3.1 Sports Agent (split from Betting Agent which retains Kelly + bankroll only).

This keeps §8.4 Check-Before-Build:

- **Beef up:** existing `bets` table (gains `mode` column), existing Kelly math (`lib/kelly.ts`), existing edge signals (`lib/betting-signals.ts`), existing Betting tile.
- **Build new:** `trades` table, `predictions` table, `trust_state` table, trading scanner, sports pick generator, calibration UI, trust gate state machine.

This keeps §8.5 Accuracy Zone:

- Each chunk is one session worth of build (acceptance criteria fit in one paste).
- Chunk B and C run in parallel worktrees (independent files, no merge conflicts).
- Chunk D depends on A/B/C — sequenced last.

---

## Constitutional rules this work must respect

- **F22 (cron-secret helper):** All `app/api/cron/**` routes use `requireCronSecret(request)`. No inline `if (CRON_SECRET)` checks.
- **F-N5 (auth invariant):** All non-cron `app/api/**` routes call `auth.getUser()` before reading user-scoped data.
- **F20 (design system):** No inline `style={}`. All new components use shadcn/ui + Tailwind utility classes.
- **F18 (measurement + benchmark):** Every prediction logs to `agent_events` with grade, confidence, outcome. Calibration page surfaces hit rate vs benchmark (random = 50%, breakeven = 60% on -150 odds).
- **F17 (behavioral ingestion):** Each prediction + outcome is an event the engine learns from — direct contribution to the path probability engine.
- **F19 (continuous improvement):** Weekly `analyze_and_learn` cron runs the 20%-better loop on scoring weights. Adjustments logged, surfaced in morning_digest.

---

## Out of scope (explicit)

- **Broker API integration.** No automatic trade execution. Colin executes manually on TradingView / brokerage of choice. Same for sportsbooks — Colin places on Play Alberta.
- **Options, crypto, forex.** v1 is the Streamlit instrument set: ES/NQ/RTY/GC/CL/SI futures + 8 stocks (TSLA NVDA AAPL AMZN MSFT META AMD GOOG).
- **Parlay handling.** Existing `bet_type` enum supports parlay; AI engine v1 generates singles only.
- **Live in-game odds.** Pre-game only. Live odds are higher-frequency and require different infra.
- **Multi-user.** Hardcoded `person_handle = 'colin'` continues until SPRINT5-GATE (§7.3) ships.
- **Historical Streamlit data import.** BACKLOG-1 audit blocks importing old bets. AI engine starts with fresh predictions only.

---

## Decisions (delegated by Colin 2026-05-06)

Colin delegated all four open questions: _"just do what you think on all. once its in lepios i can see how everything works and change accordingly."_ Calls below.

1. **Trust thresholds** — **defaults stand** (5 metrics per domain as listed above). Stored in `trust_state` table per Chunk A; editable from settings UI per Chunk D. Adjust after first ~20 paper trades when real distribution is visible.

2. **Sprint slot** — **standalone "Sprint AI Pick Engine"**, parallel-buildable with Sprint 6 BR Tier 2. Justification: independent file set, independent data model, no shared migrations. Two builder windows can work concurrently. ARCHITECTURE.md §7.1 queue is informally extended; formalize when chunks land.

3. **Cron schedule** — split:
   - **Trading picks scan:** 6:30am MT weekdays only (`30 12 * * 1-5` UTC). Pre-market window before US equities open at 7:30am MT. 1-hour cushion to review.
   - **Sports picks scan:** 8:00am MT daily (`0 14 * * *` UTC). Earliest North-American sport games typically 11am+ MT, gives 3-hour review window.
   - **Trading weights tune:** Sunday 9pm MT (`0 4 * * 1` UTC).
   - **Sports weights tune:** Sunday 10pm MT (`0 5 * * 1` UTC).
   - **Sports results fetch:** every hour via existing notifications-drain cron (avoids Vercel Hobby cron limit).

4. **Telegram bot routing** — **`loeppky_daily_bot`**. Matches existing semantics ("daily queries, general alerts, personal OS status" per global CLAUDE.md). Format: one consolidated morning digest per domain (not per-pick spam). Critical-only individual alerts deferred until live mode.

Once Chunk A schema lands, Chunks B and C become independently buildable; Chunk D follows after both have produced data.
