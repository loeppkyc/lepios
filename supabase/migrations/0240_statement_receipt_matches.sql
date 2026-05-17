-- Statement receipt matches: links each pending_transaction to a receipt (or marks dismissed).
-- One transaction → at most one match (UNIQUE on transaction_id).
-- match_status: auto (engine confident), review (engine uncertain), manual (Colin assigned), dismissed (no receipt exists)

CREATE TABLE statement_receipt_matches (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id   UUID        NOT NULL REFERENCES pending_transactions(id) ON DELETE CASCADE,
  receipt_id       UUID        REFERENCES receipts(id) ON DELETE SET NULL,
  match_score      NUMERIC,
  match_status     TEXT        NOT NULL DEFAULT 'auto'
                               CHECK (match_status IN ('auto', 'review', 'manual', 'dismissed')),
  confirmed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX srm_transaction_unique ON statement_receipt_matches(transaction_id);
CREATE INDEX srm_receipt_id               ON statement_receipt_matches(receipt_id);
CREATE INDEX srm_status                   ON statement_receipt_matches(match_status);

GRANT INSERT, UPDATE, DELETE ON statement_receipt_matches TO service_role;
