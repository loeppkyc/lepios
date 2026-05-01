# Pallet total cost gap (post-COGS-UI)

The COGS UI shipped without a way to record total pallet spend. Pallet entries currently capture ASIN + quantity + date + vendor, but no dollar amount.

## Impact
- weighted_avg_unit_cost in CogsPerAsin summary is wrong for any ASIN with pallet entries (those entries contribute zero cost)
- Reconciliation against settlements will under-count COGS for pallet-sourced inventory

## Fix
- Migration: add pallet_total_cost_cad NUMERIC(12,2) NULL to cogs_entries
- Update CogsEntryInsert + Zod schema
- Update form: when pricing_model='pallet', show total_cost field, hide unit_cost field
- Update lookup.ts: pallet entries contribute pallet_total_cost_cad / quantity to weighted avg

## Priority
Medium. Ship after current PRs merge. Block reconciliation engine (component #11) on this — reconciliation is meaningless until pallet costs are captured.
