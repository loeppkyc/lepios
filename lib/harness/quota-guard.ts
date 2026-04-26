/**
 * Pre-claim quota guard for the Routines API.
 *
 * Prevents task-pickup from claiming (and then bricking) a task when the
 * Routines API is in a 429 backoff window. Called once per pickup tick,
 * before claimTask().
 *
 * Signal source: agent_events rows where
 *   action = 'invoke_coordinator', status = 'error', meta.upstream_status = 429
 * The Routines API returns a `retry-after` header (seconds); invoke-coordinator
 * stores it as meta.retry_after (string). We use that to compute the cutoff.
 */

import { createServiceClient } from '@/lib/supabase/service'

const GUARD_WINDOW_MS = 6 * 60 * 60 * 1000 // look back 6h for 429 events
const DEFAULT_BACKOFF_MINUTES = 60 // fallback when retry_after absent

export interface QuotaGuardResult {
  safe_to_claim: boolean
  reason:
    | 'no_recent_429s'
    | 'quota_429_backoff_active'
    | 'quota_429_backoff_expired'
    | 'guard_error'
  retry_after_minutes?: number
}

function parseRetryAfterCutoff(retryAfter: string | undefined, occurredAt: string): number {
  const occurredMs = new Date(occurredAt).getTime()

  if (retryAfter == null || retryAfter === '') {
    return occurredMs + DEFAULT_BACKOFF_MINUTES * 60 * 1000
  }

  const asSeconds = Number(retryAfter)
  if (!isNaN(asSeconds) && asSeconds >= 0) {
    // Integer seconds from when the 429 was received
    return occurredMs + asSeconds * 1000
  }

  const asDate = new Date(retryAfter).getTime()
  if (!isNaN(asDate)) {
    return asDate
  }

  // Unparseable — fall back to default
  return occurredMs + DEFAULT_BACKOFF_MINUTES * 60 * 1000
}

export async function preClaimQuotaCheck(): Promise<QuotaGuardResult> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - GUARD_WINDOW_MS).toISOString()

    const { data, error } = await db
      .from('agent_events')
      .select('occurred_at, meta')
      .eq('action', 'invoke_coordinator')
      .eq('status', 'error')
      .filter('meta->>upstream_status', 'eq', '429')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(1)

    if (error) return { safe_to_claim: true, reason: 'guard_error' }
    if (!data || data.length === 0) return { safe_to_claim: true, reason: 'no_recent_429s' }

    const event = data[0] as { occurred_at: string; meta: Record<string, unknown> }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const retryAfter = (event.meta as any)?.retry_after as string | undefined
    const cutoffMs = parseRetryAfterCutoff(retryAfter, event.occurred_at)
    const nowMs = Date.now()

    if (cutoffMs > nowMs) {
      const retry_after_minutes = Math.ceil((cutoffMs - nowMs) / 60_000)
      return {
        safe_to_claim: false,
        reason: 'quota_429_backoff_active',
        retry_after_minutes,
      }
    }

    return { safe_to_claim: true, reason: 'quota_429_backoff_expired' }
  } catch {
    // Guard failure must never block pickup — fail open
    return { safe_to_claim: true, reason: 'guard_error' }
  }
}

// ── F18: morning_digest summary line ─────────────────────────────────────────
// Counts pickup_skipped_quota_guard events in the last 24h.
// Never throws.

export async function buildQuotaGuardLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()

    const { data, error } = await db
      .from('agent_events')
      .select('id')
      .eq('action', 'task_pickup')
      .eq('task_type', 'pickup_skipped_quota_guard')
      .gte('occurred_at', since)
      .limit(50)

    if (error) return 'Quota guard skips (24h): unavailable'

    const count = (data ?? []).length
    if (count === 0) return 'Quota guard skips (24h): 0 ✅'
    return `Quota guard skips (24h): ${count} ⚠️ | Routines 429 backoff prevented ${count} pickup${count === 1 ? '' : 's'}`
  } catch {
    return 'Quota guard skips (24h): unavailable'
  }
}
