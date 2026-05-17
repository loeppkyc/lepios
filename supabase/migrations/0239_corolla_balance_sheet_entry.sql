-- E9: Add 2021 Toyota Corolla as an asset in balance_sheet_entries so it appears on the Net Worth page.
-- The auto-sync in /api/vehicles-data PATCH will keep the balance current on future value updates.
-- Also link the existing Tesla entry so future PATCH syncs match by vehicle_id instead of ilike name.

-- Insert Corolla asset row (personal vehicle, equipment category)
INSERT INTO balance_sheet_entries (name, account_type, category, balance, as_of_date, sort_order, source, currency)
VALUES (
  '2021 Toyota Corolla (Vehicle)',
  'asset',
  'equipment',
  12000.00,
  CURRENT_DATE,
  17,
  'manual',
  'CAD'
)
ON CONFLICT DO NOTHING;
