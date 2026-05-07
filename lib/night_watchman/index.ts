// Scanner orchestrator. Pulls everything together:
//   1. Open a run row
//   2. For each registered check:
//        - Execute → CheckResult
//        - Record check_result row
//        - If fail: decide repair tier (safe-list / sandbox-gated / escalate)
//        - Apply repair, record outcome, open/close incident
//        - Loop guards may abort early or force-escalate
//   3. Close run with summary

import { createServiceClient } from '@/lib/supabase/service'
import {
  appendTelegramMessageId,
  closeIncident,
  closeRun,
  emitRepairSuccessEvent,
  openOrUpdateIncident,
  openRun,
  recordCheckResult,
} from './persistence'
import {
  checkGuards,
  createGuardState,
  loadRollingCounts,
  readGuardConfig,
  recordRepairAttempt,
  type GuardConfig,
  type GuardState,
} from './loop-guards'
import { getRegisteredChecks } from './registry'
import { findSafeListRepair } from './repairs/safe-list'
import { isSandboxGatedEligible, attemptSandboxRepair } from './repairs/sandbox-gated'
import { escalate } from './repairs/escalate'
import './checks' // side-effect: populate registry
import type {
  CheckResult,
  RepairContext,
  RepairOutcome,
  RepairTier,
  ScanReport,
  Scope,
} from './types'

interface RunOptions {
  scope: Scope
  triggerSource: 'cron' | 'manual' | 'telegram'
  dryRun?: boolean
}

const FORBIDDEN_AUTO_REPAIR_KEYS = new Set<string>([
  'security.rls_coverage',
  'security.gitleaks',
  'security.dependabot_critical',
  'data.schema_drift',
])

export async function runScan(options: RunOptions): Promise<ScanReport> {
  const dryRun = options.dryRun ?? false
  const db = createServiceClient()

  const config = await readGuardConfig(db)
  const state = createGuardState()
  await loadRollingCounts(db, state)

  // If killswitch is on, we still record a run row + run all checks (read-only),
  // but every fail goes straight to escalate and no repair is attempted.
  const halted = config.haltedFlag

  const runId = await openRun(db, {
    scope: options.scope,
    triggerSource: options.triggerSource,
    notes: dryRun ? 'dry_run' : null,
  })

  const startedAt = new Date()
  const ctx: RepairContext = {
    runId,
    scope: options.scope,
    runStartedAt: startedAt,
    dryRun,
    observeOnly: false,
  }

  const checks = getRegisteredChecks()
  const results: CheckResult[] = []
  const repairs: ScanReport['repairs'] = []
  let totalRepairs = 0
  let totalIncidents = 0
  let totalEscalations = 0
  let scanHalted = halted
  let haltReason: string | undefined = halted ? 'SELF_REPAIR_HALTED=true at scan start' : undefined

  for (const check of checks) {
    const t0 = Date.now()
    let result: CheckResult
    try {
      result = await check.run(ctx)
    } catch (err) {
      result = {
        key: check.key,
        category: check.category,
        status: 'fail',
        severity: 'high',
        evidence: { error: err instanceof Error ? err.message : String(err), threw: true },
      }
    }
    result.durationMs = Date.now() - t0
    results.push(result)

    // Record check_result first; we'll patch in repair_outcome below if any.
    if (result.status !== 'fail') {
      await recordCheckResult(db, { runId, result, repairAttempted: false })
      continue
    }

    // FAIL path — decide tier.
    let tier: RepairTier = 'human_required'
    let outcome: RepairOutcome = 'not_applicable'
    let repairEvidence: Record<string, unknown> = {}
    let resolved = false
    let telegramMessageId: number | undefined

    const safeListPlaybook = !FORBIDDEN_AUTO_REPAIR_KEYS.has(result.key)
      ? findSafeListRepair(result)
      : null
    const sevAllowsSafeList =
      result.severity === undefined || result.severity === 'low' || result.severity === 'medium'

    const guardDecision = scanHalted
      ? { allow: false as const, reason: haltReason ?? 'halted', halt: true }
      : checkGuards(config, state, result.key)

    if (safeListPlaybook && sevAllowsSafeList && guardDecision.allow) {
      // ── safe-list ─────────────────────────────────────────────────
      tier = 'safe_list'
      recordRepairAttempt(state, result.key)
      const r = await safeListPlaybook.apply(result, ctx, db)
      outcome = r.outcome
      repairEvidence = r.evidence
      resolved = r.resolved
      if (resolved) {
        totalRepairs += 1
        await emitRepairSuccessEvent(db, { checkKey: result.key, runId, tier })
      } else if (outcome === 'failure' || outcome === 'not_applicable') {
        // Escalate after a failed safe-list attempt.
        const esc = await escalate(result, ctx, `safe-list repair returned ${outcome}`)
        outcome = esc.outcome
        repairEvidence = { safe_list: r.evidence, escalation: esc.evidence }
        telegramMessageId = esc.telegramMessageId
        totalEscalations += 1
      }
    } else if (
      isSandboxGatedEligible(result) &&
      !FORBIDDEN_AUTO_REPAIR_KEYS.has(result.key) &&
      guardDecision.allow
    ) {
      // ── sandbox-gated ─────────────────────────────────────────────
      tier = 'sandbox_gated'
      recordRepairAttempt(state, result.key)
      const r = await attemptSandboxRepair(result, ctx)
      outcome = r.outcome
      repairEvidence = r.evidence
      resolved = r.resolved
      if (outcome === 'sandbox_pr_opened' || outcome === 'success') {
        totalRepairs += 1
        await emitRepairSuccessEvent(db, { checkKey: result.key, runId, tier })
      } else {
        // Sandbox declined / not_applicable → escalate
        const esc = await escalate(result, ctx, `sandbox-gated returned ${outcome}`)
        outcome = esc.outcome
        repairEvidence = { sandbox: r.evidence, escalation: esc.evidence }
        telegramMessageId = esc.telegramMessageId
        totalEscalations += 1
      }
    } else {
      // ── escalate ─────────────────────────────────────────────────
      tier = 'human_required'
      const reason = !guardDecision.allow
        ? guardDecision.reason
        : FORBIDDEN_AUTO_REPAIR_KEYS.has(result.key)
          ? 'forbidden auto-repair surface'
          : !sevAllowsSafeList
            ? `severity=${result.severity ?? '?'} requires sandbox or human`
            : 'no auto-repair playbook applies'
      const esc = await escalate(result, ctx, reason)
      outcome = esc.outcome
      repairEvidence = esc.evidence
      telegramMessageId = esc.telegramMessageId
      totalEscalations += 1
      // Halt if the guard told us to.
      if (!guardDecision.allow && guardDecision.halt) {
        scanHalted = true
        haltReason = guardDecision.reason
      }
    }

    const checkRowId = await recordCheckResult(db, {
      runId,
      result,
      repairAttempted: tier !== 'human_required' || outcome !== 'escalated' ? true : true,
      repairOutcome: outcome,
      repairEvidence,
    })

    // Open or update incident; close immediately if resolved.
    const incidentSeverity = result.severity ?? 'medium'
    const { incidentId, created } = await openOrUpdateIncident(db, {
      checkKey: result.key,
      category: result.category,
      severity: incidentSeverity,
      rootCause:
        typeof result.evidence.error === 'string' ? (result.evidence.error as string) : undefined,
      firstCheckId: checkRowId,
    })
    if (created) totalIncidents += 1

    if (telegramMessageId != null) {
      await appendTelegramMessageId(db, incidentId, telegramMessageId)
    }
    if (resolved) {
      await closeIncident(db, {
        incidentId,
        resolution: tier === 'sandbox_gated' ? 'sandbox_pr' : 'auto_repaired',
        resolutionEvidence: repairEvidence,
        telegramMessageId,
      })
    }

    repairs.push({ checkKey: result.key, tier, outcome, resolved })

    if (scanHalted) break
  }

  const finishedAt = new Date()
  const statusSummary = summarize(results, totalRepairs, totalEscalations, scanHalted)
  await closeRun(db, {
    runId,
    totalChecks: results.length,
    totalRepairs,
    totalIncidents,
    statusSummary,
  })

  return {
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    scope: options.scope,
    totalChecks: results.length,
    totalRepairs,
    totalIncidents,
    totalEscalations,
    halted: scanHalted,
    haltReason,
    results,
    repairs,
  }
}

function summarize(
  results: CheckResult[],
  repairs: number,
  escalations: number,
  halted: boolean
): Record<string, number> {
  const out: Record<string, number> = {
    ok: 0,
    warn: 0,
    fail: 0,
    skipped: 0,
    repaired: repairs,
    escalated: escalations,
    halted: halted ? 1 : 0,
  }
  for (const r of results) out[r.status] = (out[r.status] ?? 0) + 1
  return out
}

/** Decide scope based on the current UTC hour. Sleep window = 04:00–14:00 UTC. */
export function scopeForNow(now: Date = new Date()): Scope {
  const h = now.getUTCHours()
  return h >= 4 && h < 14 ? 'sleep_window' : 'daytime'
}
