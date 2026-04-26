/**
 * Predictive quota forecast for Routines API capacity.
 *
 * Called at coordinator startup to decide whether starting a task is safe given
 * current quota burn rate and any active 429 backoff. Complements the reactive
 * quota-guard (which fires at claim time) with a proactive startup gate.
 *
 * Signal sources:
 *   - agent_events: invoke_coordinator status='error' meta.upstream_status='429'  → active backoff
 *   - agent_events: invoke_coordinator status='success' last 24h                  → burn rate
 *
 * Empirical basis (Apr 23–26 2026):
 *   - Observed cliff at ~12 invocations/day (Apr 25: 12 invocations, hit 429)
 *   - CLIFF_THRESHOLD set conservatively at 10 to leave a 2-invocation buffer
 *   - Typical task cost: 1–3 invocations (initial invoke + up to 2 retries)
 */

import { createServiceClient } from '@/lib/supabase/service'

const CLIFF_THRESHOLD = 10 // conservative; observed limit ~12/day
const TASK_COST_MAX = 3 // worst case: initial invoke + 2 retries
const BURN_LOOKBACK_MS = 24 * 60 * 60 * 1000 // 24h rolling window
const GUARD_WINDOW_MS = 6 * 60 * 60 * 1000 // look back 6h for 429 events
const EXPIRING_SOON_MS = 60 * 60 * 1000 // <1h remaining → treat as already reset
const DEFAULT_BACKOFF_MS = 60 * 60 * 1000 // fallback when retry_after absent

export interface QuotaForecastResult {
  safe_to_start: boolean
  reason:
    | 'quota_healthy'
    | 'recent_429_backoff_active'
    | 'recent_429_expiring_soon' // <1h remaining — treat quota as reset
    | 'burn_rate_cliff_risk'
    | 'forecast_error'
  invocations_24h: number
  cliff_threshold: number
  estimated_remaining: number // cliff_threshold − invocations_24h (−1 when not computed)
  recommended_wait_minutes?: number
}

function parseRetryAfterCutoff(retryAfter: string | undefined, occurredAt: string): number {
  const occurredMs = new Date(occurredAt).getTime()
  if (retryAfter == null || retryAfter === '') return occurredMs + DEFAULT_BACKOFF_MS

  const asSeconds = Number(retryAfter)
  if (!isNaN(asSeconds) && asSeconds >= 0) return occurredMs + asSeconds * 1000

  const asDate = new Date(retryAfter).getTime()
  if (!isNaN(asDate)) return asDate

  return occurredMs + DEFAULT_BACKOFF_MS
}

export async function forecastQuotaBeforeStart(): Promise<QuotaForecastResult> {
  try {
    const db = createServiceClient()
    const now = Date.now()

    // ── Step 1: check for active 429 backoff ─────────────────────────────────
    const { data: recent429s } = await db
      .from('agent_events')
      .select('occurred_at, meta')
      .eq('action', 'invoke_coordinator')
      .eq('status', 'error')
      .filter('meta->>upstream_status', 'eq', '429')
      .gte('occurred_at', new Date(now - GUARD_WINDOW_MS).toISOString())
      .order('occurred_at', { ascending: false })
      .limit(1)

    if (recent429s && recent429s.length > 0) {
      const event = recent429s[0] as { occurred_at: string; meta: Record<string, unknown> }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const retryAfter = (event.meta as any)?.retry_after as string | undefined
      const cutoffMs = parseRetryAfterCutoff(retryAfter, event.occurred_at)
      const remaining_ms = cutoffMs - now

      if (remaining_ms > EXPIRING_SOON_MS) {
        // Backoff active, more than 1h remaining — block coordinator start
        return {
          safe_to_start: false,
          reason: 'recent_429_backoff_active',
          invocations_24h: -1,
          cliff_threshold: CLIFF_THRESHOLD,
          estimated_remaining: 0,
          recommended_wait_minutes: Math.ceil(remaining_ms / 60_000),
        }
      }

      if (remaining_ms > 0) {
        // Backoff exists but expires within 1h — treat quota as effectively reset
        return {
          safe_to_start: true,
          reason: 'recent_429_expiring_soon',
          invocations_24h: -1,
          cliff_threshold: CLIFF_THRESHOLD,
          estimated_remaining: CLIFF_THRESHOLD,
          recommended_wait_minutes: Math.ceil(remaining_ms / 60_000),
        }
      }
      // remaining_ms <= 0 → backoff expired; fall through to burn-rate check
    }

    // ── Step 2: check burn rate ───────────────────────────────────────────────
    const { data: burnRows, error: burnError } = await db
      .from('agent_events')
      .select('id')
      .eq('action', 'invoke_coordinator')
      .eq('status', 'success')
      .gte('occurred_at', new Date(now - BURN_LOOKBACK_MS).toISOString())

    if (burnError) {
      return {
        safe_to_start: true,
        reason: 'forecast_error',
        invocations_24h: 0,
        cliff_threshold: CLIFF_THRESHOLD,
        estimated_remaining: CLIFF_THRESHOLD,
      }
    }

    const invocations_24h = (burnRows ?? []).length
    const estimated_remaining = CLIFF_THRESHOLD - invocations_24h

    if (estimated_remaining < TASK_COST_MAX) {
      return {
        safe_to_start: false,
        reason: 'burn_rate_cliff_risk',
        invocations_24h,
        cliff_threshold: CLIFF_THRESHOLD,
        estimated_remaining,
        recommended_wait_minutes: 60, // suggest waiting for the 24h window to roll
      }
    }

    return {
      safe_to_start: true,
      reason: 'quota_healthy',
      invocations_24h,
      cliff_threshold: CLIFF_THRESHOLD,
      estimated_remaining,
    }
  } catch {
    // Fail open — forecast failure must never block coordinator startup
    return {
      safe_to_start: true,
      reason: 'forecast_error',
      invocations_24h: 0,
      cliff_threshold: CLIFF_THRESHOLD,
      estimated_remaining: CLIFF_THRESHOLD,
    }
  }
}

// ── F18: morning_digest line ──────────────────────────────────────────────────
// Counts coordinator_startup_skipped_quota_forecast events in the last 24h.
// Never throws.

export async function buildStartupForecastLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()

    const { data, error } = await db
      .from('agent_events')
      .select('id')
      .eq('action', 'coordinator_startup_skipped_quota_forecast')
      .gte('occurred_at', since)
      .limit(50)

    if (error) return 'Coordinator startup skips (24h): unavailable'

    const count = (data ?? []).length
    if (count === 0) return 'Coordinator startup skips (24h): 0 ✅'
    return `Coordinator startup skips (24h): ${count} ⚠️ | Quota forecast blocked ${count} coordinator start${count === 1 ? '' : 's'}`
  } catch {
    return 'Coordinator startup skips (24h): unavailable'
  }
}
