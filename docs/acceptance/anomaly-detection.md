# Acceptance Doc — Anomaly Detection (Row 17)

Component: #17 · Weight: 8 · Current: 0%
Date: 2026-05-02
Author: Coordinator (draft for Colin review)
Branch: TBD (create `acceptance/row17-anomaly-detection` from main before builder picks up)

**Builder gate:** Do not start until `reconciled_orders_view` (migration 0063, row 11) is
live in production. The entire scan depends on that view. Builder should verify the view
exists with `SELECT 1 FROM reconciled_orders_view LIMIT 1` before writing any scan logic.

---

## Purpose

Surface Amazon pipeline integrity anomalies the moment they are detectable — before they
compound into month-end bookkeeping surprises.

The pipeline currently ingests orders, financial events, COGS, and settlements correctly
but has no layer that asks "do these agree?" Row 11 (reconciliation engine) answers what
_is_ — row 17 answers what _shouldn't be_. Together they close the trust loop:
reconciled_orders_view is the structured truth; the anomaly scan is the daily alarm.

**What Colin gets:** Each morning, the digest line either confirms "no anomalies" or lists
findings by type so he can act the same day rather than weeks later during bookkeeping.

---

## Input Data Sources — Grounded

All tables and views verified against `supabase/migrations/` on main as of 2026-05-02.

| Source                    | Migration                             | Role in this component                              |
| ------------------------- | ------------------------------------- | --------------------------------------------------- |
| `reconciled_orders_view`  | 0063 (planned; row 11 acceptance doc) | Primary scan target — all four anomaly rule queries |
| `amazon_settlements`      | 0036                                  | Settlement parity check (compare to view aggregate) |
| `amazon_financial_events` | 0057                                  | Joined inside the view; no direct query needed      |
| `agent_events`            | 0005                                  | Write target — scan summary + individual findings   |

**Not queried directly:** `orders`, `cogs_entries`, `cogs_per_asin_view` — these are
pre-joined inside `reconciled_orders_view`. The anomaly scanner treats the view as its
only read source for order-level checks.

**Key columns consumed from `reconciled_orders_view`:**

| Column               | Anomaly rule that uses it                |
| -------------------- | ---------------------------------------- |
| `match_status`       | no_event, no_cogs (rules 1 + 2)          |
| `first_order_date`   | no_event age filter (rule 1)             |
| `status` (via view)  | exclude Pending/Canceled from rule 1     |
| `revenue_delta_cad`  | revenue delta outliers (rule 3)          |
| `orders_revenue_cad` | revenue delta threshold scaling (rule 3) |
| `settlement_id`      | settlement parity — group by (rule 4)    |
| `event_gross_cad`    | settlement parity — aggregation (rule 4) |
| `event_fees_cad`     | settlement parity — aggregation (rule 4) |
| `event_refunds_cad`  | settlement parity — aggregation (rule 4) |

---

## Detection Rules — v1

Four rules. Each produces zero or more `anomaly.detected` events in `agent_events`.
All thresholds are constants in `lib/amazon/anomaly-scan.ts` — no env vars, no DB config.

### Rule 1 — Unmatched Orders (no_event)

```
SELECT amazon_order_id, first_order_date, orders_revenue_cad
FROM   reconciled_orders_view
WHERE  match_status = 'no_event'
  AND  first_order_date < now() - interval '7 days'
  AND  status NOT IN ('Pending', 'Canceled')
ORDER  BY first_order_date ASC
LIMIT  50
```

**Rationale:** A Shipped order placed more than 7 days ago should have a ShipmentEvent in
`amazon_financial_events`. Absence at day 7 is a genuine gap — either the SP-API backfill
missed it, or Amazon hasn't posted it yet (rare). False-positive rate is low; Pending and
Canceled orders are excluded.

| Threshold       | Value             | Open for Colin |
| --------------- | ----------------- | -------------- |
| Age cutoff      | 7 days            | Q1 below       |
| Max rows logged | 50 (oldest first) | fixed v1       |

**Severity:** `warning`. Each finding logged individually as `action = 'anomaly.detected'`.

---

### Rule 2 — Missing COGS (no_cogs)

```
SELECT amazon_order_id, first_order_date, orders_revenue_cad, asin_count
FROM   reconciled_orders_view
WHERE  match_status IN ('no_cogs', 'no_cogs_pallet')
ORDER  BY orders_revenue_cad DESC
LIMIT  50
```

**Rationale:** Any matched sale without COGS silently understates cost and overstates
profit. No age filter — even yesterday's sale with missing COGS should surface. High
revenue orders sorted first so the highest-impact gaps appear in the morning digest.

**`no_cogs_pallet`** is included: pallet-sourced ASINs have a different failure mode
(unit cost unknown) but the effect is the same — profit figure is untrustworthy.

| Threshold       | Value                      |
| --------------- | -------------------------- |
| Age cutoff      | none                       |
| Max rows logged | 50 (highest revenue first) |

**Severity:** `warning` for `no_cogs_pallet` (known gap type); `error` for `no_cogs`
(ASIN exists in cogs_per_asin_view but was not joined — unexpected).

---

### Rule 3 — Revenue Delta Outliers

```
SELECT amazon_order_id, orders_revenue_cad, event_gross_cad, revenue_delta_cad
FROM   reconciled_orders_view
WHERE  revenue_delta_cad IS NOT NULL
  AND  ABS(revenue_delta_cad) > GREATEST(2.00, 0.05 * orders_revenue_cad)
ORDER  BY ABS(revenue_delta_cad) DESC
LIMIT  25
```

**Rationale:** `revenue_delta_cad = orders_revenue_cad - event_gross_cad` captures the
gap between SP-API's ItemPrice (what we recorded at sync) and Amazon's financial event
gross (what Amazon actually recognized). Disagreements above $2 or 5% of order value
are material enough to investigate — currency rounding explains sub-$2 differences.

| Threshold       | Value                    | Open for Colin |
| --------------- | ------------------------ | -------------- |
| Absolute floor  | $2.00 CAD                | Q2 below       |
| Relative floor  | 5% of orders_revenue_cad | Q2 below       |
| Max rows logged | 25 (largest delta first) | fixed v1       |

**Severity:** `warning` for deltas < $20 and < 20% of revenue; `error` for ≥ $20 or ≥ 20%.

---

### Rule 4 — Settlement Parity Gap

```
SELECT
  rov.settlement_id,
  SUM(rov.event_gross_cad)    AS view_gross,
  SUM(rov.event_fees_cad)     AS view_fees,
  SUM(rov.event_refunds_cad)  AS view_refunds,
  s.gross                     AS settlement_gross,
  s.fees_total                AS settlement_fees,
  s.refunds_total             AS settlement_refunds
FROM   reconciled_orders_view rov
JOIN   amazon_settlements     s ON s.id = rov.settlement_id
WHERE  s.fund_transfer_status = 'SUCCESSFUL'
  AND  s.skipped_event_types  IS NULL
GROUP  BY rov.settlement_id, s.gross, s.fees_total, s.refunds_total
HAVING ABS(
  (SUM(rov.event_gross_cad) + SUM(rov.event_fees_cad) + SUM(rov.event_refunds_cad))
  - (s.gross + s.fees_total + s.refunds_total)
) > 0.01
```

**Rationale:** For a fully-transferred settlement with no skipped event types, the sum of
line-item financial events must equal the settlement totals to within $0.01. A gap means
Amazon's payout detail doesn't add up — this is a fee calculation error or a missed event
type, not a rounding artifact.

Only `SUCCESSFUL` settlements with `skipped_event_types IS NULL` are checked. Settlements
with skipped types (e.g., AdjustmentEvents not yet parsed) are excluded — the gap is
expected and known.

| Threshold     | Value                |
| ------------- | -------------------- |
| Parity gap    | $0.01                |
| Skipped types | excluded (NULL only) |

**Severity:** `error` — any settlement parity gap is a material discrepancy.

---

## Deferred to v2

| Rule               | Why deferred                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Refund spike       | Needs ≥ 30 days of rolling baseline. SP-API backfill is 90 days but early data is sparse. Revisit after 6 months of steady ingestion. |
| Fee rate drift     | Same baseline requirement. `event_fees_cad / event_gross_cad` ratio needs stable mean before stddev is meaningful.                    |
| FBA reimbursements | `reimbursements_total_cad` is always NULL in v1 settlements (AdjustmentEvent not parsed). No data to scan yet.                        |
| ML-based detection | Out of scope until baseline anomaly counts are stable and labeled.                                                                    |

---

## Schema Proposal

**No new migrations required for v1.** The scanner reads `reconciled_orders_view` (0063)
and writes to `agent_events` (0005). Both already exist (or will after row 11 ships).

Next available migration slot if v2 needs a persistent anomaly history table: **0064**.

### agent_events write shape

Two action types:

**Per-finding (emitted once per anomaly):**

```ts
{
  domain: 'amazon',
  action: 'anomaly.detected',
  actor: 'cron',
  status: 'warning' | 'error',          // per-rule severity above
  input_summary: 'rule: no_event',       // rule name
  output_summary: '14 unmatched orders older than 7 days',
  meta: {
    rule: 'no_event' | 'no_cogs' | 'revenue_delta' | 'settlement_parity',
    count: number,
    details: AnomalyDetail[],            // up to 25 rows, typed per rule
    scan_id: string,                     // UUID linking to the scan.complete row
  }
}
```

**Per-scan summary (emitted once per run, after all rules):**

```ts
{
  domain: 'amazon',
  action: 'anomaly.scan.complete',
  actor: 'cron',
  status: 'success' | 'warning' | 'error',  // error if any rule produced error-severity finding
  input_summary: 'amazon anomaly scan',
  output_summary: '2 rules triggered, 17 findings',
  meta: {
    scan_id: string,                     // UUID generated at scan start
    rules_triggered: number,
    total_findings: number,
    no_event_count: number,
    no_cogs_count: number,
    revenue_delta_count: number,
    settlement_parity_count: number,
    duration_ms: number,
  }
}
```

`scan_id` is a `crypto.randomUUID()` generated at the start of each run. Individual
`anomaly.detected` rows reference it in `meta.scan_id` so a single scan's findings can
be queried as a group.

---

## New Files

| File                                        | Purpose                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `lib/amazon/anomaly-scan.ts`                | `runAnomalyScan(db)` — executes the four rules, writes agent_events, returns summary |
| `lib/amazon/anomaly-digest.ts`              | `buildAmazonAnomalyScanLine()` — F18 morning digest line                             |
| `app/api/cron/amazon-anomaly-scan/route.ts` | POST + GET endpoint, `requireCronSecret` auth (F22)                                  |

No new React components for v1. Anomaly data surfaces only through the digest line and
the Business Review tile (below).

---

## API Route

`POST /api/cron/amazon-anomaly-scan`

```ts
// app/api/cron/amazon-anomaly-scan/route.ts
import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { runAnomalyScan } from '@/lib/amazon/anomaly-scan'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized
  const db = createServiceClient()
  const result = await runAnomalyScan(db)
  return NextResponse.json({ ok: true, ...result })
}

export async function GET(request: Request) {
  return POST(request)
}
```

**Cron trigger:** night_tick, daily, after `/api/cron/amazon-financial-events` completes.
Order matters: financial events must be current before the anomaly scan runs. The night_tick
currently runs financial events and settlements — anomaly scan is added as the next step.
(Q3 resolved: daily is the v1 cadence. Inline-after-sync is v2.)

---

## Acceptance Criteria

Builder must pass all of the following before handoff. Each is deterministic —
no "it looks right" checks.

1. **Route responds correctly:**
   `POST /api/cron/amazon-anomaly-scan` with a valid `Authorization: Bearer $CRON_SECRET`
   header returns `{ ok: true, rules_triggered: N, total_findings: N }` with status 200.

2. **Route rejects missing auth:**
   Without the header, returns 401. Without the env var set, returns 500.
   (Both behaviours guaranteed by `requireCronSecret` — verify the helper is called, not
   a local `if (CRON_SECRET)` check. Grep `app/api/cron/amazon-anomaly-scan/route.ts`
   for `requireCronSecret` — fail if not found. F22 compliance.)

3. **No-event rule fires correctly:**
   Seed `agent_events` is not the data source. Using the test Supabase project, insert one
   row into `reconciled_orders_view`'s underlying tables where `match_status = 'no_event'`
   and `first_order_date = now() - interval '10 days'` and `status = 'Shipped'`.
   Run the scan. Confirm `agent_events` contains a row with `action = 'anomaly.detected'`
   and `meta->>'rule' = 'no_event'` and `meta->>'count' = '1'`.

4. **No-event age filter:**
   Insert a second `no_event` row with `first_order_date = now() - interval '3 days'`.
   Run the scan. Confirm only 1 `no_event` finding (the 10-day-old one) — the 3-day-old
   order is not flagged.

5. **Pending orders excluded:**
   Insert a `no_event` row with `first_order_date = now() - interval '10 days'` and
   `status = 'Pending'`. Confirm it does not appear in anomaly findings.

6. **Revenue delta threshold:**
   Insert a row with `revenue_delta_cad = 1.50` and `orders_revenue_cad = 100.00`.
   Confirm no finding (below both $2 and 5% thresholds).
   Insert a row with `revenue_delta_cad = 2.50` and `orders_revenue_cad = 100.00`.
   Confirm one `revenue_delta` finding.

7. **Settlement parity clean case:**
   Insert a settlement where event aggregates match settlement totals exactly.
   Confirm no `settlement_parity` finding.

8. **Settlement parity gap case:**
   Insert a settlement where SUM of event contributions differs from settlement totals by $0.02.
   Confirm one `settlement_parity` finding with `status = 'error'`.

9. **Scan summary logged:**
   After any run (even a run with 0 findings), confirm `agent_events` contains a row with
   `action = 'anomaly.scan.complete'` and `meta` containing `total_findings`, `scan_id`,
   `duration_ms`.

10. **scan_id links findings to summary:**
    When findings exist, confirm all `anomaly.detected` rows from the same run share the same
    `meta->>'scan_id'` value, and that value matches the `anomaly.scan.complete` row's
    `meta->>'scan_id'`.

11. **No inline secrets / no local auth check:**
    `grep -r "CRON_SECRET" app/api/cron/amazon-anomaly-scan/` must return 0 results (the
    check is inside `requireCronSecret`, not duplicated in the route).

12. **digest line:**
    `buildAmazonAnomalyScanLine()` called when no scan has run in 24h returns the string
    `'Anomaly scan: no run in last 24h'`. Called when a scan ran with 0 findings returns
    `'Anomaly scan (24h): no anomalies detected ✅'`. Called when findings exist returns a
    string containing the total findings count and at least one rule name.

---

## F18 Surfacing Path

**Morning digest line** — `lib/amazon/anomaly-digest.ts`:

```ts
export async function buildAmazonAnomalyScanLine(): Promise<string> {
  // Query: most recent anomaly.scan.complete in last 24h
  // If none: 'Anomaly scan: no run in last 24h'
  // If findings = 0: 'Anomaly scan (24h): no anomalies detected ✅'
  // If findings > 0: 'Anomaly scan (24h): N findings — X no_event, Y no_cogs, Z delta ⚠️'
  //   (error-severity findings: '❌' instead of '⚠️')
}
```

Added to `composeMorningDigest` in `lib/orchestrator/digest.ts` alongside
`buildAmazonOrdersSyncLine` and `buildAmazonSettlementsSyncLine`. One import, one `await`.

**Business Review tile (deferred):** Row 12 (Reconciliation UI) will add a drift report
panel that surfaces `anomaly.detected` events for the current period. That is out of scope
for this component — row 17 ships the detection layer; row 12 ships the UI layer.

**Colin can query findings directly:**

```sql
SELECT action, status, input_summary, output_summary, meta, occurred_at
FROM   agent_events
WHERE  action = 'anomaly.detected'
  AND  occurred_at > now() - interval '7 days'
ORDER  BY occurred_at DESC;
```

**Benchmark:** 0 anomaly findings on a settled period with complete COGS = pipeline fully
reconciled. If findings persist > 7 days for the same orders, that is the metric to surface
(stale anomaly pattern, not newly detected each day).

---

## Out of Scope for v1

| Topic                                    | Why deferred                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| Refund spike detection                   | Needs 30-day rolling baseline — insufficient data volume yet              |
| Fee rate drift detection                 | Same baseline requirement                                                 |
| FBA reimbursement anomalies              | `AdjustmentEvent` not parsed; `reimbursements_total_cad` always NULL      |
| UI alert panel for anomaly findings      | Owned by row 12 (Reconciliation UI); row 17 is detection-only             |
| Telegram alert on error-severity finding | night_tick → morning_digest is the v1 delivery path; direct alerts are v2 |
| ML-based detection                       | Not in scope until labeled anomaly history accumulates                    |
| Alerting beyond morning_digest           | Same: v2 when alert taxonomy is defined                                   |
| Historical anomaly scan backfill         | Scan runs forward from deployment; no retroactive backfill                |

---

## Decisions

### Resolved

**No new tables for v1: RESOLVED**
All output goes to `agent_events`. This is sufficient for morning_digest and for Colin to
query findings directly. A persistent `anomaly_runs` table (next slot: 0064) becomes
necessary only if trending queries (e.g., "anomaly count this week vs. last week") are
slow against `agent_events`. Defer until that performance problem is observed.

**Severity taxonomy: RESOLVED**
Two levels: `warning` (worth knowing; investigate when convenient) and `error` (material
discrepancy; act today). No `info` level in v1 — every finding is surfaced or it isn't.
Mapped to `agent_events.status` CHECK constraint (`'success'` unused for anomaly rows;
`'warning'` and `'error'` match the existing constraint).

**Builder gate on row 11: RESOLVED**
Builder cannot start coding until `reconciled_orders_view` is live in production. The
acceptance criteria explicitly require the view to exist. If row 11 and row 17 are
submitted to builder at the same time, row 11 must ship first.

### Resolved 2026-05-02

**Q1 — No-event age cutoff: RESOLVED**
7 days. ShipmentEvents post within 48h of ship confirmation; 7 days gives a 5-day buffer
before flagging. Builder hardcodes `interval '7 days'` in rule 1.

**Q2 — Revenue delta thresholds: RESOLVED**
`GREATEST(2.00, 0.05 * orders_revenue_cad)`. $2 floor for small orders; 5% floor for large
orders. Builder hardcodes both constants in `lib/amazon/anomaly-scan.ts` as named exports
(`NO_EVENT_AGE_DAYS = 7`, `DELTA_FLOOR_CAD = 2.00`, `DELTA_FLOOR_PCT = 0.05`) so they
are findable and testable without env vars.

**Q3 — Cron trigger cadence: RESOLVED**
Daily via night_tick. Anomaly findings are never more than 24h stale, which is acceptable
for the morning_digest delivery model. Inline-after-sync is v2 if same-day detection
becomes a requirement.

**Q4 — Stale anomaly handling: RESOLVED**
Report every time (v1, simpler). A persistent `no_event` order appearing in 5 consecutive
digest lines is itself a signal: the order is genuinely unresolved. Colin knows it is stale
because it keeps appearing. Deduplication via first-seen suppression is v2 if the digest
becomes noisy.

---

## 20% Better Over Streamlit Baseline

Streamlit has no anomaly detection module — zero. The current process is:

- Colin notices a discrepancy during monthly bookkeeping (weeks after the issue)
- Or it appears as a COGS mismatch when downloading a settlement report from Seller Central
- No systematic scan exists

Concrete improvements this component delivers:

1. **Same-day detection** — ShipmentEvent gaps and COGS holes surface the morning after
   settlement posts, not 3–6 weeks later when bookkeeping catches up.

2. **Revenue delta catch** — SP-API vs. financial event disagreements were previously
   invisible (no join existed). Even if small, systematic delta patterns indicate data
   quality problems in the sync.

3. **Settlement parity guarantee** — currently requires manual Excel reconciliation against
   the downloaded settlement report. This is automated and runs daily.

4. **Sorted by impact** — no_cogs findings are sorted by revenue (highest first), so the
   largest profit-distortion gaps surface in the digest before smaller ones.

5. **Feeds row 12** — the Reconciliation UI (row 12) will visualize anomaly history as a
   time series. The detection events are the raw material; this component ships them.
