-- Migration 0022: Gmail Scanner tables
-- Adds gmail_known_senders (seeded from Streamlit constants),
-- gmail_messages (central message store), gmail_statement_arrivals (classifier output),
-- and append_scan_labels_batch helper.

-- ── gmail_known_senders ───────────────────────────────────────────────────────

CREATE TABLE gmail_known_senders (
  email_address  text        PRIMARY KEY,
  sender_type    text        NOT NULL DEFAULT 'other'
                             CHECK (sender_type IN ('invoice','inline_receipt','statement_arrival','other')),
  trust_level    text        NOT NULL DEFAULT 'review'
                             CHECK (trust_level IN ('trusted','review','ignore')),
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  notes          text,
  created_by     text        NOT NULL DEFAULT 'auto_detected'
                             CHECK (created_by IN ('migrated_from_sheets','auto_detected','colin_added'))
);

-- Seed: KNOWN_INVOICE_SENDERS (20 domains) → sender_type='invoice'
INSERT INTO gmail_known_senders (email_address, sender_type, trust_level, created_by) VALUES
  ('marriott.com',                    'invoice', 'trusted', 'migrated_from_sheets'),
  ('telus.com',                       'invoice', 'trusted', 'migrated_from_sheets'),
  ('polarhq.com',                     'invoice', 'trusted', 'migrated_from_sheets'),
  ('amazon.ca',                       'invoice', 'trusted', 'migrated_from_sheets'),
  ('lego.com',                        'invoice', 'trusted', 'migrated_from_sheets'),
  ('bestbuy.ca',                      'invoice', 'trusted', 'migrated_from_sheets'),
  ('staples.ca',                      'invoice', 'trusted', 'migrated_from_sheets'),
  ('canadapost-postescanada.ca',      'invoice', 'trusted', 'migrated_from_sheets'),
  ('adobe.com',                       'invoice', 'trusted', 'migrated_from_sheets'),
  ('anthropic.com',                   'invoice', 'trusted', 'migrated_from_sheets'),
  ('microsoft.com',                   'invoice', 'trusted', 'migrated_from_sheets'),
  ('dropbox.com',                     'invoice', 'trusted', 'migrated_from_sheets'),
  ('google.com',                      'invoice', 'trusted', 'migrated_from_sheets'),
  ('apple.com',                       'invoice', 'trusted', 'migrated_from_sheets'),
  ('shopify.com',                     'invoice', 'trusted', 'migrated_from_sheets'),
  ('keepa.com',                       'invoice', 'trusted', 'migrated_from_sheets'),
  ('sellerboard.com',                 'invoice', 'trusted', 'migrated_from_sheets')
ON CONFLICT (email_address) DO NOTHING;

-- Note: KNOWN_INVOICE_SENDERS from Streamlit has 17 unique domains (marriott through sellerboard).
-- The study doc referenced "20 domains" but the actual list in utils/gmail.py has 17.
-- All 17 seeded above.

-- Seed: KNOWN_INLINE_SENDERS (40 domains) → sender_type='inline_receipt'
INSERT INTO gmail_known_senders (email_address, sender_type, trust_level, created_by) VALUES
  ('londondrugs.com',                 'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('londondrugs.ca',                  'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('walmart.ca',                      'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('walmart.com',                     'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('costco.ca',                       'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('costco.com',                      'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('canadiantire.ca',                 'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('bestbuy.ca',                      'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('staples.ca',                      'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('homedepot.ca',                    'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('homedepot.com',                   'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('sportchek.ca',                    'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('thebay.com',                      'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('winners.ca',                      'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('marshalls.ca',                    'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('dollarama.com',                   'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('safeway.ca',                      'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('sobeys.ca',                       'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('nofrills.ca',                     'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('realcanadiansuperstore.ca',       'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('save-on-foods.com',               'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('superstore.ca',                   'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('wholefoodsmarket.com',            'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('shoppersdrug.com',                'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('shoppersdrugmart.ca',             'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('pharmasave.com',                  'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('rexall.ca',                       'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('chapters.indigo.ca',              'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('amazon.com',                      'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('ebay.ca',                         'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('ebay.com',                        'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('etsy.com',                        'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('toys-r-us.ca',                    'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('toysrus.ca',                      'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('cineplex.com',                    'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('sportinglife.ca',                 'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('atmospherecanada.ca',             'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('shaw.ca',                         'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('rogers.com',                      'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('bell.ca',                         'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('skip.com',                        'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('ubereats.com',                    'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('doordash.com',                    'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('airbnb.com',                      'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('expedia.ca',                      'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('booking.com',                     'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('parkingpanda.com',                'inline_receipt', 'trusted', 'migrated_from_sheets'),
  ('impark.com',                      'inline_receipt', 'trusted', 'migrated_from_sheets')
ON CONFLICT (email_address) DO NOTHING;

-- Note: amazon.ca is already seeded as 'invoice'; amazon.com seeded as 'inline_receipt'.
-- telus.com, bestbuy.ca, staples.ca, lego.com appear in both lists in Streamlit —
-- they are seeded as 'invoice' (first insert wins due to ON CONFLICT DO NOTHING).

-- ── gmail_messages ────────────────────────────────────────────────────────────

CREATE TABLE gmail_messages (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     text        UNIQUE NOT NULL,  -- Gmail message ID (opaque string)
  from_address   text        NOT NULL,
  subject        text        NOT NULL DEFAULT '',
  sent_at        timestamptz,
  has_attachment boolean     NOT NULL DEFAULT false,
  scanned_at     timestamptz NOT NULL DEFAULT now(),
  scan_labels    text[]      NOT NULL DEFAULT '{}'  -- classifiers that have processed this message
);

CREATE INDEX gmail_messages_message_id_idx ON gmail_messages (message_id);
CREATE INDEX gmail_messages_sent_at_idx    ON gmail_messages (sent_at DESC);
CREATE INDEX gmail_messages_from_idx       ON gmail_messages (from_address);

-- ── gmail_statement_arrivals ──────────────────────────────────────────────────

CREATE TABLE gmail_statement_arrivals (
  id                     uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id             text  NOT NULL REFERENCES gmail_messages(message_id),
  account_name           text  NOT NULL,
  statement_period_start date,
  statement_period_end   date,
  arrival_date           date  NOT NULL,
  attachment_name        text,              -- PDF filename if present, else null
  confidence             text  NOT NULL DEFAULT 'high'
                               CHECK (confidence IN ('high','medium')),
  detected_at            timestamptz NOT NULL DEFAULT now(),
  notes                  text,

  UNIQUE (message_id)  -- one arrival record per message
);

CREATE INDEX gmail_statement_arrivals_account_idx  ON gmail_statement_arrivals (account_name);
CREATE INDEX gmail_statement_arrivals_arrival_idx  ON gmail_statement_arrivals (arrival_date DESC);

-- ── Helper: append_scan_labels_batch ─────────────────────────────────────────
-- Appends a label to scan_labels for a batch of message_ids (idempotent — skips if already present).

CREATE OR REPLACE FUNCTION append_scan_labels_batch(
  p_message_ids text[],
  p_label       text
) RETURNS void AS $$
BEGIN
  UPDATE gmail_messages
  SET    scan_labels = array_append(scan_labels, p_label)
  WHERE  message_id = ANY(p_message_ids)
    AND  NOT (scan_labels @> ARRAY[p_label]);
END;
$$ LANGUAGE plpgsql;
