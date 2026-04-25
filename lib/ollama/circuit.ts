/**
 * Ollama circuit breaker — state derived from agent_events.
 *
 * No new table, no migration. All state comes from recent ollama.generate events.
 *
 * State rules:
 *   recent_failures >= 3 AND last failure < 5 min ago  → OPEN
 *   recent_failures >= 3 AND last failure > 5 min ago  → HALF_OPEN
 *   recent_failures < 3                                 → CLOSED
 *
 * This module intentionally does NOT import from @/lib/knowledge/client or
 * @/lib/ollama/client to avoid circular dependencies. Transition logging and
 * Telegram alerts are handled by the caller (generate() in client.ts).
 *
 * Circuit check adds ~15ms per generate() call (one indexed SELECT).
 * On any Supabase query failure: default to CLOSED — fail open, never block inference.
 */

import { createServiceClient } from '@/lib/supabase/service'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'
export type CircuitOpenReason = 'server_unreachable' | 'model_not_loaded' | null

export interface CircuitStatus {
  state: CircuitState
  open_reason: CircuitOpenReason // null when CLOSED
  recent_failures: number // failures in last 5 minutes
  last_failure_at: string | null // ISO timestamp
  last_success_at: string | null
  transitioned: boolean // true if state changed from _lastState (for caller to act on)
  prev_state: CircuitState // previous state, so caller knows the transition direction
}

// ── Module-level state for transition detection ────────────────────────────────
// Per process-instance — good enough for Vercel. agent_events is the durable record.

export let _lastState: CircuitState = 'CLOSED'

// ── State derivation ──────────────────────────────────────────────────────────

/**
 * Derive circuit state from agent_events.
 * Never throws — on Supabase error, returns CLOSED (fail open).
 * Reports transition via status.transitioned so caller can log/alert.
 */
export async function getCircuitState(): Promise<CircuitStatus> {
  const defaultClosed: CircuitStatus = {
    state: 'CLOSED',
    open_reason: null,
    recent_failures: 0,
    last_failure_at: null,
    last_success_at: null,
    transitioned: false,
    prev_state: _lastState,
  }

  try {
    const db = createServiceClient()

    // Single query: get all events in last 30 min; compute windows client-side
    // Uses the existing index on (action, occurred_at)
    const { data, error } = await db
      .from('agent_events')
      .select('status, occurred_at')
      .eq('action', 'ollama.generate')
      .gte('occurred_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .order('occurred_at', { ascending: false })

    if (error || !data) return defaultClosed

    const rows = data as Array<{ status: string; occurred_at: string }>

    const now = Date.now()
    const fiveMinAgo = now - 5 * 60 * 1000

    // Failures in last 5 minutes — used for OPEN determination
    const veryRecentFailures = rows.filter(
      (r) => r.status === 'failure' && new Date(r.occurred_at).getTime() > fiveMinAgo
    ).length

    // All failures in the 30-minute window — used for HALF_OPEN determination
    const windowFailures = rows.filter((r) => r.status === 'failure').length

    const lastFailureRow = rows.find((r) => r.status === 'failure')
    const lastSuccessRow = rows.find((r) => r.status === 'success')

    const last_failure_at = lastFailureRow?.occurred_at ?? null
    const last_success_at = lastSuccessRow?.occurred_at ?? null

    // State rules (per acceptance doc):
    // - >=3 failures in last 5 min → OPEN
    // - >=3 failures in 30-min window but last failure >5 min ago → HALF_OPEN
    // - < 3 failures in either window → CLOSED
    let state: CircuitState
    const lastFailureAge = last_failure_at ? now - new Date(last_failure_at).getTime() : Infinity

    if (veryRecentFailures >= 3) {
      state = 'OPEN'
    } else if (windowFailures >= 3 && lastFailureAge >= 5 * 60 * 1000) {
      state = 'HALF_OPEN'
    } else {
      state = 'CLOSED'
    }

    const prevState = _lastState
    const transitioned = state !== prevState
    if (transitioned) {
      _lastState = state
    }

    return {
      state,
      open_reason: null, // Caller sets this based on probe result
      recent_failures: veryRecentFailures,
      last_failure_at,
      last_success_at,
      transitioned,
      prev_state: prevState,
    }
  } catch {
    // Supabase error — fail open
    return defaultClosed
  }
}
