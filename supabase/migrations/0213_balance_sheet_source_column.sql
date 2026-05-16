-- 0213_balance_sheet_source_column.sql
-- Adds 'source' column to balance_sheet_entries: 'manual' | 'auto_sync'.
-- Auto-sync rows (amazon, inventory categories) are updated by the daily cron
-- /api/cron/net-worth-sync — not by Colin's UI edits.
-- Also ensures service_role has write access (F24 grant — table predates the GRANT pattern).

-- 1. Add source column if absent
ALTER TABLE public.balance_sheet_entries
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'auto_sync'));

COMMENT ON COLUMN public.balance_sheet_entries.source IS
  'Origin of balance value: manual (user-edited via /balance-sheet), '
  'auto_sync (updated by daily net-worth-sync cron from amazon_settlements or inventory_snapshots). '
  'Auto-sync rows cannot be overridden by PATCH without explicitly passing source=manual.';

-- 2. Mark the amazon and inventory rows as auto_sync (retroactive).
-- These categories are confirmed in the acceptance doc as auto-managed.
UPDATE public.balance_sheet_entries
  SET source = 'auto_sync'
  WHERE category IN ('amazon', 'inventory');

-- 3. Ensure service_role has write access (F24 grant).
-- balance_sheet_entries was created before the migration GRANT pattern was established.
-- Apply grants if missing.
GRANT INSERT, UPDATE, DELETE ON public.balance_sheet_entries TO service_role;

COMMENT ON TABLE public.balance_sheet_entries IS
  'One row per balance sheet line item. account_type: asset | liability. '
  'Equity rows (retained_earnings, etc.) are intentionally excluded — they are accounting balances, not wealth. '
  'source=auto_sync rows are maintained by the daily net-worth-sync cron; do not manually patch them. '
  'Edit via PATCH /api/balance-sheet (source=manual) or Add/Delete via POST/DELETE /api/balance-sheet.';
