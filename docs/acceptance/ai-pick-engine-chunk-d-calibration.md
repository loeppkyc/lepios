# Acceptance Doc — AI Pick Engine Chunk D: Calibration UI + Trust Gate

**Sibling:** `ai-pick-engine-overview.md` (read first)
**Depends on:** Chunks A, B, C all live with at least some prediction history.
**Builder window estimate:** 3 hours.

---

## What ships

1. `/calibration` page — central dashboard for both domains.
2. Trust Gate state machine: rolling stats recompute, threshold evaluation, gate open/closed status.
3. "Go Live" button (per domain) — manual flip with confirmation modal.
4. Threshold editor (settings page) — change thresholds without redeploy.
5. Library: `lib/trust/state.ts`, `lib/trust/gate.ts`, `lib/calibration/metrics.ts`.
6. New API: `POST /api/trust-state/[domain]/flip-mode`, `PATCH /api/trust-state/[domain]/thresholds`.

---

## Builder pre-flight

```bash
# Need real prediction data to render — chunks B and C must have run for ≥1 day
psql -c "SELECT domain, count(*), count(*) FILTER (WHERE resolved_at IS NOT NULL) FROM predictions GROUP BY domain;"
# trading | N | M (resolved)
# sports  | N | M (resolved)
```

If both domains have 0 resolved predictions, page renders correctly but calibration tiles show "Insufficient data — need 30/50 settled predictions to evaluate."

---

## The Trust Gate state machine

Implemented in `lib/trust/gate.ts`. One function per domain:

```typescript
type GateEvaluation = {
  domain: 'trading' | 'sports'
  current_mode: 'paper' | 'live'
  gate_status: 'open' | 'closed'
  metrics: {
    sample_size: { current: number; threshold: number; pass: boolean }
    win_rate: { current: number; threshold: number; pass: boolean }
    secondary: { key: string; current: number; threshold: number; pass: boolean }
    calibration: { current: number; threshold: number; pass: boolean }
    drawdown: { current: number; threshold: number; pass: boolean }
  }
  failures: string[] // human-readable list of which thresholds aren't met
  can_go_live: boolean // gate_status === 'open' AND current_mode === 'paper'
}

export async function evaluateGate(domain: Domain): Promise<GateEvaluation>
export async function recomputeTrustState(domain: Domain): Promise<void> // writes to trust_state
export async function flipToLive(domain: Domain, by: string): Promise<void> // requires gate_status='open'
export async function flipToPaper(domain: Domain, by: string, reason: string): Promise<void> // always allowed
```

**Recompute trigger:** runs after every `predictions.resolved_at` update — DB trigger calls a Postgres function OR Next.js handles in `/api/predictions/[id]/resolve`. Recommend Next.js (easier to test).

**Gate eval logic:** ALL five metrics must pass. If any fails, `gate_status = 'closed'`, `failures[]` populated. The UI shows red ✗ next to each unmet threshold.

---

## Metrics computed (per domain)

`lib/calibration/metrics.ts`:

### Trading

| Metric           | SQL sketch                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Sample size      | `SELECT count(*) FROM predictions WHERE domain='trading' AND resolved_at IS NOT NULL ORDER BY resolved_at DESC LIMIT 30`      |
| Win rate         | `count(*) FILTER (WHERE won) / count(*)` over last 30                                                                         |
| Avg R-multiple   | `AVG(r_multiple)` over last 30 (joined to trades for the actual R)                                                            |
| Grade-A win rate | filter `grade = 'A'`, compute win rate. Need ≥ 10 A-grade for stat significance — show "Insufficient A-grade data" otherwise. |
| Max drawdown     | running min of `cumulative_pnl - running_max(cumulative_pnl)` over last 30                                                    |

### Sports

| Metric              | SQL sketch                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| Sample size         | last 50 resolved Green-tier picks                                                              |
| Green-tier win rate | `count(*) FILTER (WHERE won) / count(*)` for last 50 where tier='green'                        |
| ROI on Green        | `SUM(actual_pnl) / SUM(stake)` (stake = $100 flat for paper, or kelly_pct × bankroll for live) |
| AI 7+ calibration   | filter `ai_rating >= 7`, compute win rate                                                      |
| Max drawdown        | running min over last 50                                                                       |

---

## `/calibration` page layout

Two columns side-by-side (collapses to stack on mobile per Tailwind responsive defaults):

### Left column: Trading

1. **Status banner**
   - Mode chip: `PAPER` (orange) / `LIVE` (green, pulsing)
   - "Gate: 4/5 thresholds met — 1 to go" / "Gate: OPEN — ready to go live"
   - Big button: `→ Go Live` (disabled until gate open) or `← Back to Paper` (always enabled if currently live)
2. **Threshold table:** 5 rows, current value vs threshold, ✓ or ✗ per row
3. **Hit rate by grade** (vertical bar chart, shadcn/ui Chart):
   - X-axis: A / B+ / B / C
   - Y-axis: win rate %
   - Reference line at 50%
4. **Calibration plot** (scatter or bar):
   - X-axis: confidence bucket (1-3, 4-6, 7-8, 9-10)
   - Y-axis: actual win rate
   - Diagonal reference line: perfect calibration
5. **Equity curve** (line chart):
   - Cumulative P&L over time
   - Drawdown shaded in red
6. **Last 10 settled predictions table** (compact)

### Right column: Sports

Identical structure, sports metrics. Plus:

7. **League performance mini-table** (extra section):
   - Each league with ≥ 5 bets: bets / wins / win rate / ROI
   - Highlight leagues where ROI < 0 (suggest exclusion)

### Bottom: Threshold editor

Collapsible. Per domain:

- 5 number inputs for the thresholds
- "Save" button → `PATCH /api/trust-state/{domain}/thresholds`
- Confirmation modal: "Tightening thresholds is safe. Loosening thresholds while in PAPER is safe. Loosening while LIVE will be flagged in agent_events."

---

## API endpoints

### `POST /api/trust-state/[domain]/flip-mode`

Body: `{ to_mode: 'live' | 'paper', confirmation: string }`

- Authenticated only (`auth.getUser`).
- If `to_mode = 'live'`: must call `evaluateGate(domain)` and confirm `gate_status === 'open'`. Else 403.
- If `to_mode = 'paper'`: always allowed (defensive).
- Updates `trust_state.current_mode`, `flipped_to_live_at`, `flipped_to_live_by`.
- Logs `trust_state_flipped` event to `agent_events` with old/new mode + reason.
- Returns `GateEvaluation` after flip.

### `PATCH /api/trust-state/[domain]/thresholds`

Body: `{ min_sample_size?, win_rate_threshold?, ... }`

- Authenticated.
- Zod validation — each value within sane bounds (e.g., win_rate ∈ [0.4, 0.8]).
- Updates `trust_state` row.
- Logs `trust_thresholds_updated` to `agent_events` with diff.
- If currently `live` and any threshold loosened, includes `loosened_while_live: true` in event.
- Returns updated `trust_state`.

### `GET /api/trust-state` (and `/api/trust-state/[domain]`)

- Authenticated read.
- Returns full `GateEvaluation` for each domain (or specific one).

---

## Tests required

### Unit

- `tests/trust/gate.test.ts`:
  - All 5 thresholds met → `gate_status='open'`
  - Any 1 threshold unmet → `gate_status='closed'`, correct failure listed
  - Insufficient sample → `gate_status='closed'`, `sample_size.pass=false`
  - flipToLive when gate closed → throws
  - flipToPaper always succeeds
- `tests/calibration/metrics.test.ts`:
  - Hit rate by grade with mixed predictions
  - Calibration: high-confidence picks must be high win rate to pass
  - Drawdown calculation against synthetic equity curve

### Integration

- `tests/api/trust-state/flip-mode.test.ts`:
  - Reject flip-to-live with closed gate (403)
  - Accept flip-to-live with open gate
  - Allow flip-to-paper anytime
  - Logs to agent_events
- `tests/api/trust-state/thresholds.test.ts`:
  - Validation: invalid range rejected
  - Loosen-while-live flag set correctly

### E2E

- `/calibration` renders with seeded data
- Click "Go Live" with closed gate → error toast
- Click "Go Live" with open gate → confirmation modal → flip succeeds → mode chip updates

---

## Acceptance criteria

### AC-D1: Page renders for both domains with seeded data

Page loads, both columns visible, all sections render or show "Insufficient data" cleanly.

### AC-D2: Gate evaluation matches manual calculation

For trading with mocked 30 trades (specific win/loss/R pattern), `evaluateGate('trading')` returns metrics matching hand calc. Same for sports with 50 picks.

### AC-D3: Go Live blocked until gate open

With `gate_status='closed'`, button is disabled. Bypass attempt via direct POST returns 403. With `gate_status='open'`, button enables.

### AC-D4: Mode flip persists and propagates

After flip to live: `trust_state.current_mode='live'`, `flipped_to_live_at` set, `agent_events` row written. New predictions inserted after flip have `mode='live'` (chunks B/C respect this).

### AC-D5: Threshold editor updates state

PATCH a threshold (e.g., win_rate 0.55 → 0.58). Page refresh shows new value. Gate re-evaluates against new value.

### AC-D6: Loosen-while-live flagged

Flip to live, then PATCH win_rate down (loosen). `agent_events` row has `loosened_while_live: true`. (Per F18 — surface this in morning_digest later.)

### AC-D7: Recompute on resolve

POST to `/api/predictions/[id]/resolve` triggers `recomputeTrustState`. `trust_state.last_recomputed_at` updates. `current_*` fields reflect the new prediction.

### AC-D8: F22 / F-N5 / F20 compliance

- No cron routes here, so F22 N/A
- F-N5: all routes call `auth.getUser`
- F20: no inline `style={}`, components use shadcn/Tailwind

### AC-D9: Architecture invariant tests pass

F-N5 architecture coverage test still passes. New endpoints added to the auth-required list.

---

## What "good enough" looks like at first run

After chunks A+B+C have run for **2 weeks**:

- Trading: 10–20 settled trades. Most thresholds say "insufficient data". Page shows progress bars: "20/30 trades to evaluate."
- Sports: 30–50 settled bets (more games per day). One or two thresholds may be evaluable.
- Both domains: `gate_status='closed'`, `current_mode='paper'`.

After **6–8 weeks**:

- Trading: 30+ settled trades. Real evaluation. Maybe 2/5 or 3/5 thresholds green.
- Sports: 50+ settled bets. Real evaluation. Calibration plots start showing meaningful shape.
- Adjustments to thresholds happen. Maybe one tier crosses, the other doesn't.

After **3–4 months**:

- Either an honest reckoning that the AI isn't profitable yet (and we tighten or rebuild scoring), OR one domain is consistently above thresholds and you press the button.

The whole point of this module is that pressing the button is not aspirational — it's earned.

---

## Open questions for Colin

1. **Drawdown reset on flip** — when you flip from live back to paper, does drawdown counter reset? (Recommend yes — drawdown is a paper-period metric.)
2. **Threshold editing audit** — every change visible in agent_events. Do you also want a daily/weekly digest line summarizing threshold changes? (Recommend yes via morning_digest.)
3. **Multi-mode view** — for predictions made in `paper` and predictions made in `live`, separate calibration view, or combined? (Recommend separate — paper performance ≠ live performance once Colin's emotion is in play.)
4. **"Cool-off" period** — after flip to live, lock thresholds for 30 days so you can't loosen out of a drawdown? (Recommend optional — you're an adult, but the option to self-bind is useful.)
