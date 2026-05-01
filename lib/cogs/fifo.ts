export interface CogsEntryForFifo {
  asin: string
  unit_cost_cad: number // validated non-null per_unit only
  quantity: number
  purchased_at: string // YYYY-MM-DD for ordering
}

export interface FifoAsinResult {
  value: number // CAD value of fulfillable units for this ASIN
  unitsCosted: number // fulfillable units with a known cost layer
  unitsUncosted: number // fulfillable units with no cost data
}

export interface FifoResult {
  total: number // sum of value across non-book ASINs
  byAsin: Record<string, FifoAsinResult>
}

/**
 * Compute inventory value using FIFO cost layers.
 *
 * Walk entries oldest→newest until fulfillableQty is exhausted.
 * ASINs with digit-first ASIN (ISBN/book format) are computed but
 * excluded from total — they appear in byAsin for display only.
 */
export function computeInventoryValue(
  entries: CogsEntryForFifo[],
  fulfillableQtyByAsin: Map<string, number>
): FifoResult {
  // Group by ASIN and sort each group oldest→newest
  const grouped: Record<string, CogsEntryForFifo[]> = {}
  for (const entry of entries) {
    ;(grouped[entry.asin] ??= []).push(entry)
  }
  for (const asin of Object.keys(grouped)) {
    grouped[asin].sort((a, b) => a.purchased_at.localeCompare(b.purchased_at))
  }

  let total = 0
  const byAsin: Record<string, FifoAsinResult> = {}

  for (const [asin, fulfillableQty] of fulfillableQtyByAsin) {
    if (fulfillableQty <= 0) continue

    const layers = grouped[asin] ?? []
    let remaining = fulfillableQty
    let value = 0
    let unitsCosted = 0

    for (const layer of layers) {
      if (remaining <= 0) break
      const used = Math.min(layer.quantity, remaining)
      value += layer.unit_cost_cad * used
      unitsCosted += used
      remaining -= used
    }

    const result: FifoAsinResult = {
      value: Math.round(value * 100) / 100,
      unitsCosted,
      unitsUncosted: remaining,
    }
    byAsin[asin] = result

    // Books (digit-first ASIN = ISBN format) excluded from total
    if (!/^\d/.test(asin)) {
      total += result.value
    }
  }

  return { total: Math.round(total * 100) / 100, byAsin }
}
