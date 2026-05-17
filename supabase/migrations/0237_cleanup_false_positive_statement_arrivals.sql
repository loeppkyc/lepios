-- Remove false positive statement arrivals classified by placeholder accounts.
-- These rows were classified by the old placeholder STATEMENT_ACCOUNTS config
-- (TD Chequing, RBC Visa, AMEX) which matched any email with "statement" in subject.
-- Confirmed false positives from gmail_messages join:
--   5x Interactive Brokers "Daily Activity Statement" → classified as AMEX
--   1x Newton crypto "Your Apr 2026 statement is ready!" → classified as TD Chequing
--   1x Amazon Web Services billing statement → classified as RBC Visa
--   2x TD real eStatement emails → classified as RBC Visa (wrong account, correct sender)
--   1x Amex real statement email → classified as TD Chequing (wrong account)
--
-- Colin-approved destructive operation: see docs/backlog/tier-c/C2-acceptance.md
-- Part C — False-positive data cleanup.
--
-- No grants needed — this is a DML-only migration.
-- Note: GRANT INSERT, UPDATE, DELETE ON gmail_statement_arrivals TO service_role
-- was applied in migration 0022. No F24 action needed here.

-- Step 1: Remove false positives from known non-bank senders
DELETE FROM gmail_statement_arrivals
WHERE message_id IN (
  SELECT a.message_id
  FROM gmail_statement_arrivals a
  JOIN gmail_messages m ON m.message_id = a.message_id
  WHERE m.from_address ILIKE '%interactivebrokers%'
     OR m.from_address ILIKE '%newton.co%'
     OR m.from_address ILIKE '%aws.com%'
);

-- Step 2: Remove misclassified-account rows for real TD/Amex emails
-- (they will be re-classified correctly on the next gmail-scan cron run)
DELETE FROM gmail_statement_arrivals
WHERE message_id IN (
  SELECT a.message_id
  FROM gmail_statement_arrivals a
  JOIN gmail_messages m ON m.message_id = a.message_id
  WHERE (m.from_address ILIKE '%td.com%' AND a.account_name = 'RBC Visa')
     OR (m.from_address ILIKE '%americanexpress.com%' AND a.account_name = 'TD Chequing')
);
