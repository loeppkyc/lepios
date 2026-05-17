-- Link balance_sheet_entries rows to their QBO account ID for reconciliation
ALTER TABLE balance_sheet_entries ADD COLUMN IF NOT EXISTS qbo_account_id TEXT;

-- Map known accounts: balance_sheet name → QBO account Id
UPDATE balance_sheet_entries SET qbo_account_id = '51'  WHERE name = 'TD Chequing (Business)';
UPDATE balance_sheet_entries SET qbo_account_id = '217' WHERE name = 'TD USD Chequing (9924)';
UPDATE balance_sheet_entries SET qbo_account_id = '219' WHERE name = 'PayPal Business';
UPDATE balance_sheet_entries SET qbo_account_id = '239' WHERE name = 'Amex Business Card';
UPDATE balance_sheet_entries SET qbo_account_id = '56'  WHERE name = 'Canadian Tire MC (3253)';
UPDATE balance_sheet_entries SET qbo_account_id = '55'  WHERE name = 'Capital One Card';
UPDATE balance_sheet_entries SET qbo_account_id = '242' WHERE name = 'TD Visa';
UPDATE balance_sheet_entries SET qbo_account_id = '237' WHERE name = 'Gift Card';
UPDATE balance_sheet_entries SET qbo_account_id = '224' WHERE name = 'Petty Cash';

GRANT INSERT, UPDATE, DELETE ON balance_sheet_entries TO service_role;
