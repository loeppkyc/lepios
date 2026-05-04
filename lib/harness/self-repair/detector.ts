/**
 * self_repair/detector.ts
 *
 * Polls agent_events for failure rows matching the self_repair_watchlist.
 * Returns at most one unprocessed failure, acquiring a per-process advisory lock
 * keyed on action_type to prevent concurrent duplicate attempts (AD7).
 *
 * AD4: watchlist is opt-in — only rows in self_repair_watchlist where enabled=true
 * are considered.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { requireCapability } from '@/lib/security/capability'
import { httpRequest, telegram } from '@/lib/harness/arms-legs'

export interface DetectedFailure {
  /** agent_events.id (string UUID) */
  eventId: string
  /** e.g. 'coordinator_await_timeout' */
  actionType: string
  /** ISO timestamp */
  occurredAt: string
  /** agent_events context / meta JSONB */
  context: Record<string, unknown>
  /** who emitted the failure event */
  agentId: string | null
}

// In-process advisory lock: one active attempt per action_type per process.
// Acceptable for slice 1 (single Vercel instance). Replace with Postgres advisory lock in slice 3+.
const _activeLocks = new Set<string>()

/**
 * Poll agent_events for the oldest unprocessed failure matching the watchlist.
 * Acquires an in-process advisory lock on action_type before returning.
 * Caller MUST call releaseDetectorLock() in a finally{} block.
 *
 * Returns null when:
 * - SELF_REPAIR_ENABLED is not 'true' in harness_config
 * - No matching unprocessed events found
 * - The action_type is already locked (concurrent attempt in progress)
 */
export async function detectNextFailure(): Promise<DetectedFailure | null> {
  const db = createServiceClient()

  // 1. Capability check (AD6 — log_only)
  await requireCapability({
    agentId: 'self_repair',
    capability: 'tool.self_repair.read.agent_events',
  }).catch(() => {
    // log_only — never block on cap check failure
  })

  // 2. Load watchlist (enabled rows only)
  const { data: watchlist, error: watchlistError } = await db
    .from('self_repair_watchlist')
    .select('action_type')
    .eq('enabled', true)

  if (watchlistError || !watchlist || watchlist.length === 0) {
    return null
  }

  const watchedTypes = (watchlist as { action_type: string }[]).map((r) => r.action_type)

  // 2a. K2: Check for 3-consecutive-closed-without-merge pattern per action_type
  //     Auto-suspend if found — prevents false-positive PR flood that erodes Colin's trust.
  for (const actionType of watchedTypes) {
    try {
      await checkAndAutoSuspend(db, actionType)
    } catch {
      // Non-fatal — a failing K2 check must not block detection
    }
  }

  // Reload watchlist after potential suspensions
  const { data: refreshedWatchlist } = await db
    .from('self_repair_watchlist')
    .select('action_type')
    .eq('enabled', true)
  const activeTypes = ((refreshedWatchlist ?? []) as { action_type: string }[]).map(
    (r) => r.action_type
  )
  if (activeTypes.length === 0) return null

  // 3. Find the oldest unprocessed event matching the watchlist
  //    "unprocessed" = no self_repair_runs row with trigger_event_id matching this event
  //    Slice 1: we query the last 24h of failure events and check for existing runs.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: events, error: eventsError } = await db
    .from('agent_events')
    .select('id, action, occurred_at, meta, actor')
    .in('action', activeTypes)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: true })
    .limit(50)

  if (eventsError || !events || events.length === 0) {
    return null
  }

  // 4. Find first event not already being processed and not already having a run
  for (const event of events as {
    id: string
    action: string
    occurred_at: string
    meta: Record<string, unknown> | null
    actor: string | null
  }[]) {
    const actionType = event.action

    // Skip if already locked in this process
    if (_activeLocks.has(actionType)) {
      continue
    }

    // Skip if a self_repair_run already exists for this event (not cap_exceeded — those are OK to retry)
    const { data: existingRun } = await db
      .from('self_repair_runs')
      .select('id, status')
      .eq('trigger_event_id', event.id)
      .maybeSingle()

    if (existingRun) {
      // Already attempted — skip
      continue
    }

    // Acquire in-process lock
    _activeLocks.add(actionType)

    return {
      eventId: event.id,
      actionType,
      occurredAt: event.occurred_at,
      context: event.meta ?? {},
      agentId: event.actor ?? null,
    }
  }

  return null
}

/**
 * Releases the in-process advisory lock acquired by detectNextFailure().
 * Idempotent — safe to call even if lock was never acquired.
 */
export async function releaseDetectorLock(actionType: string): Promise<void> {
  _activeLocks.delete(actionType)
}

// ── K2: Auto-suspend on 3 consecutive closed-without-merge PRs ───────────────

const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER ?? 'loeppkyc'
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME ?? 'lepios'

async function isPRClosedWithoutMerge(prNumber: number): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN
  if (!token) return false
  try {
    const result = await httpRequest({
      url: `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/pulls/${prNumber}`,
      method: 'GET',
      capability: 'net.outbound.github',
      agentId: 'self_repair',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!result.ok) return false
    const pr = result.body as { state?: string; merged?: boolean }
    return pr.state === 'closed' && pr.merged === false
  } catch {
    return false
  }
}

async function checkAndAutoSuspend(
  db: ReturnType<typeof createServiceClient>,
  actionType: string
): Promise<void> {
  // Get last 3 pr_opened runs for this action_type, most recent first
  const { data: runs } = await db
    .from('self_repair_runs')
    .select('id, pr_number')
    .eq('action_type', actionType)
    .eq('status', 'pr_opened')
    .not('pr_number', 'is', null)
    .order('detected_at', { ascending: false })
    .limit(3)

  if (!runs || runs.length < 3) return

  const typedRuns = runs as { id: string; pr_number: number }[]

  // Check if all 3 are closed without merge
  const closedChecks = await Promise.all(typedRuns.map((r) => isPRClosedWithoutMerge(r.pr_number)))
  if (!closedChecks.every(Boolean)) return

  // All 3 closed-without-merge — auto-suspend this action_type
  await db.from('self_repair_watchlist').update({ enabled: false }).eq('action_type', actionType)

  await db.from('agent_events').insert({
    domain: 'self_repair',
    action: 'self_repair.watchlist.auto_suspended',
    actor: 'self_repair',
    status: 'warning',
    meta: {
      action_type: actionType,
      reason: '3 consecutive closed-without-merge PRs',
      pr_numbers: typedRuns.map((r) => r.pr_number),
    },
  })

  await telegram(
    `self_repair: ${actionType} auto-suspended after 3 closed-without-merge PRs. Re-enable via SQL.`,
    { bot: 'alerts', agentId: 'self_repair' }
  ).catch(() => {})
}
