import { spFetch } from './client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FinancialEventGroup {
  FinancialEventGroupId: string
  /**
   * Absent on open (not-yet-transferred) groups.
   * Closed groups have this set to e.g. "Transferred".
   * Constraint B-1: check field presence, not value.
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
  /** Open CAD groups (no FundTransferStatus) = Standard orders Total Balance */
  grossPendingCad: number
  /** Deferred CAD groups (FundTransferStatus set but not "Transferred") = Deferred transactions */
  deferredCad: number
  /** Total Amazon owes you: grossPendingCad + deferredCad = All Accounts Total Balance */
  totalBalanceCad: number
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

  for (const group of groups) {
    const isCad = group.OriginalTotal?.CurrencyCode === 'CAD'
    if (!isCad) continue

    const amount = group.OriginalTotal?.CurrencyAmount ?? 0
    const hasStatus = 'FundTransferStatus' in group && group.FundTransferStatus !== undefined

    if (!hasStatus) {
      // Open group (no FundTransferStatus) = Standard orders Total Balance
      open += amount
    } else if (group.FundTransferStatus !== 'Transferred') {
      // Status set but not yet transferred = Deferred transactions
      deferred += amount
    }
    // Transferred = already paid out, skip
  }

  open = Math.round(open * 100) / 100
  deferred = Math.round(deferred * 100) / 100

  return {
    grossPendingCad: open,
    deferredCad: deferred,
    totalBalanceCad: Math.round((open + deferred) * 100) / 100,
    fetchedAt: new Date().toISOString(),
  }
}
