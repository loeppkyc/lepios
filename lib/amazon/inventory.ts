import { spFetch } from './client'

const MARKETPLACE_CA = 'A2EUQ1WTGCTBG2'

// ── SP-API response types ─────────────────────────────────────────────────────

interface InventoryDetails {
  fulfillableQuantity?: number
  inboundWorkingQuantity?: number
  inboundShippedQuantity?: number
  inboundReceivingQuantity?: number
  reservedQuantity?: {
    totalReservedQuantity?: number
  }
  unfulfillableQuantity?: {
    totalUnfulfillableQuantity?: number
  }
}

interface InventorySummary {
  asin?: string
  fnSku?: string
  sellerSku?: string
  condition?: string
  productName?: string
  totalQuantity?: number
  lastUpdatedTime?: string
  inventoryDetails?: InventoryDetails
}

interface InventorySummariesResponse {
  payload?: {
    inventorySummaries?: InventorySummary[]
  }
  /** Constraint B-5: nextToken is at top-level body.pagination, NOT body.payload.pagination */
  pagination?: {
    nextToken?: string
  }
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface FbaInventoryResult {
  /** Sum of inventoryDetails.fulfillableQuantity across all active FBA SKUs (Constraint B-7) */
  fulfillableUnits: number
  /** ISO timestamp when the data was fetched */
  fetchedAt: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Returns ISO-8601 string for N days ago (UTC).
 */
function daysAgoIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

// ── Core fetch ────────────────────────────────────────────────────────────────

/**
 * Fetch all active FBA inventory SKUs (90-day window) and return total
 * fulfillable unit count.
 *
 * Constraint B-3: startDateTime mandatory — without it 14,000+ lifetime records returned.
 * Constraint B-4: full params on every paginated request.
 * Constraint B-5: nextToken at body.pagination.nextToken (NOT body.payload.pagination).
 * Constraint B-6: 700ms delay between pages; 429 retried up to 3x with 2s backoff.
 * Constraint B-7: use inventoryDetails.fulfillableQuantity, not totalQuantity.
 */
export async function fetchFbaInventory(): Promise<FbaInventoryResult> {
  const startDateTime = daysAgoIso(90)

  // Base params — must be sent on every page (Constraint B-4)
  const baseParams: Record<string, string> = {
    details: 'true',
    granularityType: 'Marketplace',
    granularityId: MARKETPLACE_CA,
    marketplaceIds: MARKETPLACE_CA,
    startDateTime,
  }

  let fulfillableUnits = 0
  let nextToken: string | undefined = undefined
  let isFirstPage = true

  while (true) {
    const params: Record<string, string> = { ...baseParams }
    if (nextToken) {
      params.nextToken = nextToken
    }

    // Rate-limit: 700ms delay between pages (Constraint B-6) — skip on first page
    if (!isFirstPage) {
      await sleep(700)
    }
    isFirstPage = false

    // 429 retry logic (Constraint B-6)
    let data: InventorySummariesResponse | null = null
    let attempts = 0
    while (attempts < 4) {
      try {
        data = await spFetch<InventorySummariesResponse>(
          '/fba/inventory/v1/summaries',
          { method: 'GET', params }
        )
        break
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (message.includes('429') && attempts < 3) {
          attempts++
          await sleep(2000)
          continue
        }
        throw err
      }
    }

    if (!data) break

    const summaries = data.payload?.inventorySummaries ?? []
    for (const summary of summaries) {
      fulfillableUnits += summary.inventoryDetails?.fulfillableQuantity ?? 0
    }

    // Constraint B-5: nextToken is at body.pagination.nextToken (top-level)
    nextToken = data.pagination?.nextToken
    if (!nextToken) break
  }

  return {
    fulfillableUnits,
    fetchedAt: new Date().toISOString(),
  }
}
