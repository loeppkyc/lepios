# E9 — Vehicle Tracker: Corolla Net Worth Row + Tesla Loan History

**task_id:** `abdf87d5-836f-462a-9620-6be0ce46766b`
**Coordinator run_id:** `f265e5dd-f8c0-4c70-bf9a-596420d11cb6`
**Written:** 2026-05-17
**Status:** awaiting-colin-approval (canonical write + open questions)

---

## Scope

Two migration deliverables + one UI enhancement to the existing `/vehicles` page.

**Acceptance criterion:** After migration, `SELECT balance FROM balance_sheet_entries WHERE
name ILIKE '%Corolla%'` returns a non-zero asset row; the "Tesla Loan" notes include CIBC
reference details; and the /vehicles page shows a Loan History section on each VehicleCard
(lender + original amount + payoff date when applicable).

---

## Check-Before-Build Findings

| Item | Status | Notes |
|------|--------|-------|
| `/vehicles` page | **EXISTS** | `VehiclesPage.tsx` — cards, maintenance log, AI valuation, km stats |
| `vehicles` table | **EXISTS** | Both Tesla + Corolla seeded (migration 0137) |
| `vehicle_maintenance` table | **EXISTS** | Full maintenance log working |
| `balance_sheet_entries` — Tesla | **EXISTS** | "2022 Tesla (Vehicle)" asset at $39,500 (sort_order=16) |
| `balance_sheet_entries` — Tesla Loan | **EXISTS** | "Tesla Loan" liability at $0, paid off 2026-05-06 (sort_order=31) |
| `balance_sheet_entries` — Corolla | **MISSING** | No asset row for the Corolla |
| Loan detail fields on vehicles | **MISSING** | No `loan_lender`, `loan_original_amount`, `loan_payment_amount`, `loan_payment_cadence`, `loan_start_date` |
| Behavioral km signal | **MISSING** | No writes to agent_events on km update |
| Signals table | **MISSING** | No separate signals infrastructure; agent_events is the destination |

---

## Pivot Signal on Deliverable 2

**Task as written:** "Add Tesla CIBC loan as liability row ($22,108.50 as of Feb 2026,
biweekly $211.71)"

**Current DB state:** "Tesla Loan" already exists in `balance_sheet_entries` at `balance=0`
(paid off 2026-05-06). The $22,108.50 was the Feb 2026 balance; the loan is now closed.

**Proposed resolution:** Instead of inserting a new liability row (already exists), update the
existing "Tesla Loan" notes to add CIBC lender name, original balance, and payment history
details. Requires Colin's confirmation that the existing $0 entry is the correct artifact
(not a separate CIBC entry that should remain at the Feb 2026 balance for historical accuracy).

---

## Out of Scope

- Fixing pre-existing `style={}` F20 violations in VehiclesPage.tsx (pervasive, pre-existing)
- Automated vehicle valuation sync (separate feature, referenced in existing balance_sheet notes)
- /mileage page (CRA deduction tracking — separate module, already ported)
- Adding full amortization schedule (both loans are paid off; payoff history suffices)

---

## Files Expected to Change

**Migration (one file):**
- `supabase/migrations/0237_vehicle_tracker_e9.sql`

**Application code:**
- `app/api/vehicles-data/route.ts` — add agent_events write on km PATCH (behavioral signal)
- `app/(cockpit)/vehicles/_components/VehiclesPage.tsx` — add Loan History row to VehicleCard

---

## What the Migration Does

```sql
-- (1) Set Corolla current value in vehicles table
UPDATE vehicles
SET current_value_estimate = <COLIN_CONFIRMS_VALUE>,
    current_value_source = 'manual',
    current_value_updated_at = NOW()
WHERE make = 'Toyota' AND model = 'Corolla';

-- (2) Insert Corolla balance_sheet_entries row
INSERT INTO balance_sheet_entries
  (name, account_type, category, balance, as_of_date, source, sort_order, currency, notes)
SELECT
  '2021 Toyota Corolla (Vehicle)',
  'asset',
  'equipment',
  <COLIN_CONFIRMS_VALUE>,
  '2026-05-17',
  'manual',
  17,
  'CAD',
  '2021 Corolla LE. Personal vehicle. ~194k km as of May 2026. Edit current value on /vehicles to update.'
WHERE NOT EXISTS (
  SELECT 1 FROM balance_sheet_entries WHERE name = '2021 Toyota Corolla (Vehicle)'
);

-- (3) Add loan detail columns to vehicles table
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS loan_lender text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS loan_original_amount numeric(12,2);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS loan_payment_amount numeric(10,2);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS loan_payment_cadence text; -- 'biweekly' | 'monthly' | null

-- (4) Seed Tesla loan details
UPDATE vehicles
SET loan_lender = 'CIBC',
    loan_original_amount = 22108.50,
    loan_payment_amount = 211.71,
    loan_payment_cadence = 'biweekly'
WHERE make = 'Tesla' AND model = 'Model Y';

-- (5) Update Tesla Loan balance_sheet_entries notes
UPDATE balance_sheet_entries
SET notes = 'CIBC loan. Paid off 2026-05-06. Original balance approx. $22,108.50 as of Feb 2026. Biweekly payments of $211.71.'
WHERE name = 'Tesla Loan';

GRANT INSERT, UPDATE, DELETE ON vehicles TO service_role; -- additive, idempotent
```

---

## UI Enhancement: Loan History Row

Add a `Loan Details` section to `VehicleCard` in `VehiclesPage.tsx`, visible only when
`v.loan_lender` is set. Shows:
- Lender name
- Original amount (formatted)
- Payment: "$211.71 biweekly" or similar
- Status badge: "✓ PAID OFF {date}" or "ACTIVE – {loan_remaining} remaining"

The VehiclesPage.tsx PATCH endpoint also gets an `agent_events` INSERT on each km save:
```json
{
  "domain": "vehicles",
  "action": "vehicle_km_signal",
  "actor": "user",
  "status": "success",
  "meta": { "vehicle_id": "...", "km_per_month": ..., "current_km": ..., "vehicle_name": "..." }
}
```

This satisfies F17 (behavioral ingestion: km/month → travel signal) and F18 (metric captured
in agent_events; benchmark: compare km/month across periods to detect usage changes).

---

## Grounding Checkpoint

```sql
-- Corolla asset row present
SELECT name, balance, as_of_date FROM balance_sheet_entries WHERE name = '2021 Toyota Corolla (Vehicle)';
-- Expect: 1 row, balance = Colin-confirmed value, as_of_date = '2026-05-17'

-- Corolla vehicle estimate synced
SELECT current_value_estimate, current_value_source FROM vehicles WHERE make = 'Toyota' AND model = 'Corolla';
-- Expect: non-null, source = 'manual'

-- Tesla loan details
SELECT loan_lender, loan_original_amount, loan_payment_cadence FROM vehicles WHERE make = 'Tesla';
-- Expect: 'CIBC', 22108.50, 'biweekly'

-- Visit /vehicles — expect Loan Details section on Tesla card showing CIBC + paid off date
```

---

## Kill Signals

- If the "Tesla Loan" balance_sheet entry is discovered to be the wrong artifact (i.e., a
  separate CIBC-specific entry is needed at the Feb 2026 historical balance) → re-scope to
  preserve historical accounting accuracy
- If Colin wants full amortization schedule rather than payoff history → scope escalates
  to XL and requires a vehicle_loan_payments table

---

## Open Questions Requiring Colin's Input

> Twin endpoint was unreachable during this coordinator session. All 5 questions must go to Colin.

**Q1 [BLOCKING for migration]:** What value should we record for the 2021 Toyota Corolla LE
in balance_sheet_entries? Task says "~$8-10K." Coordinator proposes **$8,500 CAD** as a
reasonable midpoint for a 2021 LE at 194k km in May 2026. Confirm or correct.

**Q2 [BLOCKING for migration]:** The "Tesla Loan" balance_sheet_entries row already exists at
$0 (paid off 2026-05-06). The $22,108.50 Feb 2026 balance is historical. Proposed action:
update the notes on the existing row to add CIBC lender name + original balance — NOT insert
a new liability row. Is the existing $0 row the correct artifact, or should we preserve a
historical $22,108.50 row alongside it?

**Q3 [Blocking for UI]:** Both vehicles' loans are paid off. Do you want:
(a) A "Loan History" section on VehicleCard showing lender + original amount + payoff date
    (adds 4 columns to vehicles table — reversible)
(b) Skip loan history — just update notes on Tesla Loan balance_sheet entry
(c) Something else?

**Q4 [Blocking for UI]:** Does the task require a separate odometer log table
(`vehicle_odometer_logs`) for tracking km readings over time, or is the existing
`current_km` field (updated manually) sufficient for v1?

**Q5 [Default = approve]:** OK to add `agent_events` write (domain='vehicles',
action='vehicle_km_signal') in the PATCH handler when km is updated? This is the F17
behavioral ingestion signal for km/month → travel pattern. Reversible — delete is
non-destructive.

---

## F17 Justification (Behavioral Ingestion)

km/month → travel signal in /signals:
- Signal: km driven per month per vehicle (already computed in vehicles API)
- Write path: PATCH /api/vehicles-data → INSERT INTO agent_events (vehicle_km_signal)
- Path probability contribution: driving pace → predicts fuel cost, vehicle usage, travel
  volume, potential maintenance timing. Feeds Health/Happy pillar (stress → driving patterns)

## F18 Measurement

- Metric: km_per_month per vehicle
- Benchmark: Colin's baseline driving rate (expected Tesla ~2,500-3,000 km/mo business use,
  Corolla lower personal use)
- Surfacing: /vehicles page already shows km_per_month stat; agent_events queryable by Colin
- Query: `SELECT meta->>'km_per_month' FROM agent_events WHERE action='vehicle_km_signal' ORDER BY occurred_at DESC LIMIT 2`

## GitHub Prior Art

No open-source solution needed. This is data migration + UI beef-up to existing `/vehicles`
page and `balance_sheet_entries` table. All infrastructure already in-repo.

---

## Cached-Principle Decisions

None auto-proceeded. This doc escalates to Colin because:
1. `balance_sheet_entries` is a user-visible money table — canonical write requires explicit approval
2. Twin unreachable — 5 questions cannot be answered by twin
3. Exact Corolla value is Colin's personal data decision

## Auto-Proceed Log Entry

```
2026-05-17T<time>Z sprint=E9 chunk=E9 doc=docs/backlog/tier-e/E9-vehicle-tracker-acceptance.md
cited_principles: [canonical_write_escalation, META-C]
trigger_match_evidence: |
  Coordinator.md Non-negotiable escalation: "canonical write about to happen — any write to
  a source-of-truth table (ledger, audit, tax, user-visible money)."
  balance_sheet_entries IS a user-visible money table (shown on /balance-sheet and /net-worth
  cockpit pages). This doc proposes INSERT + UPDATE to that table.
reversibility_check: |
  - balance_sheet_entries INSERT (Corolla row): reversible via DELETE
  - balance_sheet_entries UPDATE (Tesla Loan notes): reversible via UPDATE back to original notes
  - vehicles UPDATE (current_value_estimate): reversible via UPDATE to NULL
  - vehicles ALTER ADD COLUMN: reversible via ALTER DROP COLUMN
  - vehicles UPDATE (loan_lender/original_amount): reversible via UPDATE to NULL
  All reversible. But canonical write escalation is ALWAYS regardless of reversibility.
confidence: high (escalation warranted, no ambiguity)
outcome: escalated-to-colin (canonical write + twin unreachable + value decision)
```
