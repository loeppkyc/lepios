-- 0244_lego_restock_events.sql
-- Logs every stock-state transition observed for a LEGO set.
-- Written by the deal-watcher Railway service when lego-ca adapter detects a status flip.
-- Powers the restock predictor: query avg days between status_to='E_AVAILABLE' events per set_number.

CREATE TABLE lego_restock_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  set_number  TEXT        NOT NULL,
  url         TEXT,
  status_from TEXT,
  status_to   TEXT        NOT NULL,
  source      TEXT        NOT NULL DEFAULT 'watcher'
                          CHECK (source IN ('watcher', 'reddit', 'manual')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX lre_set_number ON lego_restock_events(set_number, occurred_at DESC);
CREATE INDEX lre_occurred_at ON lego_restock_events(occurred_at DESC);

GRANT INSERT, UPDATE, DELETE ON lego_restock_events TO service_role;
