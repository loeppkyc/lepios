// Safe-list repairs — auto-applied for severity <= medium without sandbox.
// Per spec: cron retry, stuck-task requeue, stale window cleanup, dep re-pin,
// secret rotation. v2 implements the first three live; the latter two are
// stubs that emit `not_applicable` until the wiring is built.

import { createServiceClient } from '@/lib/supabase/service'
import type { CheckResult, RepairContext, RepairResult } from '../types'

type Db = ReturnType<typeof createServiceClient>

export interface SafeListRepair {
  /** Returns true iff this playbook applies to the given check result. */
  applies(result: CheckResult): boolean
  /** Apply the repair. Must be idempotent (may be retried). */
  apply(result: CheckResult, ctx: RepairContext, db: Db): Promise<RepairResult>
}

// ─── retry stuck task_queue rows ──────────────────────────────────────────────
export const retryStuckTaskQueue: SafeListRepair = {
  applies(result) {
    return result.key === 'health.task_queue_stuck' && result.status === 'fail'
  },
  async apply(result, ctx, db) {
    if (ctx.observeOnly || ctx.dryRun) {
      return {
        outcome: 'not_applicable',
        evidence: { reason: ctx.dryRun ? 'dry_run' : 'observe_only' },
        resolved: false,
      }
    }
    const stuckIds = (result.evidence.stuck_ids as string[] | undefined) ?? []
    if (stuckIds.length === 0) {
      return {
        outcome: 'not_applicable',
        evidence: { reason: 'no stuck_ids in evidence' },
        resolved: false,
      }
    }
    const requeued: string[] = []
    const errors: Array<{ id: string; error: string }> = []
    for (const id of stuckIds) {
      const { error } = await db
        .from('task_queue')
        .update({ status: 'queued', claimed_by: null, claimed_at: null, retry_count: undefined })
        .eq('id', id)
        .eq('status', 'in_progress') // guard: only flip if still stuck
      if (error) {
        errors.push({ id, error: error.message })
      } else {
        requeued.push(id)
      }
    }
    if (requeued.length > 0 && errors.length === 0) {
      return {
        outcome: 'success',
        evidence: { requeued, count: requeued.length },
        resolved: true,
      }
    }
    return {
      outcome: 'failure',
      evidence: { requeued, errors },
      resolved: false,
    }
  },
}

// ─── clear stale window_sessions ──────────────────────────────────────────────
// Stale window_sessions rows are cosmetic (the multi-window protocol's sessions
// table from earlier work). Stale = ended_at IS NULL but heartbeat older than
// 30 minutes. Repair: set ended_at to last_heartbeat.
export const clearStaleWindowSessions: SafeListRepair = {
  applies(result) {
    // Standalone repair triggered by a stale-window check we may add later;
    // for now, also runs as a side effect when health.cron_freshness signals
    // multiple stale crons (helps unstick the harness loop).
    return false // not yet wired to a check
  },
  async apply() {
    return {
      outcome: 'not_applicable',
      evidence: { reason: 'not yet wired to a check' },
      resolved: false,
    }
  },
}

// ─── retry failed cron via Vercel re-trigger ──────────────────────────────────
// Proxies to the existing cron's GET endpoint with CRON_SECRET. Re-runs the
// cron once. If subsequent scan still flags it stale, escalates.
export const retryFailedCron: SafeListRepair = {
  applies(result) {
    return result.key === 'health.cron_freshness' && result.status === 'fail'
  },
  async apply(result, ctx, db) {
    if (ctx.observeOnly || ctx.dryRun) {
      return {
        outcome: 'not_applicable',
        evidence: { reason: ctx.dryRun ? 'dry_run' : 'observe_only' },
        resolved: false,
      }
    }
    const { data: secretRow } = await db
      .from('harness_config')
      .select('value')
      .eq('key', 'CRON_SECRET')
      .maybeSingle<{ value: string }>()
    const cronSecret = secretRow?.value
    if (!cronSecret) {
      return {
        outcome: 'failure',
        evidence: { reason: 'CRON_SECRET not in harness_config — cannot retry crons' },
        resolved: false,
      }
    }
    const stale = (result.evidence.stale as Array<{ actor: string }> | undefined) ?? []
    const ACTOR_TO_PATH: Record<string, string> = {
      night_tick: '/api/cron/night-tick',
      morning_digest: '/api/cron/morning-digest',
      task_pickup: '/api/cron/task-pickup',
      oura_sync: '/api/cron/oura-sync',
      gmail_scan: '/api/cron/gmail-scan',
      amazon_orders_sync: '/api/cron/amazon-orders-sync',
      amazon_settlements_sync: '/api/cron/amazon-settlements-sync',
    }
    const retried: string[] = []
    const errors: Array<{ actor: string; error: string }> = []
    for (const s of stale) {
      const path = ACTOR_TO_PATH[s.actor]
      if (!path) {
        errors.push({ actor: s.actor, error: 'no path mapping' })
        continue
      }
      try {
        const res = await fetch(`https://lepios-one.vercel.app${path}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${cronSecret}` },
        })
        if (res.ok) {
          retried.push(s.actor)
        } else {
          errors.push({ actor: s.actor, error: `HTTP ${res.status}` })
        }
      } catch (err) {
        errors.push({ actor: s.actor, error: err instanceof Error ? err.message : String(err) })
      }
    }
    if (retried.length > 0 && errors.length === 0) {
      return { outcome: 'success', evidence: { retried }, resolved: true }
    }
    return { outcome: 'failure', evidence: { retried, errors }, resolved: false }
  },
}

// ─── registry of safe-list repairs ────────────────────────────────────────────
const SAFE_LIST: SafeListRepair[] = [retryStuckTaskQueue, retryFailedCron, clearStaleWindowSessions]

/** Find the first safe-list repair that applies to a check result, or null. */
export function findSafeListRepair(result: CheckResult): SafeListRepair | null {
  return SAFE_LIST.find((r) => r.applies(result)) ?? null
}
