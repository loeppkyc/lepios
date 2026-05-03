// Shared expense types and constants.
// No server-only imports — safe to use in both client and server components.

export const CATEGORIES = [
  'Inventory — Books (Pallets)',
  'Inventory — Other',
  'Shipping & Delivery',
  'Amazon Advertising',
  'Bank Charges',
  'Insurance',
  'Licenses & Permits',
  'Phone & Internet',
  'Professional Fees',
  'Office Supplies',
  'Software & Subscriptions',
  'Subcontractors',
  'Vehicle Expenses',
  'Vehicle & Travel',
  'Vehicle — Fuel',
  'Vehicle — Parking',
  'Vehicle — Repairs & Maintenance',
  'Vehicle — Tesla Charging',
  'Loan Repayment — BDC',
  'Loan Repayment — Tesla',
  'Other Business Expense',
] as const

export type Category = (typeof CATEGORIES)[number]

export const PAYMENT_METHODS = [
  'TD Bank Chequing',
  'TD Debit',
  'Amex Platinum',
  'Amex Bonvoy',
  'Capital One Visa',
  'TD Visa',
  'CIBC Costco Mastercard',
  'Canadian Tire Mastercard',
  'Cash',
  'E-Transfer',
  'Other',
] as const

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

// Categories that are zero-rated for GST (books, bank fees, insurance, etc.)
export const ZERO_GST_CATEGORIES = new Set<string>([
  'Inventory — Books (Pallets)',
  'Bank Charges',
  'Insurance',
  'Amazon Advertising',
  'Loan Repayment — BDC',
  'Loan Repayment — Tesla',
])

// Canadian province tax rates — label → decimal multiplier
export const TAX_RATES: Record<string, number> = {
  'No tax — 0%':                   0.00,
  'GST 5% (AB / NT / NU / YT)':   0.05,
  'GST+PST 11% (SK)':              0.11,
  'GST+PST 12% (BC / MB)':         0.12,
  'HST 13% (ON)':                  0.13,
  'HST 15% (NB / NS / PE / NL)':  0.15,
  'GST+QST ~15% (QC)':             0.14975,
}

export const TAX_RATE_KEYS = Object.keys(TAX_RATES)
export const TAX_RATE_ZERO = 'No tax — 0%'
export const TAX_RATE_DEFAULT = 'GST 5% (AB / NT / NU / YT)'

export type Frequency = 'one-time' | 'monthly' | 'annual'

export interface BusinessExpense {
  id: string
  date: string          // 'YYYY-MM-DD'
  vendor: string
  category: string
  pretax: number
  tax_amount: number
  payment_method: string
  hubdoc: boolean
  notes: string
  business_use_pct: number
  created_at: string
  updated_at: string
}

export interface ExpenseSummary {
  count: number
  totalPretax: number
  totalTax: number
  totalLogged: number   // pretax + tax
  businessPortion: number  // pretax * business_use_pct/100 (no tax)
}

export interface ExpensesResponse {
  expenses: BusinessExpense[]
  summary: ExpenseSummary
}

// ── Pure helpers (no server deps) ─────────────────────────────────────────────

/** Default tax rate key for a given category. */
export function defaultTaxRateKey(category: string): string {
  return ZERO_GST_CATEGORIES.has(category) ? TAX_RATE_ZERO : TAX_RATE_DEFAULT
}

/** Compute tax amount from pretax and a rate key. */
export function computeTax(pretax: number, rateKey: string): number {
  const rate = TAX_RATES[rateKey] ?? 0
  return Math.round(pretax * rate * 100) / 100
}

/**
 * Given a base date string (YYYY-MM-DD) and frequency, return an array of
 * { date, pretax, taxAmount } records to insert.
 * - one-time: single entry
 * - monthly:  entry for base month + all remaining months of the same year
 * - annual:   entry for every month of the year with amounts ÷ 12
 */
export function expandRecurring(
  baseDateStr: string,
  pretax: number,
  taxAmount: number,
  frequency: Frequency,
): Array<{ date: string; pretax: number; taxAmount: number }> {
  const base = new Date(baseDateStr + 'T12:00:00')
  const year = base.getFullYear()
  const baseMonth = base.getMonth() + 1  // 1-12
  const baseDay = base.getDate()

  function clampDay(y: number, m: number, d: number): string {
    const lastDay = new Date(y, m, 0).getDate()
    const day = Math.min(d, lastDay)
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  if (frequency === 'one-time') {
    return [{ date: baseDateStr, pretax, taxAmount }]
  }

  if (frequency === 'monthly') {
    const rows = []
    for (let m = baseMonth; m <= 12; m++) {
      rows.push({
        date: clampDay(year, m, baseDay),
        pretax,
        taxAmount,
      })
    }
    return rows
  }

  // annual: divide across all 12 months
  const monthlyPretax = Math.round((pretax / 12) * 100) / 100
  const monthlyTax    = Math.round((taxAmount / 12) * 100) / 100
  return Array.from({ length: 12 }, (_, i) => ({
    date: clampDay(year, i + 1, baseDay),
    pretax: monthlyPretax,
    taxAmount: monthlyTax,
  }))
}

/** Summarise a list of expenses. */
export function summariseExpenses(expenses: BusinessExpense[]): ExpenseSummary {
  let totalPretax = 0
  let totalTax = 0
  let businessPortion = 0

  for (const e of expenses) {
    totalPretax += e.pretax
    totalTax += e.tax_amount
    businessPortion += e.pretax * (e.business_use_pct / 100)
  }

  return {
    count: expenses.length,
    totalPretax: Math.round(totalPretax * 100) / 100,
    totalTax: Math.round(totalTax * 100) / 100,
    totalLogged: Math.round((totalPretax + totalTax) * 100) / 100,
    businessPortion: Math.round(businessPortion * 100) / 100,
  }
}
