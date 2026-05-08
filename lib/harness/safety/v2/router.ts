/**
 * lib/harness/safety/v2/router.ts
 *
 * Decision router. Pure function: given a score result + E2E pass status +
 * optional twin response, return the SafetyAction the gate should take.
 *
 * Routing matrix (matches docs/leverage-targets.md spec):
 *
 *     score    e2e_pass    twin       → action
 *     low      true        —          auto_merge
 *     low      false       —          colin_escalate
 *     low      null        —          auto_merge      (E2E not run = no surface URL)
 *     medium   true        proceed    twin_proceed
 *     medium   true        hold       twin_hold
 *     medium   true        escalate   twin_escalate
 *     medium   true        null       twin_unavailable    (twin unreachable; fail-safe)
 *     medium   false       —          colin_escalate
 *     medium   null        proceed    twin_proceed        (no E2E surface; twin still asked)
 *     medium   null        hold       twin_hold
 *     medium   null        escalate   twin_escalate
 *     medium   null        null       twin_unavailable
 *     high     —           —          colin_escalate      (skip twin; secret/high-risk)
 *
 * HOLD retry-after-24h is the caller's responsibility: when this returns
 * `twin_hold`, the gate writes a task_queue row with run-after = now + 24h.
 *
 * Spec: docs/leverage-targets.md#safety-agent-0--done (Risk routing)
 */

import type { RiskTier, SafetyAction } from './types'

// F18: lib/harness/safety/v2/router

/** Twin arbiter response — only the action verb matters for routing. */
export type TwinDecision = 'proceed' | 'hold' | 'escalate'

export interface RouteInput {
  tier: RiskTier
  /**
   * Puppeteer E2E result.
   *   true  — passed
   *   false — failed (any failure forces colin_escalate; spec: "automatic
   *            ESCALATE regardless of other signal scores")
   *   null  — not run (no surface URL in done_state, or E2E disabled)
   */
  e2e_pass: boolean | null
  /**
   * Twin arbiter outcome. Required when tier === 'medium'; ignored otherwise.
   * `null` means twin was unreachable (fail-safe → twin_unavailable action).
   */
  twin?: TwinDecision | null
}

export interface RouteResult {
  action: SafetyAction
  /** Short reason string for the audit log (decision_log.notes / safety_decisions.notes). */
  reason: string
}

export function routeSafetyDecision(input: RouteInput): RouteResult {
  // E2E hard fail bypasses everything (per spec — automatic ESCALATE).
  if (input.e2e_pass === false) {
    return {
      action: 'colin_escalate',
      reason: `e2e_fail forces escalate (tier=${input.tier})`,
    }
  }

  // High tier: never go through twin — straight to Colin.
  if (input.tier === 'high') {
    return {
      action: 'colin_escalate',
      reason: 'high-risk tier → direct Colin escalate (skip twin)',
    }
  }

  // Low tier: auto-merge (E2E pass or null both pass through here).
  if (input.tier === 'low') {
    return {
      action: 'auto_merge',
      reason: input.e2e_pass === true ? 'low + e2e pass' : 'low + no e2e surface',
    }
  }

  // Medium tier: consult twin.
  switch (input.twin) {
    case 'proceed':
      return { action: 'twin_proceed', reason: 'medium + twin returned PROCEED' }
    case 'hold':
      return {
        action: 'twin_hold',
        reason: 'medium + twin returned HOLD (retry after 24h)',
      }
    case 'escalate':
      return {
        action: 'twin_escalate',
        reason: 'medium + twin returned ESCALATE',
      }
    case null:
    case undefined:
    default:
      return {
        action: 'twin_unavailable',
        reason: 'medium tier but twin returned null (unreachable) — fail-safe escalate',
      }
  }
}
