/**
 * self_repair/digest.ts
 *
 * F18: morning_digest summary line for self_repair.
 * Queries self_repair_runs for the last 24h.
 * Never throws — returns 'Self-repair: stats unavailable' on any error.
 *
 * Format:
 *   Self-repair (24h): N attempts, M PRs opened, K verify-failed, J cap-exceeded
 *   [optional: — ⚠️ X PRs unreviewed >7d]
 *
 * Acceptance: spec §I (morning_digest line).
 */

import { createServiceClient } from '@/lib/supabase/service'

interface SelfRepairRunRow {
  status: string
  pr_url: string | null
  detected_at: string
}

const STALE_PR_DAYS = 7

export async function buildSelfRepairDigestLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()

    const { data, error } = await db
      .from('self_repair_runs')
      .select('status, pr_url, detected_at')
      .gte('detected_at', since)
      .limit(500)

    if (error) return 'Self-repair: stats unavailable'

    const rows = (data ?? []) as SelfRepairRunRow[]
    const total = rows.length

    if (total === 0) return 'Self-repair (24h): no attempts'

    const prOpened = rows.filter((r) => r.status === 'pr_opened').length
    const verifyFailed = rows.filter(
      (r) => r.status === 'verify_failed' || r.status === 'verify_timeout'
    ).length
    const capExceeded = rows.filter((r) => r.status === 'cap_exceeded').length

    let line = `Self-repair (24h): ${total} attempts, ${prOpened} PRs opened, ${verifyFailed} verify-failed, ${capExceeded} cap-exceeded`

    // Check for stale unreviewed PRs (open > 7 days)
    // Query all open PRs (not just last 24h) that are older than 7 days
    try {
      const staleCutoff = new Date(Date.now() - STALE_PR_DAYS * 86_400_000).toISOString()
      const { data: staleData } = await db
        .from('self_repair_runs')
        .select('id, pr_url, detected_at')
        .eq('status', 'pr_opened')
        .lt('detected_at', staleCutoff)
        .not('pr_url', 'is', null)
        .limit(100)

      const staleCount = (staleData ?? []).length
      if (staleCount > 0) {
        line += ` — ⚠️ ${staleCount} PRs unreviewed >${STALE_PR_DAYS}d`
      }
    } catch {
      // Non-fatal — omit stale check on error
    }

    return line
  } catch {
    return 'Self-repair: stats unavailable'
  }
}
