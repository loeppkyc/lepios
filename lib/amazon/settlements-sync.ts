import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllFinancialEventGroups } from './finances'
import type { FinancialEventGroup } from './finances'

// ── Public types ──────────────────────────────────────────────────────────────

export interface SettlementsRow {
  id: string // FinancialEventGroupId (PK)
  period_start_at: string | null
  period_end_at: string | null // null for open (not-yet-transferred) groups
  currency: string
  net_payout: number | null // OriginalTotal.CurrencyAmount (actual payout)
  gross: number | null // deferred — requires per-group /financialEvents
  fees_total: number | null // deferred
  refunds_total: number | null // deferred
  fund_transfer_status: string | null // null for open groups
  raw_json: Record<string, unknown>
  updated_at: string
}

export interface SettlementsSyncResult {
  fetched: number // total groups returned by SP-API (all currencies)
  inserted: number // successful upserts (insert or update — upsert can't distinguish)
  updated: number // always 0 — tracked separately once SELECT-before-upsert is added
  skipped: number // non-CAD groups filtered out
  errors: number // failed upserts
}

export interface SettlementsSyncParams {
  /** How many days back to fetch settlement groups. Default 35 (generous overlap). */
  daysBack?: number
  supabase: SupabaseClient
  /** Fetch and count but do not write to DB. */
  dryRun?: boolean
}

// ── mapSettlementGroupToRow — pure ────────────────────────────────────────────

export function mapSettlementGroupToRow(group: FinancialEventGroup): SettlementsRow {
  return {
    id: group.FinancialEventGroupId,
    period_start_at: group.FinancialEventGroupStart ?? null,
    period_end_at: group.FinancialEventGroupEnd ?? null,
    currency: group.OriginalTotal?.CurrencyCode ?? 'CAD',
    net_payout:
      group.OriginalTotal?.CurrencyAmount != null
        ? Math.round(group.OriginalTotal.CurrencyAmount * 100) / 100
        : null,
    gross: null,
    fees_total: null,
    refunds_total: null,
    fund_transfer_status: group.FundTransferStatus ?? null,
    raw_json: group as unknown as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  }
}

// ── syncSettlementsForRange — DB writes ───────────────────────────────────────

/**
 * Fetch all financial event groups for the last `daysBack` days and upsert
 * CAD-only groups into amazon_settlements.
 *
 * - CAD filter: matches fetchSettlementBalance constraint B-2
 *   (at least one open group has MXN $0 — skip it)
 * - Upserts on id conflict — safe to re-run (idempotent)
 * - Per-group DB failures counted but never abort the batch
 * - dryRun=true fetches + counts but skips all DB writes
 */
export async function syncSettlementsForRange({
  daysBack = 35,
  supabase,
  dryRun = false,
}: SettlementsSyncParams): Promise<SettlementsSyncResult> {
  const groups = await fetchAllFinancialEventGroups(daysBack)

  const cadGroups = groups.filter((g) => g.OriginalTotal?.CurrencyCode === 'CAD')
  const skipped = groups.length - cadGroups.length

  let inserted = 0
  let errors = 0

  for (const group of cadGroups) {
    const row = mapSettlementGroupToRow(group)

    if (dryRun) {
      inserted++
      continue
    }

    try {
      const { error } = await supabase.from('amazon_settlements').upsert(row, {
        onConflict: 'id',
      })
      if (error) {
        errors++
      } else {
        inserted++
      }
    } catch {
      errors++
    }
  }

  return { fetched: groups.length, inserted, updated: 0, skipped, errors }
}
