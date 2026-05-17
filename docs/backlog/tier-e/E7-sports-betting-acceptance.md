# E7 — Sports Betting: Acceptance Doc
task_id: 48cde92d-cfc7-4c51-b585-3aaa5dc49e27
status: awaiting-colin-approval
prepared: 2026-05-17
study_doc: docs/backlog/tier-e/E7-sports-betting-study.md

---

## Pivot signal

The Odds API integration, bets table, bets API, and sports AI picks system are already fully
built. The genuine missing piece is the **`/sports-betting` page** — a manual bet journal UI
that the sidebar references as `href: null` (placeholder, never wired).

This acceptance doc is scoped to what's genuinely missing, not a full rebuild.

---

## Scope (what builder ships)

### 1. `/sports-betting` page route

New page at `app/(cockpit)/sports-betting/page.tsx` and `_components/SportsBettingPage.tsx`.

Page purpose: **manual bet journal** — Colin sees today's odds, logs a bet, reviews history.
Distinct from `/sports-intel` (AI picks system). Both exist; neither duplicates the other.

Tabs:
- **Today's Games** — reuse the `TodaysGamesTab` component from `sports-intel` (no re-code); or
  a simplified version showing game + odds only, without the Elo overlay and auto-log controls.
  _Decision needed from Colin — see Open Questions #1._
- **Log a Bet** — form to POST /api/bets: sport (dropdown), league, home/away teams, bet_on,
  bet_type (dropdown), odds (American integer), stake ($), mood_state (if migration approved),
  notes. On success: flash confirmation, clear form.
- **Bet History** — GET /api/bets (last 50). Table: date | sport | bet_on | odds | stake | result | P&L.
  P&L sparkline above the table (rolling 30 bets). Win rate + total P&L badge at top.

### 2. Sidebar wiring

`CockpitSidebar.tsx`: change `{ label: 'Sports Betting', href: null }` to
`{ label: 'Sports Betting', href: '/sports-betting' }`.

### 3. Migration — add `mood_state` to bets (conditional on Colin approval)

```sql
ALTER TABLE bets ADD COLUMN IF NOT EXISTS mood_state TEXT
  CHECK (mood_state IN ('calm', 'sharp', 'tilted', 'degenerate'));
GRANT INSERT, UPDATE, DELETE ON bets TO service_role;
```

_If Colin rejects mood_state: form omits the field, migration is skipped. Acceptance test
adjusts accordingly._

### 4. F17 / F18 instrumentation

- `logEvent('betting', 'bet_logged', { sport, league, odds, mood_state, kelly_pct })` on
  every POST /api/bets success (already done in existing route — confirm it's there)
- Page load: `logEvent('sports-betting', 'page.viewed', { actor: 'user', status: 'success' })`
- F18 surface: win_rate (wins/settled), total_pnl, bankroll trend (last 10 bets by
  bankroll_after) computed client-side from GET /api/bets response.

---

## Out of scope

- Re-implementing Today's Games from scratch (reuse TodaysGamesTab)
- Sports-intel AI picks system changes
- Elo overlay on sports-betting page (only on sports-intel)
- Multi-user support (SPRINT5-GATE note preserved)
- Gate status dashboard on sports-betting page (already on sports-intel)
- Auto-settlement cron changes
- Any Streamlit import of historical bets (BACKLOG-1 data integrity rule)

---

## Files expected to change

| File | Change |
|---|---|
| `app/(cockpit)/sports-betting/page.tsx` | New — page shell + auth guard |
| `app/(cockpit)/sports-betting/_components/SportsBettingPage.tsx` | New — tabbed UI |
| `app/(cockpit)/_components/CockpitSidebar.tsx` | Update `href: null` → `/sports-betting` |
| `supabase/migrations/NNNN_add_mood_state_to_bets.sql` | New — conditional on approval |
| `lib/schemas/bet.ts` | Add `mood_state` to BetInsertSchema — conditional |
| `tests/e2e/sports-betting.test.ts` or equivalent | New acceptance test |

---

## Check-Before-Build findings

- `/api/sports/odds` — exists, no change needed
- `/api/bets` — exists, no change needed (mood_state addition is nullable, backward compat)
- `bets` table — exists, migration 0003; mood_state is a nullable additive column
- `TodaysGamesTab` — exists at `SportsIntelPage.tsx:134`; import or re-export pattern needed
- Kelly/implied prob — computed server-side already, no builder action needed
- Sidebar `href: null` — confirmed at `CockpitSidebar.tsx` line with `'Sports Betting'`

---

## Grounding checkpoint

Colin visits `/sports-betting` in production after deploy:
1. Today's Games tab: at least 1 game card visible (or demo banner if no API key)
2. Log a Bet form: submit a test bet → GET /api/bets returns the new row
3. Bet History: the logged test bet appears, P&L sparkline renders (even if flat/single point)
4. Win rate badge renders (0% or actual if prior bets exist)
5. Sidebar "Sports Betting" link navigates to the page (not null/disabled)

---

## Kill signals

- If today's games tab duplicates all sports-intel logic instead of reusing components → reject, refactor first
- If mood_state migration is applied without explicit Colin approval → revert migration
- If `/api/bets` is modified in any way → out of scope, reject that change

---

## Open questions for Colin (awaiting approval)

1. **Today's Games tab on /sports-betting**: reuse `TodaysGamesTab` component as-is (with Elo,
   filter/sort, auto-log-picks button), OR build a simplified version (odds-only, no Elo)?
   - Coordinator recommendation: simplified — sports-betting is a manual journal; the Elo/AI
     controls belong on sports-intel.

2. **Mood state migration**: approve adding `mood_state TEXT CHECK(IN calm|sharp|tilted|degenerate)` to bets?
   - Coordinator recommendation: yes — single nullable column, fully reversible, enables future
     F17 mood correlation analysis.

---

## Cached-principle decisions

No cache-match applied — open design questions and schema change require Colin approval.
Twin unreachable in coordinator sandbox (host not in allowlist); all twin Q&A blocked.

---

## Estimated effort

Builder estimate: M (medium) — 2–3 hours. UI-only except 1 migration. All backend exists.
