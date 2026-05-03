import { spFetch } from './client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FinancialEventGroup {
  FinancialEventGroupId: string
  /** "Open" while accumulating transactions, "Closed" when the period has ended. */
  ProcessingStatus?: string
  /**
   * Set only when a fund transfer has been initiated or completed.
   * Real enum values observed in production: 'Processing' (in-transit), 'Succeeded' (paid out).
   * Absent on all pending groups (Open or deferred-Closed).
   */
  FundTransferStatus?: string
  FundTransferDate?: string
  FinancialEventGroupStart?: string
  FinancialEventGroupEnd?: string
  OriginalTotal?: {
    CurrencyCode: string
    CurrencyAmount: number
  }
}

interface FinancialEventGroupsResponse {
  payload?: {
    FinancialEventGroupList?: FinancialEventGroup[]
    NextToken?: string
  }
}

interface ListTransactionsResponse {
  transactions?: Array<{
    transactionStatus?: string
    totalAmount?: { currencyCode?: string; currencyAmount?: number }
  }>
  nextToken?: string
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface SettlementBalance {
  /** ProcessingStatus="Open" + no FundTransferStatus = currently accumulating */
  grossPendingCad: number
  /** ProcessingStatus="Closed" + no FundTransferStatus = period ended, not yet disbursed */
  deferredCad: number
  /** FundTransferStatus="Processing" = transfer initiated, not yet landed in bank */
  inTransitCad: number
  /** grossPendingCad + deferredCad + inTransitCad + (ddbrCad ?? 0) */
  totalBalanceCad: number
  openGroupsCount: number
  deferredGroupsCount: number
  inTransitGroupsCount: number
  /**
   * Delivery Date Based Reserve from v2024-06-19 listTransactions (DEFERRED+CAD).
   * null when account is not yet migrated to that API (endpoint returns 0 transactions).
   */
  ddbrCad: number | null
  /** true when v2024-06-19 returned ≥1 DEFERRED CAD transaction; false = unavailable */
  ddbrAvailable: boolean
  fetchedAt: string
}

// ── Core fetch helpers ────────────────────────────────────────────────────────

/**
 * Fetch all financial event groups for the last `daysBack` days.
 * Returns every group regardless of currency or status — callers filter.
 */
export async function fetchAllFinancialEventGroups(
  daysBack: number
): Promise<FinancialEventGroup[]> {
  const groups: FinancialEventGroup[] = []
  const startedAfter = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()
  let currentParams: Record<string, string> = {
    MaxResultsPerPage: '100',
    FinancialEventGroupStartedAfter: startedAfter,
  }

  while (true) {
    const data = await spFetch<FinancialEventGroupsResponse>('/finances/v0/financialEventGroups', {
      method: 'GET',
      params: currentParams,
    })

    const page = data.payload?.FinancialEventGroupList ?? []
    groups.push(...page)

    const nextToken = data.payload?.NextToken
    if (!nextToken) break
    currentParams = { NextToken: nextToken }
  }

  return groups
}

/**
 * Fetch DEFERRED transactions from v2024-06-19 listTransactions.
 * Returns null + available=false when account is not yet migrated (empty response).
 * Errors are swallowed — DDBR is best-effort enrichment.
 */
async function fetchDdbrBalance(): Promise<{ ddbrCad: number | null; ddbrAvailable: boolean }> {
  try {
    const postedAfter = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    let total = 0
    let found = false
    let params: Record<string, string> = {
      transactionStatus: 'DEFERRED',
      postedAfter,
      maxResultsPerPage: '100',
    }

    while (true) {
      const data = await spFetch<ListTransactionsResponse>('/finances/2024-06-19/transactions', {
        method: 'GET',
        params,
      })

      for (const t of data.transactions ?? []) {
        if (
          t.transactionStatus === 'DEFERRED' &&
          t.totalAmount?.currencyCode === 'CAD' &&
          typeof t.totalAmount.currencyAmount === 'number'
        ) {
          total += t.totalAmount.currencyAmount
          found = true
        }
      }

      const next = data.nextToken
      if (!next) break
      params = { nextToken: next, maxResultsPerPage: '100' }
    }

    return found
      ? { ddbrCad: Math.round(total * 100) / 100, ddbrAvailable: true }
      : { ddbrCad: null, ddbrAvailable: false }
  } catch {
    return { ddbrCad: null, ddbrAvailable: false }
  }
}

/**
 * Fetch settlement balance across three buckets plus optional DDBR.
 *
 * Bucket rules (real FundTransferStatus enum from production):
 *   FTS absent   → grossPendingCad (Open) or deferredCad (Closed)
 *   FTS='Processing' → inTransitCad (transfer initiated, not yet landed)
 *   FTS='Succeeded'  → excluded (already paid out)
 *   FTS=anything else → excluded (unknown disbursement state)
 *
 * Constraint B-2: only CAD groups included.
 * Constraint B-9: no caching — caller's route uses force-dynamic.
 */
export async function fetchSettlementBalance(): Promise<SettlementBalance> {
  const [groups, ddbr] = await Promise.all([fetchAllFinancialEventGroups(180), fetchDdbrBalance()])

  let open = 0,
    deferred = 0,
    inTransit = 0
  let openCount = 0,
    deferredCount = 0,
    inTransitCount = 0

  for (const group of groups) {
    if (group.OriginalTotal?.CurrencyCode !== 'CAD') continue

    const amount = group.OriginalTotal.CurrencyAmount ?? 0
    const fts = group.FundTransferStatus

    if (!fts) {
      if (group.ProcessingStatus === 'Open') {
        open += amount
        openCount++
      } else {
        // Closed + no FTS = period ended, payment not yet initiated
        deferred += amount
        deferredCount++
      }
    } else if (fts === 'Processing') {
      inTransit += amount
      inTransitCount++
    }
    // 'Succeeded' and any other truthy FTS → already disbursed, excluded
  }

  open = Math.round(open * 100) / 100
  deferred = Math.round(deferred * 100) / 100
  inTransit = Math.round(inTransit * 100) / 100

  return {
    grossPendingCad: open,
    deferredCad: deferred,
    inTransitCad: inTransit,
    totalBalanceCad: Math.round((open + deferred + inTransit + (ddbr.ddbrCad ?? 0)) * 100) / 100,
    openGroupsCount: openCount,
    deferredGroupsCount: deferredCount,
    inTransitGroupsCount: inTransitCount,
    ddbrCad: ddbr.ddbrCad,
    ddbrAvailable: ddbr.ddbrAvailable,
    fetchedAt: new Date().toISOString(),
  }
}
