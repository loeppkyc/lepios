-- Migration 0055: Gmail invoice + receipt classifier tables
-- Adds gmail_invoice_classifications and gmail_receipt_classifications
-- following the V1 statement-arrivals pattern (separate tables, scan_labels gating).
-- Also extends gmail_known_senders.created_by CHECK to include 'classifier'
-- so the learning loop can tag auto-discovered sender domains distinctly from
-- 'auto_detected' (which was the prior catch-all).
--
-- F19 upgrade over Streamlit: trust_level → confidence mapping
--   Streamlit had a flat domain list with no confidence levels.
--   These tables store confidence ('high'/'medium'/'low' for invoice,
--   'high'/'medium' for receipt) derived from gmail_known_senders.trust_level.
--
-- Access model: service_role only (RLS enabled, no policies).
-- All writers use createServiceClient() — same pattern as migration 0050.

-- ── Extend created_by CHECK on gmail_known_senders ────────────────────────────
-- Adds 'classifier' so the learning loop can tag newly-discovered domains
-- separately from 'auto_detected' (legacy) and 'colin_added' (manual).

ALTER TABLE public.gmail_known_senders
  DROP CONSTRAINT IF EXISTS gmail_known_senders_created_by_check;

ALTER TABLE public.gmail_known_senders
  ADD CONSTRAINT gmail_known_senders_created_by_check
  CHECK (created_by IN ('migrated_from_sheets', 'auto_detected', 'colin_added', 'classifier'));

-- ── gmail_invoice_classifications ─────────────────────────────────────────────
-- One row per classified invoice message.
-- attachment_name: first valid document attachment after junk-filter.
-- vendor_hint: display-name extracted from From header (pre-OCR best guess).
-- confidence derived from gmail_known_senders.trust_level:
--   trusted → high | review → medium | not in known_senders + keyword-only → low

CREATE TABLE public.gmail_invoice_classifications (
  message_id      text        PRIMARY KEY
                              REFERENCES public.gmail_messages(message_id) ON DELETE CASCADE,
  confidence      text        NOT NULL
                              CHECK (confidence IN ('high', 'medium', 'low')),
  attachment_name text,
  vendor_hint     text,
  classified_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gmail_invoice_classifications_confidence_idx
  ON public.gmail_invoice_classifications (confidence);
CREATE INDEX gmail_invoice_classifications_classified_at_idx
  ON public.gmail_invoice_classifications (classified_at DESC);

-- ── gmail_receipt_classifications ─────────────────────────────────────────────
-- One row per classified inline receipt message.
-- body_preview: first 200 chars (display/quick-scan).
-- body_text: up to 4000 chars — cached for downstream Claude extraction
--   so the extraction phase doesn't need to re-fetch from Gmail API.
-- confidence: high (trusted inline-receipt sender) | medium (keyword-only / review sender)

CREATE TABLE public.gmail_receipt_classifications (
  message_id      text        PRIMARY KEY
                              REFERENCES public.gmail_messages(message_id) ON DELETE CASCADE,
  confidence      text        NOT NULL
                              CHECK (confidence IN ('high', 'medium')),
  vendor_hint     text,
  body_preview    text,
  body_text       text,
  classified_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gmail_receipt_classifications_confidence_idx
  ON public.gmail_receipt_classifications (confidence);
CREATE INDEX gmail_receipt_classifications_classified_at_idx
  ON public.gmail_receipt_classifications (classified_at DESC);

-- ── RLS: service_role only ─────────────────────────────────────────────────────
-- Matches the pattern from migration 0050 (gmail_messages, gmail_statement_arrivals).
-- No policies needed — service_role bypasses RLS via BYPASSRLS attribute.

ALTER TABLE public.gmail_invoice_classifications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gmail_receipt_classifications  ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.gmail_invoice_classifications IS
  'RLS enabled (migration 0055). No policies — service_role only. '
  'F19: confidence from trust_level; body/attachment cached for extraction phase.';

COMMENT ON TABLE public.gmail_receipt_classifications IS
  'RLS enabled (migration 0055). No policies — service_role only. '
  'F19: body_text cached up to 4000 chars so extraction phase never re-fetches Gmail.';
