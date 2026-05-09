-- Migration 0169: receipts_v2
--
-- Additive columns for the Receipts port:
--   ocr_source  — tracks how OCR data was obtained ('manual', 'claude_vision', 'email_import')
--   vendor_key  — normalized vendor name (alphanumeric lowercase) for dedup and vendor memory
--
-- Both columns are nullable with defaults, fully reversible.

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS ocr_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (ocr_source IN ('manual', 'claude_vision', 'email_import')),
  ADD COLUMN IF NOT EXISTS vendor_key TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN public.receipts.ocr_source IS
  'How OCR data was obtained: manual (user-entered), claude_vision (API), email_import (gmail sync).';

COMMENT ON COLUMN public.receipts.vendor_key IS
  'Normalized vendor name: lowercase alphanumeric only. Used for dedup detection and vendor memory lookups.';

CREATE INDEX IF NOT EXISTS receipts_vendor_key_idx ON public.receipts (vendor_key);
