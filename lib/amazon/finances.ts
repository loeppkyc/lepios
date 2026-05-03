import { spFetch } from './client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FinancialEventGroup {
  FinancialEventGroupId: string
  /** "Open" while accumulating transactions, "Closed" when the period has ended. */
  ProcessingStatus?: string
  /**
   * Set only when a fund transfer has been initiated or completed.
   * Absent on all pending groups (Open or deferred-Closed).
   * Constraint B-1: exclude any group where this field is truthy.
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

// ── Public types ──────────────────────────────────────────────────────────────

export interface SettlementBalance {
  /** ProcessingStatus="Open" + no FundTransferStatus = currently accumulating */
  grossPendingCad: number
  /** ProcessingStatus="Closed" + no FundTransferStatus = period ended, not yet disbursed */
  deferredCad: number
  /** grossPendingCad + deferredCad */
  totalBalanceCad: number
  openGroupsCount: number
  deferredGroupsCount: number
  /** ISO timestamp when the data was fetched */
  fetchedAt: string
}

// ── Core fetch ────────────────────────────────────────────────────────────────

/**
 * Fetch all financial event groups for the last `daysBack` days.
 * Returns every group regardless of currency or status — callers filter.
 * SP-API requires FinancialEventGroupStartedAfter — omitting it returns 400.
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
 * Fetch all financial event groups and sum OriginalTotal.CurrencyAmount
 * for open CAD groups.
 *
 * "Open" = FundTransferStatus field is absent (Constraint B-1).
 * CAD filter required (Constraint B-2): at least one open group has MXN $0.
 * Constraint B-9: no caching — caller's route uses force-dynamic.
 */
export async function fetchSettlementBalance(): Promise<SettlementBalance> {
  const groups = await fetchAllFinancialEventGroups(180)

  let open = 0
  let deferred = 0
  let openCount = 0
  let deferredCount = 0

  for (const group of groups) {
    const isCad = group.OriginalTotal?.CurrencyCode === 'CAD'
    if (!isCad) continue

    // Exclude any group where a fund transfer has been initiated or completed.
    // Matches Streamlit baseline: `if not g.get("FundTransferStatus")`.
    if (group.FundTransferStatus) continue

    const amount = group.OriginalTotal?.CurrencyAmount ?? 0

    if (group.ProcessingStatus === 'Open') {
      open += amount
      openCount++
    } else {
      // Closed + no FundTransferStatus = period ended, not yet disbursed
      deferred += amount
      deferredCount++
    }
  }

  open = Math.round(open * 100) / 100
  deferred = Math.round(deferred * 100) / 100

  return {
    grossPendingCad: open,
    deferredCad: deferred,
    totalBalanceCad: Math.round((open + deferred) * 100) / 100,
    openGroupsCount: openCount,
    deferredGroupsCount: deferredCount,
    fetchedAt: new Date().toISOString(),
  }
}
