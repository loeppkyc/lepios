-- Migration 0103: receipts
--
-- Receipt uploads with Claude Vision OCR metadata.
-- storage_path references Supabase Storage bucket 'receipts'.
-- match_status tracks linkage to business_expenses (sets hubdoc=true on match).
--
-- Access model:
--   authenticated → full CRUD via RLS
--   anon          → DENY

CREATE TABLE public.receipts (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_date        DATE          NOT NULL DEFAULT CURRENT_DATE,
  receipt_date       DATE,
  vendor             TEXT          NOT NULL DEFAULT '',
  pretax             NUMERIC(10,2),
  tax_amount         NUMERIC(10,2) NOT NULL DEFAULT 0,
  total              NUMERIC(10,2),
  category           TEXT          NOT NULL DEFAULT '',
  storage_path       TEXT,
  match_status       TEXT          NOT NULL DEFAULT 'unmatched'
                       CHECK (match_status IN ('matched', 'review', 'unmatched')),
  matched_expense_id UUID          REFERENCES public.business_expenses(id) ON DELETE SET NULL,
  notes              TEXT          NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX receipts_upload_date_idx  ON public.receipts (upload_date DESC);
CREATE INDEX receipts_receipt_date_idx ON public.receipts (receipt_date DESC);
CREATE INDEX receipts_match_status_idx ON public.receipts (match_status);

ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receipts_authenticated"
  ON public.receipts FOR ALL
  USING  (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE TRIGGER receipts_set_updated_at
  BEFORE UPDATE ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.receipts IS
  'Receipt uploads with OCR metadata from Claude Vision. '
  'match_status: unmatched → review → matched. '
  'matched_expense_id links to business_expenses; matching sets expense.hubdoc = true.';

-- ── Storage bucket ────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'receipts',
  'receipts',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users can manage files in this bucket
CREATE POLICY "receipts_storage_authenticated"
  ON storage.objects FOR ALL
  TO authenticated
  USING  (bucket_id = 'receipts')
  WITH CHECK (bucket_id = 'receipts');
