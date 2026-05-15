/**
 * Receipt-to-bank-transaction match engine.
 *
 * Score formula (max 1.0):
 *   amount_score (0–0.6) — based on tiered tolerance
 *   date_score   (0–0.3) — linear decay over ±10 days
 *   vendor_score (0–0.1) — word-overlap between receipt vendor and txn description
 *
 * Tiered amount tolerance (from acceptance doc §5):
 *   total ≤ $50       → ±$3.00 flat
 *   $50.01–$500       → ±10%
 *   > $500            → ±5%
 *
 * Auto-confirm threshold: ≥ 0.92
 * Human-review band:      0.70–0.91
 * No-match:               < 0.70
 */

// ── TODO: tune with real data — all threshold constants below
const AUTO_CONFIRM_THRESHOLD = 0.92    // above this → auto-confirmed by system
const DATE_WINDOW_DAYS = 10            // ±10 calendar days
const SMALL_RECEIPT_CEILING = 50       // $ below which flat tolerance applies
const SMALL_RECEIPT_TOLERANCE = 3.00  // ±$3.00 flat for totals ≤ $50
const MID_RECEIPT_CEILING = 500        // $ below which 10% tolerance applies
const MID_RECEIPT_TOLERANCE_PCT = 0.10 // ±10%
const LARGE_RECEIPT_TOLERANCE_PCT = 0.05 // ±5% for totals > $500

export interface ReceiptLine {
  id: string
  receipt_date: string  // YYYY-MM-DD
  vendor: string
  total: number
}

export interface BankTransaction {
  id: string
  date: string          // YYYY-MM-DD
  description: string
  amount: number
}

export interface MatchCandidate {
  transaction_id: string
  transaction: BankTransaction
  match_confidence: number
  auto_confirmed: boolean
}

// ── Amount tolerance tier ────────────────────────────────────────────────────

function toleranceFor(total: number): number {
  if (total <= SMALL_RECEIPT_CEILING) return SMALL_RECEIPT_TOLERANCE
  if (total <= MID_RECEIPT_CEILING) return total * MID_RECEIPT_TOLERANCE_PCT
  return total * LARGE_RECEIPT_TOLERANCE_PCT
}

// ── Scoring functions ────────────────────────────────────────────────────────

function amountScore(receiptTotal: number, txnAmount: number): number {
  const tolerance = toleranceFor(receiptTotal)
  const diff = Math.abs(receiptTotal - Math.abs(txnAmount))
  // Outside tolerance → 0 (spec: ±$3.00 means diff > 3.00 is no match)
  if (diff > tolerance) return 0
  // At exact boundary (diff === tolerance) → small positive score
  // Linear decay using (tolerance + 0.01) denominator so boundary gives ~0 but > 0
  return 0.6 * (1 - diff / (tolerance + 0.001))
}

function daysBetween(a: string, b: string): number {
  const msPerDay = 86_400_000
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / msPerDay
}

function dateScore(receiptDate: string, txnDate: string): number {
  const delta = daysBetween(receiptDate, txnDate)
  // Strict: delta must be within DATE_WINDOW_DAYS (inclusive)
  // delta === DATE_WINDOW_DAYS → still in window (10-day window = 10 days inclusive)
  if (delta > DATE_WINDOW_DAYS) return 0
  // Linear: delta=0 → 0.3; delta=DATE_WINDOW_DAYS → small positive (1/(DAYS+1) * 0.3)
  return 0.3 * (1 - delta / (DATE_WINDOW_DAYS + 1))
}

function vendorScore(receiptVendor: string, txnDescription: string): number {
  const vendorWords = receiptVendor
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2)
  const descLower = txnDescription.toLowerCase()
  if (vendorWords.length === 0) return 0
  const matchCount = vendorWords.filter((w) => descLower.includes(w)).length
  return 0.1 * (matchCount / vendorWords.length)
}

// ── Main match function ──────────────────────────────────────────────────────

/**
 * Match a receipt against a list of bank transactions.
 * Returns up to 5 candidates sorted by confidence descending.
 */
export function matchReceipt(
  receipt: ReceiptLine,
  transactions: BankTransaction[],
): MatchCandidate[] {
  const candidates: MatchCandidate[] = []

  for (const txn of transactions) {
    const aScore = amountScore(receipt.total, txn.amount)
    const dScore = dateScore(receipt.receipt_date, txn.date)

    // Hard gates: both amount AND date must be within tolerance.
    // A receipt that's $31 off or 11 days away is not a match, regardless
    // of vendor name overlap.
    if (aScore <= 0 || dScore <= 0) continue

    const vScore = vendorScore(receipt.vendor, txn.description)
    const score = aScore + dScore + vScore

    candidates.push({
      transaction_id: txn.id,
      transaction: txn,
      match_confidence: Math.min(1, parseFloat(score.toFixed(4))),
      auto_confirmed: score >= AUTO_CONFIRM_THRESHOLD,
    })
  }

  return candidates
    .sort((a, b) => b.match_confidence - a.match_confidence)
    .slice(0, 5)
}

// Re-export threshold so routes can use it without hard-coding
export { AUTO_CONFIRM_THRESHOLD }
