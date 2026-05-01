# COGS v2 — Inventory + Pallet Invoices

**Status: approved 2026-04-30**

## Components shipped
- #2 COGS UI → repurposed as /pallets (monthly invoice tracking)
- New: /inventory (live FBA + per-ASIN cost layers + FIFO total value)
- Schema: pallet_invoices table

## Out of scope
- Reconciliation engine (#11) — query-time FIFO used instead
- Receipt OCR (separate component)
- Sale-time FIFO consumption (post-reconciliation)
- Bulk CSV import (Sellerboard skipped per Colin)

## Schema changes
Migration 0060_pallet_invoices.sql:
- pallet_invoices table: id, invoice_month (DATE, first of month), vendor, pallets_count INT, total_cost_incl_gst NUMERIC(12,2), gst_amount NUMERIC(12,2), notes, created_at
- RLS enabled, service_role-only (matches post-0050 pattern)

Migration 0061_cogs_drop_pallet_mode.sql:
- ALTER cogs_entries: drop CHECK constraint allowing pricing_model='pallet' (keep column for now, all new entries are per_unit)
- No data migration — existing pallet entries (likely zero) stay valid historically

## /pallets page (replaces /cogs)
- AC-P1: Auth-gated, redirects /login if unauth
- AC-P2: Form for monthly pallet invoice — month picker, vendor, pallets count, total cost (incl GST), GST amount (auto-split: 5% of pre-GST = total/1.05*0.05, editable), notes
- AC-P3: Table of recent invoices, last 24 months
- AC-P4: Total spend tile — last 12 months pallet spend
- AC-P5: Nav rename: "COGS" → "Pallets"

## /inventory page (new)
- AC-I1: Auth-gated
- AC-I2: Server-fetches FBA inventory via lib/amazon/inventory.ts (extended) on page load
- AC-I3: Two-column table — left: asin, sku, title, fulfillable_qty; right: cost input ($0 default), entries history link
- AC-I4: Saving a cost = creates new cogs_entries row (source='manual', pricing_model='per_unit')
- AC-I5: FIFO total value calculated query-time: for each ASIN, sum unit_cost_cad × min(quantity, remaining_fulfillable) walking entries oldest→newest until fulfillable_qty exhausted
- AC-I6: Total inventory value tile at top
- AC-I7: Books (ASIN starts with a digit, ISBN format) shown but excluded from total value calc. Non-books (ASIN starts with letter, e.g. B0*) included in total value calc.
- AC-I8: Nav: "Inventory" between Lists and Autonomous

## Lib changes
- lib/amazon/inventory.ts: add fetchFbaInventoryDetailed() returning per-ASIN array (asin, sku, fulfillable_quantity, product_name?). Existing fetchFbaInventory() unchanged.
- New lib/cogs/fifo.ts: computeInventoryValue(entries, fulfillableQuantitiesByAsin) → { total, byAsin }
- New lib/pallets/types.ts + validation.ts + queries.ts

## Tests
- lib/cogs/fifo.ts: unit tests for FIFO walk (single layer, multi layer, partial consumption, zero stock)
- lib/pallets/queries.ts: schema validation tests
- Skip page-level tests (manual grounding)

## F18 surfacing
- /inventory total value tile = the surfacing path
- /pallets last-12-months tile = the surfacing path
- No separate metrics endpoint v1

## F20
- Page-scaffold style={} ok (matches existing pattern)
- Form/table components also use style={} with CSS custom properties — match existing UtilityEntryForm/CogsEntryForm pattern. Do not introduce Tailwind.

## Migration numbering verified

- 0058 = gmail_daily_scan_runs (PR #44 open)
- 0059 = langfuse (feature/langfuse-observability open)
- 0060/0061 free
