/** Alberta GST rate — 5% as of 2025. */
export const GST_RATE = 0.05

/**
 * Expense categories that are zero-rated or exempt from Canadian GST.
 * Ported verbatim from utils/auto_reconcile.py ZERO_GST set.
 *
 * Legislative basis:
 *   - Inventory (Books/Pallets): zero-rated printed books, ETA Schedule VI Part V
 *   - Bank Charges, Insurance, Loan Repayments: financial services exemption, ETA s.123
 *   - Amazon Advertising: non-resident supplier invoices carry no Canadian GST
 */
export const ZERO_GST: ReadonlySet<string> = new Set([
  'Inventory — Books (Pallets)',
  'Bank Charges',
  'Insurance — Liability',
  'Insurance — Vehicle (SGI)',
  'Amazon Advertising',
  'Loan Repayment — BDC',
  'Loan Repayment — Tesla',
])

/**
 * Canonical expense category list.
 * Ported verbatim from utils/auto_reconcile.py CATEGORIES.
 * Used by auto-reconcile, tax return ITC aggregation, and vendor-rule matching.
 * Adding a category here is the single change required — ZERO_GST, validation,
 * and future DB seeding all derive from this list.
 */
export const CATEGORIES: readonly string[] = [
  'Inventory — Books (Pallets)',
  'Inventory — Other',
  'Amazon Advertising',
  'Bank Charges',
  'Software & Subscriptions',
  'Shipping & Delivery',
  'Legal & Professional Fees',
  'Vehicle — Fuel',
  'Vehicle — Parking',
  'Vehicle — Repairs & Maintenance',
  'Vehicle — Tesla Charging',
  'Office Expenses',
  'Cell Phone & Internet',
  'Insurance — Liability',
  'Insurance — Vehicle (SGI)',
  'Licenses & Permits',
  'Storage Rental',
  'Subcontractors',
  'Rent or Lease',
  'Utilities',
  'Loan Repayment — BDC',
  'Loan Repayment — Tesla',
  'Other Business Expense',
  'Personal — Groceries',
  'Personal — Takeout / Dining',
  'Personal — Kids / Daycare',
  'Personal — Household',
  'Personal — Entertainment',
  'Personal — Health / Medical',
  'Personal — Clothing',
  'Personal — Gas (Personal Vehicle)',
  'Personal — Other',
] as const
