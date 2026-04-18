-- Allow 'test' status on deals table for diagnostic write verification.
-- The deals_status_check constraint originally allowed: found, watching, bought, passed, expired.
-- 'test' is added so test_deals_supabase_write.py can insert identifiable rows with a
-- dual-filter delete guarantee (status='test' AND asin LIKE 'TEST-%').

ALTER TABLE deals DROP CONSTRAINT deals_status_check;
ALTER TABLE deals ADD CONSTRAINT deals_status_check
    CHECK (status IN ('found', 'watching', 'bought', 'passed', 'expired', 'test'));
