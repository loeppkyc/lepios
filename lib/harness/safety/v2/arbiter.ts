/**
 * lib/harness/safety/v2/arbiter.ts
 *
 * Twin-arbiter request shape + response parser. The route handler at
 * app/api/twin/safety-arbitrate/route.ts builds the question from a
 * SafetyArbiterInput, calls askTwin, and parses the answer back into a
 * TwinDecision via parseTwinDecision.
 *
 * Keeping the prompt + parser pure and exported makes both testable
 * independent of the route handler + Anthropic SDK.
 *
 * Spec: docs/leverage-targets.md#safety-agent-0--done (sub-module #5)
 */

import type { SignalFinding } from './types'
import type { TwinDecision } from './router'

// F18: lib/harness/safety/v2/arbiter

export interface SafetyArbiterInput {
  /** PR identity for log correlation. */
  commit_sha: string
  pr_number?: number | null
  /** Risk score from the scorer (0–100). Always provided so the twin sees the math. */
  risk_score: number
  /** Findings that contributed — twin uses the evidence strings to reason. */
  findings: SignalFinding[]
  /** First few touched files (max 10) for context — twin sees what changed. */
  files_changed: string[]
}

/**
 * Render the arbiter question. Caller passes this string to askTwin().
 *
 * The question is structured so the twin's answer follows a parseable
 * pattern: it must end with one of "PROCEED", "HOLD", or "ESCALATE".
 * If the twin can't decide, escalate_reason picks up the slack via
 * the existing TwinResponse.escalate=true path.
 */
export function buildArbiterQuestion(input: SafetyArbiterInput): string {
  const findingsBlock =
    input.findings.length === 0
      ? '(no findings)'
      : input.findings
          .slice(0, 12)
          .map((f) => `- ${f.name} [${f.weight_key}]: ${f.evidence}`)
          .join('\n')

  const filesBlock =
    input.files_changed.length === 0 ? '(no files)' : input.files_changed.slice(0, 10).join('\n')

  return [
    `A pull request has scored ${input.risk_score}/100 on the Safety Agent risk scorer.`,
    `Commit: ${input.commit_sha.slice(0, 8)}${input.pr_number != null ? ` (PR #${input.pr_number})` : ''}.`,
    '',
    'Findings:',
    findingsBlock,
    '',
    'Files changed:',
    filesBlock,
    '',
    'Based on past similar PRs and the principles in your knowledge corpus,',
    'should this PR PROCEED (auto-merge), HOLD (defer 24h for retry), or',
    'ESCALATE (require Colin review)?',
    '',
    'Answer with exactly one word: PROCEED, HOLD, or ESCALATE.',
  ].join('\n')
}

/**
 * Parse the twin's answer into a TwinDecision. Extracts the last occurrence
 * of one of the three keywords (case-insensitive). Returns null if no keyword
 * is present — caller treats null as twin_unavailable / fail-safe.
 *
 * Why "last occurrence": twin answers may include reasoning before the verdict.
 * Empirically, the verdict word reliably appears at the end of the answer.
 */
export function parseTwinDecision(answer: string): TwinDecision | null {
  const upper = answer.toUpperCase()
  const positions = [
    { word: 'PROCEED' as const, idx: upper.lastIndexOf('PROCEED') },
    { word: 'HOLD' as const, idx: upper.lastIndexOf('HOLD') },
    { word: 'ESCALATE' as const, idx: upper.lastIndexOf('ESCALATE') },
  ].filter((p) => p.idx >= 0)

  if (positions.length === 0) return null
  positions.sort((a, b) => b.idx - a.idx)
  return positions[0].word.toLowerCase() as TwinDecision
}
