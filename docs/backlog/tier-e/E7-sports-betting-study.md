# E7 — Sports Betting: Study Doc
task_id: 48cde92d-cfc7-4c51-b585-3aaa5dc49e27
prepared: 2026-05-17
coordinator: coordinator sub-agent (run_id 01429da5-abcf-4620-8e8b-74e9827573a2)

---

## Phase 1a — Streamlit Reference

Streamlit `.py` files are not committed to this repo (predecessor system). Task description
is the sole specification. No Streamlit source to study — proceeding from task brief + LepiOS
prior art audit.

---

## Task Brief (verbatim from task_queue)

"Port sports betting from Streamlit to LepiOS. API: The Odds API (ODDS_API_KEY env var already
in Vercel). Leagues: NHL, CFL, NBA, NFL, MLB, MLS, EPL, UEFA CL/EL, UFC/MMA, ATP/WTA Tennis,
PGA Golf. Deliverables: (1) /api/sports/odds GET route returning today's games + implied probs;
(2) /sports-betting page showing today's games table, log-bet form, bet history with P&L
sparkline; (3) bets table in Supabase if not already there. Every bet logged with odds, stake,
sport, mood state. F17: feeds sports P&L→path engine. F18: bet win rate + bankroll trend on
page."

---

## Check-Before-Build Findings (prior art audit)

### Already fully built — no action needed

| Deliverable | Status | Location |
|---|---|---|
| `/api/sports/odds` GET route | COMPLETE | `app/api/sports/odds/route.ts` |
| The Odds API client (getTodaysGames, filterFavorites, checkApiConnection) | COMPLETE | `lib/sports/odds.ts` |
| `bets` Supabase table | COMPLETE | migration `0003_add_win_prob_pct_to_bets.sql` |
| `/api/bets` GET + POST routes | COMPLETE | `app/api/bets/route.ts` |
| Kelly criterion + implied prob calculations | COMPLETE | `lib/kelly.ts` |
| Bet Zod schemas (BetInsertSchema, BetQuerySchema) | COMPLETE | `lib/schemas/bet.ts` |
| Today's games UI with Elo overlay + filter/sort | COMPLETE | `app/(cockpit)/sports-intel/_components/SportsIntelPage.tsx` (TodaysGamesTab) |
| Picks log (AI picks, not manual bets) | COMPLETE | SportsIntelPage PicksLogTab |
| Results & Debrief (settled picks, AI debrief) | COMPLETE | SportsIntelPage ResultsDebriefTab |
| Gate Status (bankroll gate, sample-size tracker) | COMPLETE | SportsIntelPage GateStatusTab |
| Sports Elo ratings | COMPLETE | `lib/sports/elo.ts` |
| AI coaching + debrief | COMPLETE | `lib/sports/coach.ts`, `lib/sports/debrief.ts` |
| Cron: sports picks auto-scan | COMPLETE | `app/api/cron/sports-picks-scan/route.ts` |
| Cron: sports results auto-settlement | COMPLETE | `app/api/cron/sports-results-fetch/route.ts` |
| Cron: AI weights tuning | COMPLETE | `app/api/cron/sports-weights-tune/route.ts` |

### Partially built — sidebar wired but page missing

| Deliverable | Status | Evidence |
|---|---|---|
| `/sports-betting` page route | NOT BUILT | `CockpitSidebar.tsx`: `{ label: 'Sports Betting', href: null }` — placeholder, never wired |

### Missing entirely

| Deliverable | Gap | Notes |
|---|---|---|
| Manual log-bet form UI | NOT BUILT | `/api/bets POST` exists; no frontend form in any page |
| Bet history with P&L sparkline | NOT BUILT | `/api/bets GET` exists; no UI to display history + sparkline |
| `mood_state` field on bets | NOT BUILT | Not in `lib/schemas/bet.ts`, not in migration `0003` |
| F18 bet win rate + bankroll trend | NOT BUILT | bets table has the data; no computed surface |

---

## What it does (Streamlit analog, inferred from task brief)

Sports betting was a Streamlit page that Colin used to:
1. Browse today's games with implied probabilities from The Odds API
2. Manually record a bet (sport, league, teams, odds, stake, mood at bet time)
3. Track bet history with running P&L

The AI picks system (`sports-intel`) is a separate, more sophisticated layer built on top — it's
an automated signal generator, not a manual journal. The original Streamlit "sports betting"
was the manual journal layer.

---

## Domain rules embedded (from task brief + existing code)

1. **Implied prob = americanToImplied(odds)** — server-side computed, never client-provided
2. **Kelly % = kellyPct(impliedProb, odds)** — server-side computed
3. **person_handle hardcoded to 'colin'** — per SPRINT5-GATE comment, second-user support deferred
4. **Odds in American format** (integers: -150, +120 etc.)
5. **bet_type enum**: moneyline | spread | over_under | parlay | prop | futures (lowercase, DB CHECK constraint)
6. **result enum**: win | loss | push | void | pending (lowercase, DB CHECK constraint)
7. **Leagues referenced in task**: NHL, CFL, NBA, NFL, MLB, MLS, EPL, UEFA CL/EL, UFC/MMA, ATP/WTA, PGA
8. **F17**: sports P&L feeds behavioral path engine — requires `agent_events` logging on every bet
9. **F18**: win rate + bankroll trend must be surfaced on the page, not just stored in DB

---

## Edge cases

1. **No ODDS_API_KEY**: existing route returns `is_demo: true` with synthetic data — preserve this
2. **Duplicate pick logged**: `/api/bets` currently has no dedup guard — mood_state addition means we'd need to decide on uniqueness constraint (date + game? none?)
3. **P&L sparkline with zero bets**: empty state needed
4. **Mood state enum vs free text**: task says "mood state" — needs a decision: enum (calm/tilted/sharp/degenerate) or free text?

---

## 20% Better opportunities

| Category | Improvement |
|---|---|
| UX | Pre-populate log-bet form from a game clicked in today's odds table (team, league, home/away auto-filled) |
| Correctness | Serve `is_demo` prominently when key absent; don't show empty game list silently |
| Performance | Reuse `TodaysGamesTab` component from sports-intel instead of rewriting; single source of truth |
| Observability | Log `betting.bet_log_opened` on page load to agent_events (F18 surface) |
| Data model | Add `mood_state` to bets table — original Streamlit intent; enables future mood correlation analysis |
| F18 | Compute win_rate, total_pnl, bankroll trend directly on page from `/api/bets` response |

---

## Open design questions (escalated to Colin)

1. **Separate `/sports-betting` page vs. extend `/sports-intel`?**
   - Option A: New `/sports-betting` page = manual journal focus (today's odds + log form + history). Sports-intel = AI system.
   - Option B: Add "Log Bet" tab to existing `/sports-intel`. Simpler, less navigation surface.
   - Coordinator recommendation: Option A — clean separation of concerns. Sports-intel is algorithmic; sports-betting is human judgment.

2. **Mood state type?**
   - Option A: Enum — `calm | sharp | tilted | degenerate` (enables pattern analysis)
   - Option B: Free text string (flexible, no migration constraint)
   - Coordinator recommendation: enum — structured for future F17 correlation analysis.

3. **Mood state migration: now or defer?**
   - The `/sports-betting` page can ship without it (mood state optional in form)
   - But if deferred, the field is missing from records forever
   - Coordinator recommendation: add in this task — it's a single-column ALTER ADD.

---

## Pivot signal summary

**The task premise is ~70% already built.** The Odds API route, bets table, and the AI sports picks system are all live. The genuine gap is:
- `/sports-betting` page (sidebar placeholder, never built)
- Manual log-bet form UI (backend exists, frontend missing)
- Bet P&L history with sparkline (data exists, display missing)
- `mood_state` field on bets (new, needs migration)

This is analogous to the retail-arb-engine task (task 3a13fc07) which also found ~72% already ported.

**Recommended re-scope:** Build only the genuinely missing pieces. Do not re-build what already works.
