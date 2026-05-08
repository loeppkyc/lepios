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

    // Signal 2: token budget
    const db = createServiceClient()
    const { used, limit, threshold } = await readTokenBudget(db)
    const usage_pct = limit > 0 ? Math.round((used / limit) * 100) : 0
    const should_halt = usage_pct >= threshold

    return {
      usage_pct,
      threshold,
      should_halt,
      signal: should_halt ? 'token_budget' : 'ok',
      detail: `tokens used=${used.toLocaleString()} / limit=${limit.toLocaleString()} (${usage_pct}%)`,
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
    await db.from('harness_config').update({ value: 'true' }).eq('key', 'HARNESS_HALTED')
  } catch {
    // Non-fatal
  }

  // Clear HARNESS_CONTINUOUS_RUN_ID
  try {
    await db.from('harness_config').update({ value: '' }).eq('key', 'HARNESS_CONTINUOUS_RUN_ID')
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
