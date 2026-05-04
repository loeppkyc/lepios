/**
 * Scores a receipt against an expense candidate.
 * Returns 999 if the pair is outside tolerance (no match).
 * Lower score = stronger match.
 *
 * Scoring formula:
 *   base = amountDiff×10 + dayDiff×0.5
 *   bonuses: -2 if dayDiff ≤ 3, -3 if amountDiff < 0.01
 *   vendor bonuses: -8 (2+ words match), -5 (1 word / prefix-6), -2 (prefix-4)
 *   floor: Math.max(0, score)
 */
export function scoreMatch(
  receiptTotal: number,
  receiptDateStr: string,
  receiptVendor: string,
  expenseTotal: number,
  expenseDateStr: string,
  expenseVendor: string
): number {
  const tolerance = Math.max(Math.min(receiptTotal * 0.15, 20.0), 2.0)
  const amountDiff = Math.abs(expenseTotal - receiptTotal)
  if (amountDiff > tolerance) return 999

  const rMs = new Date(receiptDateStr + 'T12:00:00').getTime()
  const eMs = new Date(expenseDateStr + 'T12:00:00').getTime()
  if (isNaN(rMs) || isNaN(eMs)) return 999
  const dayDiff = Math.abs((eMs - rMs) / 86400000)
  if (dayDiff > 10) return 999

  let score = amountDiff * 10 + dayDiff * 0.5
  if (dayDiff <= 3) score -= 2

  if (receiptVendor) {
    const v1 = receiptVendor.toLowerCase()
    const v2 = expenseVendor.toLowerCase()
    const words = v1.split(/\s+/).filter((w) => w.length > 3)
    const matchCount = words.filter((w) => v2.includes(w)).length
    if (matchCount >= 2) score -= 8
    else if (matchCount === 1 || v2.includes(v1.slice(0, 6))) score -= 5
    else if (v2.includes(v1.slice(0, 4)) || v1.includes(v2.slice(0, 4))) score -= 2
  }

  if (amountDiff < 0.01) score -= 3
  return Math.max(0, score)
}

export interface ScoredPair {
  score: number
  receiptId: string
  expenseId: string
}

/**
 * Greedily pairs receipts to expenses from a pre-scored list.
 * Pairs sorted ascending by score; each receipt and expense claimed at most once.
 * Score ≤ 1.0 → auto-match. 1.0 < score ≤ 3.0 → needs review. >3.0 → no match.
 */
export function greedyPair(pairs: ScoredPair[]): {
  autoMatches: Array<{ receiptId: string; expenseId: string }>
  needsReview: number
} {
  const sorted = [...pairs].sort((a, b) => a.score - b.score)
  const claimedReceipts = new Set<string>()
  const claimedExpenses = new Set<string>()
  const autoMatches: Array<{ receiptId: string; expenseId: string }> = []
  let needsReview = 0

  for (const pair of sorted) {
    if (claimedReceipts.has(pair.receiptId)) continue
    if (claimedExpenses.has(pair.expenseId)) continue

    if (pair.score <= 1.0) {
      autoMatches.push({ receiptId: pair.receiptId, expenseId: pair.expenseId })
      claimedReceipts.add(pair.receiptId)
      claimedExpenses.add(pair.expenseId)
    } else if (pair.score <= 3.0) {
      needsReview++
      claimedReceipts.add(pair.receiptId)
    }
  }

  return { autoMatches, needsReview }
}
