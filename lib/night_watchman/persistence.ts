// Database writes for night-watchman runs / check_results / incidents.
// All paths use service-role client (bypasses RLS — required for cron context).

import { createServiceClient } from '@/lib/supabase/service'
import type { CheckResult, RepairOutcome, Resolution, Scope, Severity } from './types'

type Db = ReturnType<typeof createServiceClient>

interface OpenRunInput {
  scope: Scope
  triggerSource: 'cron' | 'manual' | 'telegram'
  notes?: string
}

export async function openRun(db: Db, input: OpenRunInput): Promise<string> {
  const { data, error } = await db
    .from('night_watchman_runs')
    .insert({
      scope: input.scope,
      trigger_source: input.triggerSource,
      notes: input.notes ?? null,
    })
    .select('id')
    .single()
  if (error || !data) {
    throw new Error(`night_watchman: openRun failed — ${error?.message ?? 'no row'}`)
  }
  return data.id as string
}

interface CloseRunInput {
  runId: string
  totalChecks: number
  totalRepairs: number
  totalIncidents: number
  statusSummary: Record<string, number>
}

export async function closeRun(db: Db, input: CloseRunInput): Promise<void> {
  const { error } = await db
    .from('night_watchman_runs')
    .update({
      finished_at: new Date().toISOString(),
      total_checks: input.totalChecks,
      total_repairs: input.totalRepairs,
      total_incidents: input.totalIncidents,
      status_summary: input.statusSummary,
    })
    .eq('id', input.runId)
  if (error) {
    throw new Error(`night_watchman: closeRun failed — ${error.message}`)
  }
}

interface RecordCheckResultInput {
  runId: string
  result: CheckResult
  repairAttempted: boolean
  repairOutcome?: RepairOutcome
  repairEvidence?: Record<string, unknown>
}

/** Insert one check_results row. Returns the inserted id. */
export async function recordCheckResult(db: Db, input: RecordCheckResultInput): Promise<string> {
  const { data, error } = await db
    .from('night_watchman_check_results')
    .insert({
      run_id: input.runId,
      check_key: input.result.key,
      category: input.result.category,
      status: input.result.status,
      severity: input.result.severity ?? null,
      evidence_json: input.result.evidence,
      repair_attempted: input.repairAttempted,
      repair_outcome: input.repairOutcome ?? null,
      repair_evidence: input.repairEvidence ?? null,
      duration_ms: input.result.durationMs ?? null,
    })
    .select('id')
    .single()
  if (error || !data) {
    throw new Error(`night_watchman: recordCheckResult failed — ${error?.message ?? 'no row'}`)
  }
  return data.id as string
}

interface OpenIncidentInput {
  checkKey: string
  category: CheckResult['category']
  severity: Severity
  rootCause?: string
  firstCheckId: string
}

/**
 * Idempotent: if there's already an open incident for this check_key, return
 * its id and bump repairs_attempted. Otherwise insert a new row.
 */
export async function openOrUpdateIncident(
  db: Db,
  input: OpenIncidentInput
): Promise<{ incidentId: string; created: boolean }> {
  const { data: existing } = await db
    .from('night_watchman_incidents')
    .select('id, repairs_attempted')
    .eq('check_key', input.checkKey)
    .is('closed_at', null)
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; repairs_attempted: number }>()

  if (existing) {
    const { error } = await db
      .from('night_watchman_incidents')
      .update({
        last_check_id: input.firstCheckId,
        repairs_attempted: existing.repairs_attempted + 1,
        // Don't override severity / root_cause once set — first failure wins.
      })
      .eq('id', existing.id)
    if (error) {
      throw new Error(`night_watchman: openOrUpdateIncident update failed — ${error.message}`)
    }
    return { incidentId: existing.id, created: false }
  }

  const { data: created, error } = await db
    .from('night_watchman_incidents')
    .insert({
      check_key: input.checkKey,
      category: input.category,
      severity: input.severity,
      root_cause: input.rootCause ?? null,
      repairs_attempted: 0,
      first_check_id: input.firstCheckId,
      last_check_id: input.firstCheckId,
    })
    .select('id')
    .single()
  if (error || !created) {
    throw new Error(`night_watchman: openIncident insert failed — ${error?.message ?? 'no row'}`)
  }
  return { incidentId: created.id as string, created: true }
}

interface CloseIncidentInput {
  incidentId: string
  resolution: Resolution
  resolutionEvidence?: Record<string, unknown>
  telegramMessageId?: number
}

export async function closeIncident(db: Db, input: CloseIncidentInput): Promise<void> {
  // Read current telegram_message_ids so we can append (Postgres array_append
  // via update is awkward through PostgREST; merge in JS).
  const { data: existing } = await db
    .from('night_watchman_incidents')
    .select('telegram_message_ids')
    .eq('id', input.incidentId)
    .maybeSingle<{ telegram_message_ids: number[] }>()

  const merged = existing?.telegram_message_ids ?? []
  if (input.telegramMessageId != null) merged.push(input.telegramMessageId)

  const { error } = await db
    .from('night_watchman_incidents')
    .update({
      closed_at: new Date().toISOString(),
      resolution: input.resolution,
      resolution_evidence: input.resolutionEvidence ?? null,
      telegram_message_ids: merged,
    })
    .eq('id', input.incidentId)
  if (error) {
    throw new Error(`night_watchman: closeIncident failed — ${error.message}`)
  }
}

/**
 * Append a Telegram message_id to an incident's audit trail.
 * Used when an alert is sent but the incident remains open.
 */
export async function appendTelegramMessageId(
  db: Db,
  incidentId: string,
  messageId: number
): Promise<void> {
  const { data: existing } = await db
    .from('night_watchman_incidents')
    .select('telegram_message_ids')
    .eq('id', incidentId)
    .maybeSingle<{ telegram_message_ids: number[] }>()

  const merged = existing?.telegram_message_ids ?? []
  merged.push(messageId)

  const { error } = await db
    .from('night_watchman_incidents')
    .update({ telegram_message_ids: merged })
    .eq('id', incidentId)
  if (error) {
    throw new Error(`night_watchman: appendTelegramMessageId failed — ${error.message}`)
  }
}

/** Emit an agent_events row so the rollup can pick up auto-bump signal (Q5). */
export async function emitRepairSuccessEvent(
  db: Db,
  args: { checkKey: string; runId: string; tier: string }
): Promise<void> {
  await db.from('agent_events').insert({
    domain: 'night_watchman',
    action: 'repair_success',
    actor: 'night_watchman',
    status: 'success',
    meta: {
      check_key: args.checkKey,
      run_id: args.runId,
      tier: args.tier,
    },
  })
}
