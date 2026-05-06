# Acceptance Doc — Payouts (gap-fill)

**Source:** `streamlit_app/pages/17_Payouts.py` (~212 LOC, P1 Low complexity)
**LepiOS target:** `app/(cockpit)/payouts/page.tsx` + `_components/PayoutsPage.tsx` (already shipped)
**API:** `app/api/payouts/route.ts` (already shipped)
**Status:** **~95% parity. Ship as is + 1 tiny gap-fill PR.**

---

## What's already live

LepiOS Payouts page is **more complete than Streamlit** in several dimensions:

- 5 KPI cards (Streamlit has 4): Gross Revenue, Amazon Fees, Refunds, **Reimbursements** (LepiOS-only), Net Payout
- Effective fee rate (%) and net margin (%) — derived metrics Streamlit doesn't show
- Year selector toggle (current + 3 prior years); Streamlit is hardcoded to current year
- Settlement detail expander with `fund_transfer_status` per row (SUCCESSFUL, PENDING, etc.)
- Reconciliation metrics logged to `agent_events` after every cron sync (`orders_matched / orders_total`)
- Cron sync route with `?dry_run=true` and `?backfill=N` admin params
- Reusable `AmazonSettlementsPanel` for dashboard embedding

---

## What Streamlit has that LepiOS doesn't

| Streamlit feature                             | LepiOS status | Severity          | Decision                                                                                                                                                |
| --------------------------------------------- | ------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual payout entry form                      | Missing       | **DROP**          | Streamlit's form exists to catch sync failures. LepiOS's cron is more reliable. If a settlement is missing, run `?backfill=365`, don't type it by hand. |
| Notes / audit trail per payout                | Missing       | **P1 — gap-fill** | Used to record "matches Seller Central disbursement #X" or "manual correction reason". Audit-grade requirement.                                         |
| Expected vs Actual variance (Amount Expected) | Missing       | **DEFER**         | Streamlit derives expected payout from a daily P&L sheet that doesn't exist in LepiOS. Wire up later if/when daily P&L view ships.                      |
| Account field (TD Bank / Other)               | Missing       | **DEFER**         | Multi-account reconciliation is rare; defer until needed.                                                                                               |
| Refresh button                                | Missing       | **WONTFIX**       | Page reload achieves the same.                                                                                                                          |
| "How Amazon payouts work" inline help         | Missing       | **P3 — optional** | Educational text about 14-day cycles, reserves. Could ship as a `<HelpPopover>` on the page header.                                                     |

---

## Acceptance criteria (gap-fill PR)

**Scope:** Add a `notes` column to settlements + read/edit UX in Settlement Detail.

### AC1 — Schema migration

New migration `supabase/migrations/0XXX_amazon_settlements_notes.sql`:

```sql
ALTER TABLE amazon_settlements
  ADD COLUMN notes text NULL;

COMMENT ON COLUMN amazon_settlements.notes IS
  'Free-text audit trail. Used for matching to Seller Central disbursement IDs, manual corrections, or operator memos. Nullable.';
```

No backfill required (all existing rows get `NULL`).

### AC2 — API: PATCH endpoint

New route `app/api/payouts/[id]/notes/route.ts`:

- `PATCH /api/payouts/{id}/notes` body: `{ notes: string | null }`
- Auth: `auth.getUser()` required (per F-N5 invariant)
- Updates `amazon_settlements.notes` for the row matching `id`
- Returns updated row or 404 if not found
- Notes capped at 500 chars; trim whitespace; treat empty string as `null`

### AC3 — UI: editable notes in Settlement Detail

In `PayoutsPage.tsx`'s Settlement Detail expander:

- Add a "Notes" column rendered as inline-editable `<input type="text">`
- On blur (or Enter key), call PATCH endpoint
- Optimistic update: show new value immediately; revert + flash error on failure
- Empty input clears the field

### AC4 — Tests

- API: PATCH happy path, 401 unauthorized, 404 not found, 400 oversized notes (>500 chars)
- Migration: column exists, nullable, no default
- Component: notes editable, optimistic update, error revert

---

## Open question for Colin

**Q1 — "How Amazon payouts work" inline help (P3):** worth porting? Streamlit has a paragraph explaining 14-day cycles, reserves, processing lag, and Seller Central navigation. Ship as a `<HelpPopover>` icon next to the page title (~20 LOC), or skip?

Default if no answer: skip.

---

## Estimated build time

**~2 hours** in one builder window. Tiny migration + tiny route + small UI change.

---

## What Colin should answer

- Q1: ship help popover? **y / n / skip**

If skip: this doc IS the spec. Builder picks it up directly.
