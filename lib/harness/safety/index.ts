/**
 * Safety Agent — orchestrator (Phase 1 + Phase 2 + Phase 3).
 *
 * Spec: docs/specs/safety-agent.md.
 *
 * Single entry point used by Coordinator hand-off, Builder pre-commit, and
 * the pre-commit git hook. Composes static checks + (optional) LLM review +
 * (optional) approval queueing into one decision.
 *
 *   approved_immediately — caller may proceed without human review
 *   pending_human_review — Telegram card sent; caller must wait for decide
 *   rejected             — review unavailable AND severity is blocking; do not proceed
 */

import {
  staticSafetyCheck,
  type StaticCheckInput,
  type StaticCheckResult,
  type Severity,
} from './static'
import { llmReview, shouldRunLlmReview, type LlmReviewResult } from './llm-review'
import {
  requestApproval,
  sendApprovalCard,
  type RequestApprovalInput,
} from './approval'

export interface RunSafetyCheckInput {
  context: string
  proposedAction: StaticCheckInput
  filePaths?: string[]
  requestedBy: string
  /** When true, skip LLM review and approval queueing — use for fast paths
   *  (pre-commit hooks) where the static check alone is sufficient. */
  staticOnly?: boolean
}

export type SafetyDecision = 'approved_immediately' | 'pending_human_review' | 'rejected'

export interface RunSafetyCheckResult {
  decision: SafetyDecision
  worstSeverity: Severity
  staticResult: StaticCheckResult
  llmResult?: LlmReviewResult
  approvalId?: string
  rationale: string
}

const SEVERITY_RANK: Record<Severity, number> = { pass: 0, warn: 1, block: 2 }

function maxSeverity(...ss: Array<Severity | undefined>): Severity {
  let worst: Severity = 'pass'
  for (const s of ss) {
    if (!s) continue
    if (SEVERITY_RANK[s] > SEVERITY_RANK[worst]) worst = s
  }
  return worst
}

export async function runSafetyCheck(
  input: RunSafetyCheckInput,
): Promise<RunSafetyCheckResult> {
  const staticResult = staticSafetyCheck(input.proposedAction)

  // Fast path: static check sufficient. Pre-commit hook lives here.
  if (input.staticOnly) {
    if (staticResult.severity === 'block') {
      return {
        decision: 'rejected',
        worstSeverity: 'block',
        staticResult,
        rationale: `static check blocked: ${staticResult.findings.map((f) => f.rule).join('; ').slice(0, 200)}`,
      }
    }
    return {
      decision: 'approved_immediately',
      worstSeverity: staticResult.severity,
      staticResult,
      rationale: staticResult.findings.length === 0 ? 'no findings' : `${staticResult.severity}: proceeding`,
    }
  }

  // LLM review heuristic: run when static is warn/block OR file paths trip the
  // review-recommended list. Skip when static is pass AND no review path matches.
  const pathsTriggerReview = (input.filePaths && shouldRunLlmReview(input.filePaths)) ?? false
  const shouldReview = staticResult.severity !== 'pass' || pathsTriggerReview

  let llmResultMaybe: LlmReviewResult | undefined
  if (shouldReview) {
    llmResultMaybe = await llmReview({
      diff: input.proposedAction.diff,
      sql: input.proposedAction.sql,
      filePaths: input.filePaths,
      contextNote: input.context,
    })
  }

  const worst = maxSeverity(staticResult.severity, llmResultMaybe?.severity)

  // Pass: no human review needed.
  if (worst === 'pass') {
    return {
      decision: 'approved_immediately',
      worstSeverity: 'pass',
      staticResult,
      llmResult: llmResultMaybe,
      rationale: 'no findings',
    }
  }

  // Warn or block: queue human approval.
  const requestInput: RequestApprovalInput = {
    context: input.context,
    proposedAction: input.proposedAction,
    staticResult,
    llmResult: llmResultMaybe,
    requestedBy: input.requestedBy,
  }

  let approvalId: string | undefined
  let rationale = ''
  try {
    const requested = await requestApproval(requestInput)
    approvalId = requested.id

    const summary =
      llmResultMaybe?.rationale ??
      staticResult.findings.map((f) => `${f.rule}: ${f.evidence}`).join(' | ').slice(0, 240)
    rationale = `${worst}: ${summary}`

    await sendApprovalCard({
      approvalId,
      summary: `${input.context} — ${summary}`.slice(0, 280),
      worstSeverity: worst,
      rationale: llmResultMaybe?.rationale,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      decision: 'rejected',
      worstSeverity: worst,
      staticResult,
      llmResult: llmResultMaybe,
      rationale: `approval queue failed (${msg.slice(0, 120)})`,
    }
  }

  return {
    decision: 'pending_human_review',
    worstSeverity: worst,
    staticResult,
    llmResult: llmResultMaybe,
    approvalId,
    rationale,
  }
}
