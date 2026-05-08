/**
 * lib/harness/safety/v2/driver.ts
 *
 * Safety Agent v2 orchestrator. The deploy-gate adapter (Sub-phase E
 * wires this) calls runSafetyDecision once per PR and gets back a
 * SafetyDecision the gate can persist + act on.
 *
 * Pipeline:
 *   1. Resolve weights + thresholds from harness_config (cached).
 *   2. Run all 5 PR-diff signals (secret/schema/scope/coverage/failures).
 *   3. Run E2E if assertions provided.
 *   4. Score signals → 0–100 + tier.
 *   5. If tier === 'medium' AND e2e didn't fail, call twin arbiter.
 *   6. Route → SafetyAction.
 *
 * Each external dependency (DB, twin URL, browser factory, coverage delta)
 * is injected so the driver is testable end-to-end without mocking 5 things.
 *
 * Spec: docs/leverage-targets.md#safety-agent-0--done
 */

import type { PRDiffInput, SignalFinding, SafetyAction, RiskTier, WeightKey } from './types'
import { detectSecrets } from './signals/secret'
import { detectSchemaImpact } from './signals/schema'
import { detectScope } from './signals/scope'
import { detectCoverageDelta, type CoverageSummary } from './signals/coverage-delta'
import { detectFailuresPattern } from './signals/failures-pattern'
import { scoreSafety, type ScoreResult } from './scorer'
import { routeSafetyDecision, type TwinDecision } from './router'
import { runE2E } from './e2e/runner'
import { archiveE2EFailures } from './e2e/archival'
import type { BrowserFactory, E2EAssertion, E2EResult } from './e2e/types'
import { createServiceClient } from '@/lib/supabase/service'

// F18: lib/harness/safety/v2/driver

export interface SafetyDecisionInput {
  /** PR identity. */
  commit_sha: string
  branch: string
  pr_number?: number | null
  task_id?: string | null

  /** Diff payload — built by the gate adapter from the GitHub API. */
  diff: PRDiffInput

  /**
   * Optional E2E assertions from the module's done_state. Empty array
   * means E2E is skipped entirely (e2e_pass = null in the result).
   */
  e2e_assertions?: E2EAssertion[]

  /**
   * Optional coverage data. base + head must both be present for the
   * coverage signal to fire (coverage-delta module guards null cases).
   */
  coverage?: { base: CoverageSummary | null; head: CoverageSummary | null }

  /**
   * Browser factory for E2E. If e2e_assertions is non-empty but this
   * is undefined, E2E is skipped with abort_reason=no_browser_factory.
   */
  browser_factory?: BrowserFactory

  /**
   * Test-user cookie for the E2E runner. null = unauthenticated.
   */
  e2e_cookie?: string | null

  /**
   * Twin arbiter URL. When tier === 'medium' the driver POSTs the
   * arbiter input to this URL with Bearer CRON_SECRET. If undefined,
   * twin is treated as unavailable (medium tier → twin_unavailable).
   */
  twin_arbiter_url?: string
  cron_secret?: string
}

export interface SafetyDecisionResult {
  commit_sha: string
  branch: string
  pr_number: number | null
  task_id: string | null

  findings: SignalFinding[]
  score: ScoreResult

  e2e: E2EResult | null
  twin_decision: TwinDecision | null
  twin_raw: unknown

  action: SafetyAction
  tier: RiskTier
  reason: string
  archived_failure_ids: string[]
}

type DBClient = ReturnType<typeof createServiceClient>

/**
 * Read SAFETY_WEIGHT_* + SAFETY_THRESHOLD_* from harness_config. Returns
 * defaults when the table can't be read; the scorer's fallback handles
 * any individual missing key.
 */
async function loadSafetyConfig(db: DBClient): Promise<{
  weights: Partial<Record<WeightKey, number>>
  thresholds: { lowMax: number; mediumMax: number }
}> {
  const { data } = await db.from('harness_config').select('key, value').like('key', 'SAFETY_%')

  const weights: Partial<Record<WeightKey, number>> = {}
  let lowMax = 29
  let mediumMax = 70

  for (const row of (data ?? []) as Array<{ key: string; value: string }>) {
    const n = Number(row.value)
    if (!Number.isFinite(n)) continue
    if (row.key === 'SAFETY_THRESHOLD_LOW_MAX') lowMax = n
    else if (row.key === 'SAFETY_THRESHOLD_MEDIUM_MAX') mediumMax = n
    else if (row.key.startsWith('SAFETY_WEIGHT_')) {
      weights[row.key as WeightKey] = n
    }
  }

  return { weights, thresholds: { lowMax, mediumMax } }
}

/**
 * Call the twin arbiter route. Returns null if URL not configured, or if
 * the call fails — caller (the router) maps null to twin_unavailable.
 */
async function callTwinArbiter(
  url: string,
  cronSecret: string,
  payload: {
    commit_sha: string
    pr_number: number | null
    risk_score: number
    findings: SignalFinding[]
    files_changed: string[]
  }
): Promise<{ decision: TwinDecision | null; raw: unknown } | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cronSecret}`,
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { decision: TwinDecision | null }
    return { decision: body.decision ?? null, raw: body }
  } catch {
    return null
  }
}

/**
 * End-to-end Safety Agent decision. Composes all five sub-modules
 * + E2E + twin arbiter into one structured result. Pure relative to
 * its inputs — caller persists to safety_decisions.
 */
export async function runSafetyDecision(
  input: SafetyDecisionInput,
  dbClient?: DBClient
): Promise<SafetyDecisionResult> {
  const db = dbClient ?? createServiceClient()
  const { weights, thresholds } = await loadSafetyConfig(db)

  // ── Signals ──────────────────────────────────────────────────────────
  const findings: SignalFinding[] = []
  findings.push(...detectSecrets(input.diff))
  findings.push(...detectSchemaImpact(input.diff))
  findings.push(...detectScope(input.diff))
  if (input.coverage) {
    findings.push(...detectCoverageDelta(input.coverage))
  }
  const failurePatternFindings = await detectFailuresPattern(input.diff, db)
  findings.push(...failurePatternFindings)

  // ── E2E ─────────────────────────────────────────────────────────────
  let e2eResult: E2EResult | null = null
  let e2ePass: boolean | null = null
  let archivedIds: string[] = []

  if (input.e2e_assertions && input.e2e_assertions.length > 0) {
    if (input.browser_factory) {
      e2eResult = await runE2E({
        assertions: input.e2e_assertions,
        cookie: input.e2e_cookie ?? null,
        browserFactory: input.browser_factory,
      })
      // Treat infrastructure-level abort as e2e_pass=null, not false.
      // Per-assertion failures map to false.
      e2ePass = e2eResult.abort_reason ? null : e2eResult.pass
    } else {
      e2eResult = {
        pass: false,
        assertions: [],
        duration_ms: 0,
        abort_reason: 'no_browser_factory',
      }
      e2ePass = null
    }
  }

  // ── Score ───────────────────────────────────────────────────────────
  const score = scoreSafety({ findings, weights, thresholds })

  // ── Twin (medium tier + e2e didn't fail) ────────────────────────────
  let twinDecision: TwinDecision | null = null
  let twinRaw: unknown = null
  if (score.tier === 'medium' && e2ePass !== false && input.twin_arbiter_url && input.cron_secret) {
    const t = await callTwinArbiter(input.twin_arbiter_url, input.cron_secret, {
      commit_sha: input.commit_sha,
      pr_number: input.pr_number ?? null,
      risk_score: score.score,
      findings,
      files_changed: input.diff.files_changed,
    })
    if (t) {
      twinDecision = t.decision
      twinRaw = t.raw
    }
  }

  // ── Route ───────────────────────────────────────────────────────────
  const route = routeSafetyDecision({
    tier: score.tier,
    e2e_pass: e2ePass,
    twin: twinDecision,
  })

  // ── Archive E2E failures ────────────────────────────────────────────
  if (e2eResult && e2eResult.pass === false && !e2eResult.abort_reason) {
    const archive = await archiveE2EFailures({
      result: e2eResult,
      pr_number: input.pr_number ?? null,
      commit_sha: input.commit_sha,
      files_changed: input.diff.files_changed,
    })
    archivedIds = archive.archived_failure_ids
  }

  return {
    commit_sha: input.commit_sha,
    branch: input.branch,
    pr_number: input.pr_number ?? null,
    task_id: input.task_id ?? null,
    findings,
    score,
    e2e: e2eResult,
    twin_decision: twinDecision,
    twin_raw: twinRaw,
    action: route.action,
    tier: score.tier,
    reason: route.reason,
    archived_failure_ids: archivedIds,
  }
}

/**
 * Persist a SafetyDecisionResult to the safety_decisions table. Returns
 * the inserted row's id, or null on write failure.
 */
export async function persistSafetyDecision(
  result: SafetyDecisionResult,
  dbClient?: DBClient
): Promise<string | null> {
  const db = dbClient ?? createServiceClient()
  const { data, error } = await db
    .from('safety_decisions')
    .insert({
      commit_sha: result.commit_sha,
      branch: result.branch,
      pr_number: result.pr_number,
      task_id: result.task_id,
      risk_score: result.score.score,
      tier: result.tier,
      signals: result.findings.map((f) => ({
        id: f.id,
        name: f.name,
        weight_key: f.weight_key,
        evidence: f.evidence,
      })),
      e2e_pass: result.e2e === null ? null : result.e2e.abort_reason ? null : result.e2e.pass,
      e2e_failures:
        result.e2e?.assertions
          .filter((a) => !a.pass)
          .map((a) => ({ url: a.url, reason: a.reason, status: a.status })) ?? [],
      action: result.action,
      twin_response: result.twin_raw,
      notes: `${result.reason}${result.archived_failure_ids.length > 0 ? ` (archived ${result.archived_failure_ids.length} E2E failures)` : ''}`,
    })
    .select('id')
    .single()

  if (error || !data) return null
  return (data as { id: string }).id
}
