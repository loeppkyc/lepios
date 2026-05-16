/**
 * lib/harness/quota-monitor.ts — quota awareness for continuous coordinator mode.
 *
 * Checks Anthropic API / routines usage before each continuous-mode pickup.
 * Two signals:
 *   1. Routines 429 backoff (from quota-guard.ts pattern) → treat as 100%
 *   2. Token budget: harness_config keys HARNESS_QUOTA_TOKENS_USED /
 *      HARNESS_QUOTA_TOKENS_LIMIT → usage pct
 *
 * Threshold from harness_config.HARNESS_QUOTA_THRESHOLD (default 85).
 * Check fires on every task pickup AND at most every 10 minutes (via
 * coordinator_run_state.last_quota_check_at — skip if <10 min ago).
 *
 * On threshold breach: writes halt state to coordinator_run_state, sets
 * HARNESS_HALTED=true, inserts agent_events row. Caller sends Telegram summary.
 *
 * Fails open — errors never block pickup.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { preClaimQuotaCheck } from '@/lib/harness/quota-guard'
import { guardedWrite } from '@/lib/supabase/service-write'
import { postMessage } from '@/lib/orchestrator/telegram'

export interface QuotaStatus {
  usage_pct: number
  threshold: number
  should_halt: boolean
  signal: 'routines_429' | 'token_budget' | 'ok' | 'guard_error'
  detail: string
  skip_check: boolean
}

const CHECK_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes

// ── Quota read ────────────────────────────────────────────────────────────────

async function readTokenBudget(db: ReturnType<typeof createServiceClient>): Promise<{
  used: number
  limit: number
  threshold: number
}> {
  const { data } = await db
    .from('harness_config')
    .select('key, value')
    .in('key', [
      'HARNESS_QUOTA_TOKENS_USED',
      'HARNESS_QUOTA_TOKENS_LIMIT',
      'HARNESS_QUOTA_THRESHOLD',
    ])

  const rows = (data ?? []) as { key: string; value: string }[]
  const get = (k: string, fallback: number) => {
    const row = rows.find((r) => r.key === k)
    const n = Number(row?.value)
    return isNaN(n) ? fallback : n
  }

  return {
    used: get('HARNESS_QUOTA_TOKENS_USED', 0),
    limit: get('HARNESS_QUOTA_TOKENS_LIMIT', 1_000_000),
    threshold: get('HARNESS_QUOTA_THRESHOLD', 85),
  }
}

// ── Should-skip check (10-min interval) ──────────────────────────────────────

async function shouldSkipCheck(runId: string): Promise<boolean> {
  try {
    const db = createServiceClient()
    const { data } = await db
      .from('coordinator_run_state')
      .select('last_quota_check_at')
      .eq('id', runId)
      .maybeSingle()

    if (!data?.last_quota_check_at) return false
    const lastMs = new Date(data.last_quota_check_at).getTime()
    return Date.now() - lastMs < CHECK_INTERVAL_MS
  } catch {
    return false
  }
}

async function stampCheckTime(runId: string): Promise<void> {
  try {
    const db = createServiceClient()
    await db
      .from('coordinator_run_state')
      .update({ last_quota_check_at: new Date().toISOString() })
      .eq('id', runId)
  } catch {
    // Non-fatal
  }
}

// ── Main check ────────────────────────────────────────────────────────────────

export async function checkQuota(runId: string): Promise<QuotaStatus> {
  try {
    // Skip if checked <10 min ago
    const skip = await shouldSkipCheck(runId)
    if (skip) {
      return {
        usage_pct: 0,
        threshold: 85,
        should_halt: false,
        signal: 'ok',
        detail: 'within check interval',
        skip_check: true,
      }
    }

    await stampCheckTime(runId)

    // Signal 1: routines 429 backoff
    const guard = await preClaimQuotaCheck()
    if (!guard.safe_to_claim && guard.reason === 'quota_429_backoff_active') {
      return {
        usage_pct: 100,
        threshold: 85,
        should_halt: true,
        signal: 'routines_429',
        detail: `routines 429 backoff active; retry_after=${guard.retry_after_minutes ?? '?'}min`,
        skip_check: false,
      }
    }

    // Signal 2: Routines invocation count (replaces dead HARNESS_QUOTA_TOKENS_USED signal).
    // Reads ROUTINES_INVOCATIONS_TODAY from harness_config (written by invoke-coordinator).
    // Falls back to agent_events count when cursor is unavailable.
    const db = createServiceClient()
    const { threshold } = await readTokenBudget(db) // still reads HARNESS_QUOTA_THRESHOLD for the %

    let invocations_24h = 0
    try {
      const { data: configRows } = await db
        .from('harness_config')
        .select('key, value')
        .in('key', ['ROUTINES_INVOCATIONS_TODAY', 'ROUTINES_INVOCATIONS_WINDOW_START'])
      const get = (k: string) =>
        (configRows as { key: string; value: string }[] | null)?.find((r) => r.key === k)?.value ??
        ''
      const windowStart = get('ROUTINES_INVOCATIONS_WINDOW_START')
      const windowStartMs = windowStart ? new Date(windowStart).getTime() : 0
      const WINDOW_MS = 24 * 60 * 60 * 1_000
      if (!windowStartMs || Date.now() - windowStartMs > WINDOW_MS) {
        invocations_24h = 0
      } else {
        invocations_24h = parseInt(get('ROUTINES_INVOCATIONS_TODAY'), 10) || 0
      }
    } catch {
      // Fallback: count from agent_events
      try {
        const { data } = await db
          .from('agent_events')
          .select('id')
          .eq('action', 'invoke_coordinator')
          .eq('status', 'success')
          .gte('occurred_at', new Date(Date.now() - 86_400_000).toISOString())
        invocations_24h = (data ?? []).length
      } catch {
        // Non-fatal — fail open
      }
    }

    // Express as % of CLIFF_THRESHOLD (12) for compatibility with existing threshold logic.
    const CLIFF = 12
    const usage_pct = Math.round((invocations_24h / CLIFF) * 100)
    const should_halt = usage_pct >= threshold

    return {
      usage_pct,
      threshold,
      should_halt,
      signal: should_halt ? 'token_budget' : 'ok',
      detail: `routines invocations today=${invocations_24h} / cliff=${CLIFF} (${usage_pct}%)`,
      skip_check: false,
    }
  } catch (err) {
    // Fail open
    return {
      usage_pct: 0,
      threshold: 85,
      should_halt: false,
      signal: 'guard_error',
      detail: String(err),
      skip_check: false,
    }
  }
}

// ── Halt writer ───────────────────────────────────────────────────────────────

export interface HaltResult {
  ok: boolean
  run_id: string
  modules_shipped: string[]
  modules_shipped_count: number
  quota_pct: number
  telegram_lines: string[]
}

export async function haltContinuousRun(
  runId: string,
  quotaStatus: QuotaStatus
): Promise<HaltResult> {
  const db = createServiceClient()

  // Read current run state for summary
  let modules_shipped: string[] = []
  let modules_shipped_count = 0
  let modules_attempted_count = 0
  let current_target: string | null = null

  try {
    const { data } = await db
      .from('coordinator_run_state')
      .select('modules_shipped, modules_shipped_count, modules_attempted_count, current_target')
      .eq('id', runId)
      .maybeSingle()

    if (data) {
      modules_shipped = (data.modules_shipped as string[]) ?? []
      modules_shipped_count = (data.modules_shipped_count as number) ?? 0
      modules_attempted_count = (data.modules_attempted_count as number) ?? 0
      current_target = data.current_target as string | null
    }
  } catch {
    // Proceed with defaults
  }

  // Write halt state to coordinator_run_state
  let haltWriteOk = false
  try {
    await db
      .from('coordinator_run_state')
      .update({
        status: 'halted_quota',
        quota_pct_at_halt: quotaStatus.usage_pct,
        halted_at: new Date().toISOString(),
      })
      .eq('id', runId)
    haltWriteOk = true
  } catch {
    // Proceed — still need to set HARNESS_HALTED
  }

  // Set HARNESS_HALTED=true
  try {
    await guardedWrite(db.from('harness_config').update({ value: 'true' }).eq('key', 'HARNESS_HALTED'), 'harness_config', 'update')
  } catch {
    // Non-fatal
  }

  // Clear HARNESS_CONTINUOUS_RUN_ID
  try {
    await guardedWrite(db.from('harness_config').update({ value: '' }).eq('key', 'HARNESS_CONTINUOUS_RUN_ID'), 'harness_config', 'update')
  } catch {
    // Non-fatal
  }

  // Log to agent_events
  try {
    await db.from('agent_events').insert({
      domain: 'orchestrator',
      action: 'continuous_run_halted_quota',
      actor: 'quota_monitor',
      status: 'warning',
      task_type: 'quota_halt',
      output_summary: `continuous run ${runId.slice(0, 8)} halted: ${quotaStatus.detail}`,
      meta: {
        run_id: runId,
        usage_pct: quotaStatus.usage_pct,
        threshold: quotaStatus.threshold,
        signal: quotaStatus.signal,
        modules_shipped_count,
        current_target,
      },
      tags: ['continuous-mode', 'quota', 'harness'],
    })
  } catch {
    // Non-fatal
  }

  const pctRemaining = Math.max(0, quotaStatus.threshold - quotaStatus.usage_pct)
  const telegram_lines = [
    `[LepiOS] Continuous run halted — quota threshold reached`,
    ``,
    `Modules shipped: ${modules_shipped_count} / ${modules_attempted_count} attempted`,
    modules_shipped.length > 0
      ? `Shipped: ${modules_shipped.slice(0, 5).join(', ')}${modules_shipped.length > 5 ? ` +${modules_shipped.length - 5} more` : ''}`
      : `Shipped: none`,
    ``,
    `Quota: ${quotaStatus.usage_pct}% used (threshold: ${quotaStatus.threshold}%)`,
    `Signal: ${quotaStatus.signal} — ${quotaStatus.detail}`,
    ``,
    `Send /resume when quota refreshes to continue from: ${current_target ?? 'top of queue'}`,
  ]

  return {
    ok: haltWriteOk,
    run_id: runId,
    modules_shipped,
    modules_shipped_count,
    quota_pct: quotaStatus.usage_pct,
    telegram_lines,
  }
}

// ── Quota halt auto-resume check ─────────────────────────────────────────────
//
// Called by pickup-runner.ts when HARNESS_HALTED == 'true'.
// Returns true if the halt was cleared (quota window has rolled), false if halt
// remains active. Fails open — any error returns false so pickup exits as before.

export async function checkAndClearQuotaHalt(runId: string): Promise<boolean> {
  try {
    const db = createServiceClient()
    const { data: rows } = await db
      .from('harness_config')
      .select('key, value')
      .in('key', [
        'ROUTINES_INVOCATIONS_TODAY',
        'ROUTINES_INVOCATIONS_WINDOW_START',
        'HARNESS_QUOTA_THRESHOLD',
      ])

    const get = (k: string) =>
      (rows as { key: string; value: string }[] | null)?.find((r) => r.key === k)?.value ?? ''

    const windowStart = get('ROUTINES_INVOCATIONS_WINDOW_START')
    const windowStartMs = windowStart ? new Date(windowStart).getTime() : 0
    const invocationsToday = parseInt(get('ROUTINES_INVOCATIONS_TODAY'), 10) || 0
    const threshold = parseInt(get('HARNESS_QUOTA_THRESHOLD'), 10) || 85

    const WINDOW_MS = 24 * 60 * 60 * 1000
    const windowRolled = !windowStartMs || Date.now() - windowStartMs > WINDOW_MS
    const counterReset = invocationsToday === 0

    // Quota fresh if: window rolled OR counter explicitly reset to 0
    const quotaFresh = windowRolled || counterReset

    // Secondary gate: even if window hasn't fully rolled, safe to resume if invocations are
    // below threshold (prevents a halt-clear at 23h59m that would immediately re-halt).
    const CLIFF = 12
    const invocationPct = Math.round((invocationsToday / CLIFF) * 100)
    const belowThreshold = invocationPct < threshold

    if (!quotaFresh && !belowThreshold) return false

    // Clear halt
    await guardedWrite(
      db.from('harness_config').update({ value: 'false' }).eq('key', 'HARNESS_HALTED'),
      'harness_config',
      'update'
    )

    // Log to agent_events
    await db.from('agent_events').insert({
      domain: 'orchestrator',
      action: 'quota_auto_resume',
      actor: 'quota_monitor',
      status: 'success',
      task_type: 'quota_auto_resume',
      output_summary: `quota halt cleared — window rolled or counter reset`,
      meta: {
        run_id: runId,
        invocations_at_resume: invocationsToday,
        window_start_at: windowStart,
        quota_pct: invocationPct,
      },
      tags: ['harness', 'quota', 'auto-resume'],
    })

    // Telegram fire-and-forget
    void postMessage(
      '[LepiOS Harness] Quota auto-resumed — daily window rolled. Pickup continuing.'
    ).catch(() => {})

    return true
  } catch {
    // Fail open — never blocks pickup
    return false
  }
}

// ── Token usage increment (called after each harness Anthropic API call) ──────

export async function incrementTokensUsed(tokens: number): Promise<void> {
  if (tokens <= 0) return
  try {
    const db = createServiceClient()
    const { data } = await db
      .from('harness_config')
      .select('value')
      .eq('key', 'HARNESS_QUOTA_TOKENS_USED')
      .maybeSingle()

    const current = Number((data as { value: string } | null)?.value ?? '0')
    const updated = isNaN(current) ? tokens : current + tokens

    await db
      .from('harness_config')
      .update({ value: String(updated) })
      .eq('key', 'HARNESS_QUOTA_TOKENS_USED')
  } catch {
    // Non-fatal
  }
}
