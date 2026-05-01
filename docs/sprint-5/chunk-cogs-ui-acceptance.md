# COGS UI — acceptance criteria

**Status: approved 2026-04-30**

## Component

#2 COGS UI — weight 6, currently 0%. Builds on PR #42 (backend, merged).

## Scope

- app/(cockpit)/cogs/page.tsx — server component, auth-gated
- app/(cockpit)/cogs/\_components/CogsEntryForm.tsx — client form, calls saveCogsEntry
- app/(cockpit)/cogs/\_components/CogsTable.tsx — recent entries + per-ASIN summary
- Nav entry in CockpitNav.tsx

## Out of scope

- Bulk CSV import (follow-up)
- Edit/delete existing entries (follow-up)
- Receipt OCR ingestion (separate component)
- Sellerboard import (separate component)
- Per-ASIN drill-down page (follow-up)

## Acceptance criteria

- AC-1: /cogs renders for authenticated users; redirects to /login otherwise
- AC-2: Page shows entry form (top) + recent entries table (bottom) + per-ASIN summary panel
- AC-3: Form fields — asin, pricing_model (radio: per_unit|pallet), unit_cost_cad (shown only when per_unit), quantity, total_cost_cad (shown only when pallet), purchased_at (date input, defaults today), vendor, notes
- AC-4: Form validates client-side before submit; server validation errors surface inline
- AC-5: On successful submit, form clears, table refreshes (revalidatePath or router.refresh)
- AC-6: Table shows last 50 entries by purchased_at desc with: date, asin, pricing model, unit cost or total, quantity, vendor
- AC-7: Per-ASIN summary shows asins with entries, weighted avg unit cost, latest unit cost, total quantity, entry count, pallet flag
- AC-8: Empty states — table shows "no entries yet" message, summary shows "no asins tracked yet"
- AC-9: Nav link "COGS" added to CockpitNav between Business Review and Utility
- AC-10: F20 — no ad-hoc inline style on form/table components; page-level scaffold style={} matches existing cockpit pages
- AC-11: F18 surfacing — page itself is the surfacing path; no separate metric needed for v1

## Open questions

- Q1: Should the table paginate or just show 50 rows? Propose: 50 rows v1, pagination follow-up.
- Q2: Should the form support keyboard shortcuts (Enter to submit, Esc to clear)? Propose: skip v1.
- Q3: Show GST split column in table? Propose: skip v1 — GST module isn't merged yet (#39 open).

## Tests

- Existing tests on main stay green
- New tests: skip for UI v1 — manual verification path documented in PR body
