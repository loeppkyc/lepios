-- Balance sheet catch-up: advance stale entries past the 2026-03-31 close
-- using data available in amazon_settlements and journal_entry_lines as of 2026-05-17.
--
-- Amazon.ca Transfers:
--   The account tracks what Amazon is currently holding (in-transit before bank deposit).
--   All settlements through 2026-05-12 have fund_transfer_status='Succeeded' (deposited).
--   The current open settlement (started 2026-05-12, no end date) = $4,362.91 CAD.
--
-- Prepaid Expenses:
--   Monthly amortization of $238.25 on the 22nd of each month (confirmed from journal_entry_lines).
--   Last recorded amortization: 2026-03-22. April 22 amortization not yet in journals.
--   Applied here: $359.64 - $238.25 = $121.39. May 22 amortization not yet due.
--
-- Petty Cash & Business Equipment:
--   No April/May journal entries touching either account — balances unchanged.
--   Advancing as_of_date to confirm reviewed and current.
--
-- Amazon.com Transfers (-$1,482.10):
--   No USD settlements in amazon_settlements table. Cannot advance. Left at 2026-03-31.

UPDATE balance_sheet_entries
SET balance    = 4362.91,
    as_of_date = '2026-05-17'
WHERE name = 'Amazon.ca Transfers';

UPDATE balance_sheet_entries
SET balance    = 121.39,
    as_of_date = '2026-05-17'
WHERE name = 'Prepaid Expenses';

UPDATE balance_sheet_entries
SET as_of_date = '2026-05-17'
WHERE name = 'Petty Cash';

UPDATE balance_sheet_entries
SET as_of_date = '2026-05-17'
WHERE name = 'Business Equipment';
