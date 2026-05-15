-- Migration 0204: receipt_lines + receipt_matches
-- Task: T-003 (91adca3c-06a5-4b69-8d9e-dd4e51b2a224)
-- Branch: harness/task-91adca3c-receipts-coordinator
-- Date: 2026-05-14
--
-- Adds two new tables for the structured receipts system:
--   receipt_lines  — one row per receipt document (replaces Google Sheets row)
--   receipt_matches — one-to-one match record between a receipt and a bank transaction
--
-- Note: bank_transactions table does not yet exist. transaction_id is stored as
-- TEXT (not UUID FK) until the bank_transactions migration lands. Add FK constraint
-- after that migration is applied.

-- ── receipt_lines ─────────────────────────────────────────────────────────────

CREATE TABLE public.receipt_lines (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  receipt_date      date        NOT NULL,
  vendor            text        NOT NULL,
  pre_tax           numeric(10,2),
  tax               numeric(10,2),
  total             numeric(10,2) NOT NULL,
  category          text,
  line_items        jsonb       DEFAULT '[]'::jsonb,
  source            text        NOT NULL CHECK (source IN ('gmail','upload','camera')),
  source_email_id   text        UNIQUE,  -- Gmail message ID; NULL for upload/camera. UNIQUE prevents duplicate imports.
  drive_url         text,               -- Google Drive link to original image/PDF
  ocr_model         text,               -- 'haiku' | 'sonnet' | 'regex'
  ocr_raw           jsonb,              -- full JSON returned by OCR call
  reconciled        boolean     NOT NULL DEFAULT false,
  notes             text
);

COMMENT ON TABLE public.receipt_lines IS 'Structured receipt records. One row per receipt document. Replaces Google Sheets 📸 Receipts tab.';
COMMENT ON COLUMN public.receipt_lines.source_email_id IS 'Gmail message ID for email-imported receipts. UNIQUE constraint prevents duplicate Gmail imports at DB level.';
COMMENT ON COLUMN public.receipt_lines.ocr_model IS 'Model used for OCR extraction: haiku, sonnet, or regex (regex pattern extraction without Vision API).';
COMMENT ON COLUMN public.receipt_lines.reconciled IS 'true when matched to a confirmed bank transaction via receipt_matches.';

-- F24: GRANT INSERT, UPDATE, DELETE on receipt_lines to service_role
GRANT INSERT, UPDATE, DELETE ON public.receipt_lines TO service_role;

-- RLS
ALTER TABLE public.receipt_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access" ON public.receipt_lines
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── receipt_matches ────────────────────────────────────────────────────────────

CREATE TABLE public.receipt_matches (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  receipt_id        uuid        NOT NULL REFERENCES public.receipt_lines(id) ON DELETE CASCADE,
  -- NOTE: transaction_id is TEXT pending bank_transactions migration.
  -- When bank_transactions table lands, add FK:
  --   ALTER TABLE public.receipt_matches
  --     ADD CONSTRAINT receipt_matches_txn_fk
  --     FOREIGN KEY (transaction_id) REFERENCES public.bank_transactions(id);
  transaction_id    text        NOT NULL,
  match_confidence  numeric(5,4) NOT NULL CHECK (match_confidence BETWEEN 0 AND 1),
  auto_confirmed    boolean     NOT NULL DEFAULT false,
  confirmed_at      timestamptz,
  confirmed_by      text        DEFAULT 'system'
);

COMMENT ON TABLE public.receipt_matches IS 'Match records linking receipt_lines to bank transactions. One confirmed match per receipt (enforced by unique index on receipt_id).';
COMMENT ON COLUMN public.receipt_matches.transaction_id IS 'Text ID of the matched bank transaction. Will become a FK to bank_transactions(id) once that table exists.';
COMMENT ON COLUMN public.receipt_matches.match_confidence IS 'Match confidence score 0.0000–1.0000. ≥0.92 = auto-confirmed by system. 0.70–0.91 = human review.';

-- F24: GRANT INSERT, UPDATE, DELETE on receipt_matches to service_role
GRANT INSERT, UPDATE, DELETE ON public.receipt_matches TO service_role;

-- RLS
ALTER TABLE public.receipt_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access" ON public.receipt_matches
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- One confirmed match per receipt
CREATE UNIQUE INDEX receipt_matches_receipt_unique ON public.receipt_matches(receipt_id);
