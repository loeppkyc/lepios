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
  // Real SP-API shape: payload-wrapped. Production verification 2026-05-07 —
  // the previous (unwrapped) shape silently dropped ALL deferred transactions
  // ($7,285.59 missed). See scripts/probe-deferred-balance.mjs.
  payload?: {
    transactions?: Array<{
      transactionStatus?: string
      totalAmount?: { currencyCode?: string; currencyAmount?: number }
    }>
    nextToken?: string
  }
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface LastPayout {
  amountCad: number
  /** ISO timestamp from FundTransferDate */
  transferDate: string
  /** 'Processing' (initiated, not yet landed) or 'Succeeded' (deposited) */
  status: 'Processing' | 'Succeeded'
}

export interface SettlementBalance {
  /** ProcessingStatus="Open" + no FundTransferStatus = currently accumulating (Amazon "Standard, available now") */
  grossPendingCad: number
  /**
   * Held-for-delivery balance (Amazon "Deferred transactions").
   * Sourced from listTransactions v2024-06-19 DEFERRED status when available;
   * falls back to financialEventGroups Closed-without-FTS for accounts without
   * v2024-06-19 access. Never double-counted — DDBR replaces FEG-based deferred
   * when present (the same money via two API surfaces).
   */
  deferredCad: number
  /** grossPendingCad + deferredCad — matches Amazon "All Accounts Total Balance" */
  totalBalanceCad: number
  openGroupsCount: number
  deferredGroupsCount: number
  /**
   * Most recent payout group (CAD) by FundTransferDate. Mirrors Amazon's
   * "Recent Payouts" line. Null if no transferred groups in the lookback window.
   */
  lastPayout: LastPayout | null
  /**
   * Raw DDBR sum from v2024-06-19 listTransactions (DEFERRED+CAD). null when
   * the API returns 0 transactions for this account. When non-null, it is the
   * canonical deferred number and `deferredCad` returns this value.
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

      for (const t of data.payload?.transactions ?? []) {
        if (
          t.transactionStatus === 'DEFERRED' &&
          t.totalAmount?.currencyCode === 'CAD' &&
          typeof t.totalAmount.currencyAmount === 'number'
        ) {
          total += t.totalAmount.currencyAmount
          found = true
        }
      }

      const next = data.payload?.nextToken
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
 * Fetch settlement balance matching the Amazon Seller Central UI.
 *
 * Categories from financialEventGroups (CAD only):
 *   FTS absent + Open     → grossPendingCad (Standard, available now)
 *   FTS absent + Closed   → fallback deferred (only when DDBR API unavailable)
 *   FTS='Processing'      → payout in flight (used to compute lastPayout)
 *   FTS='Succeeded'       → already paid out (used to compute lastPayout)
 *
 * Deferred (held-for-delivery): sourced from listTransactions v2024-06-19
 * DEFERRED status when available — this is the canonical Amazon "Deferred
 * transactions" number ($7,285.59 in production on 2026-05-07; the FEG
 * Closed-without-FTS path returned $0 for the same balance, hence the DDBR
 * preference).
 *
 * totalBalanceCad = grossPendingCad + deferredCad. Matches Amazon "All
 * Accounts Total Balance". Does NOT include in-transit groups — those are
 * already-initiated payouts, surfaced separately via lastPayout.
 *
 * Constraint B-2: only CAD groups included.
 * Constraint B-9: no caching — caller's route uses force-dynamic.
 */
export async function fetchSettlementBalance(): Promise<SettlementBalance> {
  const [groups, ddbr] = await Promise.all([fetchAllFinancialEventGroups(180), fetchDdbrBalance()])

  let open = 0
  let fegDeferred = 0
  let openCount = 0
  let fegDeferredCount = 0
  let lastPayout: LastPayout | null = null

  for (const group of groups) {
    if (group.OriginalTotal?.CurrencyCode !== 'CAD') continue

    const amount = group.OriginalTotal.CurrencyAmount ?? 0
    const fts = group.FundTransferStatus
    const transferDate = group.FundTransferDate

    if (!fts) {
      if (group.ProcessingStatus === 'Open') {
        open += amount
        openCount++
      } else {
        // Closed + no FTS = period ended, payment not yet initiated.
        // Used as deferred fallback only when DDBR API has no data.
        fegDeferred += amount
        fegDeferredCount++
      }
    } else if ((fts === 'Processing' || fts === 'Succeeded') && transferDate) {
      // Track most-recent payout to mirror Amazon "Recent Payouts" line.
      if (!lastPayout || transferDate > lastPayout.transferDate) {
        lastPayout = { amountCad: amount, transferDate, status: fts }
      }
    }
  }

  open = Math.round(open * 100) / 100
  fegDeferred = Math.round(fegDeferred * 100) / 100

  // DDBR is canonical when available; FEG-deferred is the legacy fallback.
  // Never sum both — they describe the same money via different APIs.
  const deferred = ddbr.ddbrCad !== null ? ddbr.ddbrCad : fegDeferred
  const deferredCount = ddbr.ddbrCad !== null ? 0 : fegDeferredCount

  if (lastPayout) {
    lastPayout = { ...lastPayout, amountCad: Math.round(lastPayout.amountCad * 100) / 100 }
  }

  return {
    grossPendingCad: open,
    deferredCad: deferred,
    totalBalanceCad: Math.round((open + deferred) * 100) / 100,
    openGroupsCount: openCount,
    deferredGroupsCount: deferredCount,
    lastPayout,
    ddbrCad: ddbr.ddbrCad,
    ddbrAvailable: ddbr.ddbrAvailable,
    fetchedAt: new Date().toISOString(),
  }
}
