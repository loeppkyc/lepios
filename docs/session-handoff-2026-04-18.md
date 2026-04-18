# Session Handoff — 2026-04-18

## What was completed today

### Sprint 1 — verified
- Cron + Supabase write + deploy confirmed working
- RLS policy verified (anon blocked, authenticated allowed)
- Sprint 5 multi-user HARD GATE documented in ARCHITECTURE.md §7.3 and migration-notes.md (MN-3)
- All hardcoded `person_handle='colin'` lines tagged with `// SPRINT5-GATE:` grep comments

### Sprint 2 Chunk 1 — complete
- `lib/kelly.ts`: `americanToImpliedProb()`, `kellyPct()`
- `lib/schemas/bet.ts`: Zod BetInsertSchema, BetQuerySchema, BetSettleSchema
- Unit tests passing

### Sprint 2 Chunk 2 — complete
- `lib/betting-signals.ts`: `rollingRoiSignal()`, `SIGNAL_WINDOW=30`
- `app/api/bets/route.ts`: GET + POST
- `app/api/bets/[id]/route.ts`: PATCH (settle)
- `supabase/migrations/0003_add_win_prob_pct_to_bets.sql` — applied live
- Unit tests: 58/58 passing

### Sprint 2 Chunk 3 — complete and deployed
- `components/cockpit/CockpitInput.tsx` — hint/tooltip prop added
- `components/cockpit/CockpitSelect.tsx` — new primitive
- `app/(cockpit)/money/_components/LogBetForm.tsx` — Kelly rec, win_prob_pct stored
- `app/(cockpit)/money/_components/SettleBetForm.tsx` — overridable PnL auto-calc with ⓘ tooltip
- `app/(cockpit)/money/_components/BettingTileClient.tsx` — SettleModal (SQL snippet + Supabase link), FreshStartBanner
- `app/(cockpit)/money/page.tsx` — bets query wired, EdgeSignal, rolling PnL
- E2E tests: 5/5 active passing, 3 skipped (auth-gated)
- **Deployed manually via `vercel deploy --prod` from PowerShell — 2026-04-18**
- **Production URL:** lepios-one.vercel.app

### Documentation
- `ARCHITECTURE.md` §7.3 — Sprint 5 HARD GATE appended
- `audits/migration-notes.md` — MN-3 (multi-user RLS), BACKLOG-1 (historical bets audit)
- `CLAUDE.md` — §6 Data Integrity Rules added (historical Streamlit bets NOT trusted)
- `docs/ideas-backlog.md` — BACKLOG-2 sports prediction modeling pipeline (4 phases)
- `docs/using-the-betting-tile.md` — no-code cheat sheet for Colin

---

## User testing gap surfaced

First use of the Betting tile revealed a real UX gap: **no "Today's Games" display**. User can't see the day's slate to know what to bet on — has to already know the game before logging.

**Decision:** Insert **Chunk 3.5** before Chunk 4 — add a "Today's Games" schedule section to the Betting tile using the sports API already wired in Streamlit OS.

---

## Backlog additions

- **BACKLOG-3:** Set up GitHub remote for LepiOS + enable Vercel git integration for auto-deploy on push. 10-minute setup, deferred — not blocking anything.

---

## Pending for next session

### 1 — Diagnose sports API in Streamlit OS
Grep the Streamlit OS codebase for: `odds_api`, `sportsdata`, `ESPN`, `balldontlie`, `api-sports`, `sportsipy`, `sportsradar`, `thesportsdb`. Do NOT port anything yet — just identify what's wired in and report:
- Which API(s) are in use
- What endpoints/data is already being fetched (schedule? odds? scores?)
- Whether it has a free tier that covers today's schedule

### 2 — Scope Chunk 3.5
Based on API findings: is this a 2-hour port (just call the same API from a Next.js route) or a bigger job (new API key, different data shape, rate limit concerns)?

### 3 — Ship Chunk 3.5
Add "Today's Games" display to the Betting tile. Show game matchups for the current day, filterable by sport. Each game row should be tappable to pre-fill the Log Bet form (home/away/sport/league). Must be complete before starting Chunk 4 (Trading tile).

---

## Git state at close

- **LepiOS:** clean — all commits landed
- **Streamlit OS:** clean (no changes made this session)

## Commits landed today (LepiOS)

```
c7caea4 docs: add betting-tile usage guide for Colin
497b54e docs: BACKLOG-2 sports prediction modeling pipeline in ideas-backlog
c687bd4 docs: BACKLOG-1 historical bets audit + CLAUDE.md preference + banner confirmation
366100d feat(betting-tile): store win_prob, overridable PnL auto-calc, instructional settle fallback
444e67a feat(betting-tile): implement log form, Kelly rec, settle action
a126449 test(betting-tile): add Puppeteer acceptance tests
[earlier Sprint 1/2 commits]
```
