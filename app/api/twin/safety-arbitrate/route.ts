/**
 * /api/twin/safety-arbitrate — Safety Agent twin arbitration.
 *
 * Called by the deploy gate when a PR scores into the medium tier (30–70).
 * Wraps askTwin with a structured PR-context prompt and parses the answer
 * into a TwinDecision (proceed / hold / escalate). Returns null when the
 * twin is unreachable or its answer can't be parsed — gate treats that as
 * the twin_unavailable fail-safe.
 *
 * Auth: F22 cron-secret only. This route is gate-only; no admin UI calls it.
 *
 * Spec: docs/leverage-targets.md#safety-agent-0--done (sub-module #5)
 */

import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { askTwin } from '@/lib/twin/query'
import {
  buildArbiterQuestion,
  parseTwinDecision,
  type SafetyArbiterInput,
} from '@/lib/harness/safety/v2/arbiter'
import type { TwinDecision } from '@/lib/harness/safety/v2/router'

// F18: app/api/twin/safety-arbitrate

interface SafetyArbitrateResponse {
  decision: TwinDecision | null
  twin_confidence: number
  twin_escalate: boolean
  twin_answer: string
  question: string
}

export async function POST(request: Request): Promise<NextResponse> {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const body = (await request.json()) as Partial<SafetyArbiterInput>

  // Validate required fields. risk_score must be numeric, commit_sha non-empty,
  // findings + files_changed default to empty arrays.
  const risk_score = typeof body.risk_score === 'number' ? body.risk_score : NaN
  const commit_sha = (body.commit_sha ?? '').trim()
  if (!commit_sha || Number.isNaN(risk_score)) {
    return NextResponse.json({ error: 'commit_sha and risk_score are required' }, { status: 400 })
  }

  const input: SafetyArbiterInput = {
    commit_sha,
    pr_number: body.pr_number ?? null,
    risk_score,
    findings: Array.isArray(body.findings) ? body.findings : [],
    files_changed: Array.isArray(body.files_changed) ? body.files_changed : [],
  }

  const question = buildArbiterQuestion(input)

  // askTwin returns insufficient_context / personal_escalation / answer.
  // For arbiter purposes we treat any escalate=true as a "twin can't decide"
  // signal → return decision=null, let the router map to twin_unavailable.
  const twin = await askTwin(question)

  // If twin escalates, decision is null → router fails safe.
  if (twin.escalate) {
    return NextResponse.json<SafetyArbitrateResponse>({
      decision: null,
      twin_confidence: twin.confidence,
      twin_escalate: true,
      twin_answer: twin.answer,
      question,
    })
  }

  const decision = parseTwinDecision(twin.answer)
  return NextResponse.json<SafetyArbitrateResponse>({
    decision,
    twin_confidence: twin.confidence,
    twin_escalate: false,
    twin_answer: twin.answer,
    question,
  })
}
