/**
 * lib/harness/safety/v2/signals/failures-pattern.ts
 *
 * Known-failure pattern match. Builds a pattern_signature from the PR diff +
 * commit message and queries failures_log for open or recurring rows whose
 * signature overlaps. A match contributes a finding scaled by the matched
 * row's severity:
 *
 *   matched row severity → weight_key
 *     critical / high     → SAFETY_WEIGHT_FAILURE_PATTERN_HIGH (+50)
 *     medium / low        → SAFETY_WEIGHT_FAILURE_PATTERN_LOW  (+25)
 *
 * Top match wins (per Q-003 spec). Multiple matches across different rows
 * collapse to one finding to avoid runaway scores when many small failures
 * share keywords.
 *
 * Reuses lib/failures/signature.ts buildSignature() — adapted here for the
 * PR-diff input shape (signatureFromDiff wrapper).
 *
 * Spec: docs/leverage-targets.md#safety-agent-0--done (signal #5)
 */

import { createServiceClient } from '@/lib/supabase/service'
import { buildSignature, type PatternSignature } from '@/lib/failures/signature'
import type { SignalFinding, PRDiffInput } from '../types'

// F18: lib/harness/safety/v2/signals/failures-pattern

type DBClient = ReturnType<typeof createServiceClient>

interface MatchedRow {
  id: string
  failure_number: string | null
  title: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  status: 'open' | 'fixing' | 'fixed' | 'recurring'
  pattern_signature: PatternSignature
}

/**
 * Build a PR-shaped signature from the diff input. Heuristic type derivation:
 *   - migration_files non-empty → 'migration-error'
 *   - any file matches `app/api/**` → 'route-500' (best guess; PR-time we
 *     don't know if it's actually a route bug)
 *   - else → 'manual' (broadest type — matches anything keyword-only)
 *
 * Files capped at 5 (matches buildSignature's internal cap). Keywords come
 * from the commit message (more distinctive than diff text per failure-pattern
 * convention — diff text introduces a lot of irrelevant tokens).
 */
export function signatureFromDiff(input: PRDiffInput): PatternSignature {
  const type =
    input.migration_files.length > 0
      ? 'migration-error'
      : input.files_changed.some((f) => /^app\/api\//.test(f))
        ? 'route-500'
        : 'manual'

  return buildSignature({
    type,
    files: input.files_changed.slice(0, 5),
    free_text: input.commit_message ?? '',
  })
}

/**
 * Query failures_log for open + recurring rows whose pattern_signature shares
 * any of: file_glob, error_class, or any keyword/touched_file. Uses jsonb @>
 * containment one-way (PR signature ⊇ stored signature) so the stored row's
 * signature is a strict subset of the PR's signal — that's the right direction
 * (a known failure with `keywords:["timeout"]` matches a PR diff containing
 * the keyword, not the other way around).
 *
 * Limit 20 rows — top match (highest severity, then most recent) wins.
 */
export async function findMatchingFailures(
  db: DBClient,
  prSignature: PatternSignature
): Promise<MatchedRow[]> {
  // Build per-key partial signatures and OR them together via .or().
  // We can't use a single @> because the PR signature may not contain all
  // fields of the stored row exactly — we want any-overlap matching.
  const orParts: string[] = []

  if (prSignature.touched_files && prSignature.touched_files.length > 0) {
    for (const file of prSignature.touched_files.slice(0, 5)) {
      // Stored row's touched_files contains this file → match.
      orParts.push(`pattern_signature.cs.${JSON.stringify({ touched_files: [file] })}`)
    }
  }

  if (prSignature.keywords && prSignature.keywords.length > 0) {
    for (const kw of prSignature.keywords.slice(0, 8)) {
      orParts.push(`pattern_signature.cs.${JSON.stringify({ keywords: [kw] })}`)
    }
  }

  if (prSignature.file_glob) {
    orParts.push(`pattern_signature.cs.${JSON.stringify({ file_glob: prSignature.file_glob })}`)
  }

  if (orParts.length === 0) return []

  const { data, error } = await db
    .from('failures_log')
    .select('id, failure_number, title, severity, status, pattern_signature')
    .in('status', ['open', 'recurring'])
    .or(orParts.join(','))
    .order('severity', { ascending: false })
    .order('last_seen_at', { ascending: false })
    .limit(20)

  if (error || !data) return []
  return data as MatchedRow[]
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

/**
 * Detect known-failure patterns in the PR. Top match wins:
 *   1. Highest severity (critical > high > medium > low)
 *   2. Tiebreak by `most recent` (already enforced by the query order)
 *
 * Returns 0 or 1 finding — matched row count is recorded in evidence.
 */
export async function detectFailuresPattern(
  input: PRDiffInput,
  dbClient?: DBClient
): Promise<SignalFinding[]> {
  const db = dbClient ?? createServiceClient()
  const sig = signatureFromDiff(input)
  const matches = await findMatchingFailures(db, sig)
  if (matches.length === 0) return []

  // Top match by severity (already DESC from query, but defensive re-sort).
  const top = matches
    .slice()
    .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0))[0]

  const isHigh = top.severity === 'critical' || top.severity === 'high'
  const matchCount = matches.length
  const ref = top.failure_number ?? top.id.slice(0, 8)

  return [
    {
      id: `failure_pattern_${top.severity}`,
      name: `matches known ${top.severity} failure: ${top.title.slice(0, 60)}`,
      weight_key: isHigh
        ? 'SAFETY_WEIGHT_FAILURE_PATTERN_HIGH'
        : 'SAFETY_WEIGHT_FAILURE_PATTERN_LOW',
      evidence: `top ${ref} (status=${top.status}, ${matchCount} match${matchCount === 1 ? '' : 'es'} total)`,
    },
  ]
}
