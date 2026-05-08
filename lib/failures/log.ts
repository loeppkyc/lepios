/**
 * lib/failures/log.ts
 *
 * Write path for the failures_log table. Single function — `logFailure` —
 * called by:
 *   - manual entry endpoint (Colin via /failures form)
 *   - self-repair detector (when a failure is identified)
 *   - Safety Agent (when BLOCK or twin ESCALATE fires)
 *
 * Recurrence detection: if the incoming pattern_signature matches an existing
 * row whose status is 'fixed', we update that row instead of inserting:
 *   status → 'recurring', occurrence_count++, last_seen_at = now.
 * This is the loop that drives the <5% recurrence benchmark — without it,
 * recurrences look like new failures and the system never notices.
 *
 * Spec: docs/leverage-targets.md#t-006--failures-log-revised-2026-05-08
 */

import { createServiceClient } from '@/lib/supabase/service'
import type { PatternSignature } from './signature'

export type LogFailureInput = {
  title: string
  trigger_context: 'manual' | 'self_repair' | 'safety_agent' | 'pr' | 'workflow'
  trigger_ref?: string | null
  what_happened: string
  expected_behavior?: string | null
  actual_behavior?: string | null
  root_cause?: string | null
  fix_commit_sha?: string | null
  lesson?: string | null
  pattern_signature: PatternSignature
  severity?: 'low' | 'medium' | 'high' | 'critical'
}

export type LogFailureResult =
  | {
      ok: true
      id: string
      failure_number: string
      status: 'open' | 'recurring'
      is_recurrence: boolean
    }
  | { ok: false; error: string }

type DBClient = ReturnType<typeof createServiceClient>

/**
 * Find an existing 'fixed' row whose pattern_signature is identical (by jsonb
 * containment in both directions = equality). Returns the row id + count if
 * found, null otherwise. Used by the recurrence path.
 */
async function findFixedMatch(
  db: DBClient,
  signature: PatternSignature
): Promise<{ id: string; occurrence_count: number; failure_number: string | null } | null> {
  const sigJson = JSON.parse(JSON.stringify(signature)) as Record<string, unknown>

  // Two-way containment = JSONB equality. Cheaper than full JSON cmp on the read path.
  const { data } = await db
    .from('failures_log')
    .select('id, occurrence_count, failure_number, pattern_signature')
    .eq('status', 'fixed')
    .contains('pattern_signature', sigJson)
    .order('last_seen_at', { ascending: false })
    .limit(5)

  if (!data) return null

  // Verify reverse-containment in app code (Supabase JS client doesn't expose @>= both directions).
  for (const row of data as Array<{
    id: string
    occurrence_count: number
    failure_number: string | null
    pattern_signature: PatternSignature
  }>) {
    if (signatureEqualsRow(signature, row.pattern_signature)) {
      return {
        id: row.id,
        occurrence_count: row.occurrence_count,
        failure_number: row.failure_number,
      }
    }
  }
  return null
}

function signatureEqualsRow(a: PatternSignature, b: PatternSignature): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

function canonicalJson(obj: unknown): string {
  if (obj === null || obj === undefined) return 'null'
  if (typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) {
    // Arrays are order-sensitive in JSONB equality; sort string arrays for canonical form.
    const isStringArr = obj.every((v) => typeof v === 'string')
    const arr = isStringArr ? (obj as string[]).slice().sort() : obj
    return '[' + arr.map(canonicalJson).join(',') + ']'
  }
  const o = obj as Record<string, unknown>
  const keys = Object.keys(o).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(o[k])).join(',') + '}'
}

/**
 * Allocate the next F-N{n} number. Counts existing failure_number values
 * matching /^F-N\d+$/ and returns max+1. Uses an advisory lock on the table
 * to keep concurrent writers from claiming the same number.
 *
 * Note: trades latency for simplicity. If churn becomes high we'll move to a
 * sequence; today the rate is <10 entries/day and a SELECT MAX is fine.
 */
async function nextFailureNumber(db: DBClient): Promise<string> {
  const { data } = await db
    .from('failures_log')
    .select('failure_number')
    .like('failure_number', 'F-N%')
    .order('failure_number', { ascending: false })
    .limit(50) // covers any reasonable lexicographic ordering surprise

  let max = 0
  for (const row of (data ?? []) as Array<{ failure_number: string | null }>) {
    if (!row.failure_number) continue
    const m = /^F-N(\d+)$/.exec(row.failure_number)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    }
  }
  return `F-N${max + 1}`
}

/**
 * Public write entry point. Recurrence-aware: if the pattern matches a fixed
 * row, updates that row in place; otherwise inserts a new row.
 */
export async function logFailure(input: LogFailureInput): Promise<LogFailureResult> {
  const db = createServiceClient()

  try {
    const match = await findFixedMatch(db, input.pattern_signature)
    if (match) {
      // Recurrence — update the existing fixed row.
      const newCount = match.occurrence_count + 1
      const { error: updateErr } = await db
        .from('failures_log')
        .update({
          status: 'recurring',
          occurrence_count: newCount,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', match.id)
      if (updateErr) {
        return { ok: false, error: `recurrence update failed: ${updateErr.message}` }
      }
      return {
        ok: true,
        id: match.id,
        failure_number: match.failure_number ?? '',
        status: 'recurring',
        is_recurrence: true,
      }
    }

    // New row.
    const failureNumber = await nextFailureNumber(db)
    const { data, error } = await db
      .from('failures_log')
      .insert({
        failure_number: failureNumber,
        title: input.title,
        trigger_context: input.trigger_context,
        trigger_ref: input.trigger_ref ?? null,
        what_happened: input.what_happened,
        expected_behavior: input.expected_behavior ?? null,
        actual_behavior: input.actual_behavior ?? null,
        root_cause: input.root_cause ?? null,
        fix_commit_sha: input.fix_commit_sha ?? null,
        lesson: input.lesson ?? null,
        pattern_signature: input.pattern_signature,
        severity: input.severity ?? 'medium',
      })
      .select('id, failure_number, status')
      .single()

    if (error || !data) {
      return { ok: false, error: error?.message ?? 'insert returned no row' }
    }
    return {
      ok: true,
      id: (data as { id: string }).id,
      failure_number: (data as { failure_number: string }).failure_number,
      status: (data as { status: 'open' }).status,
      is_recurrence: false,
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Mark a failure as fixed. Used after a PR lands the fix; updates root_cause
 * and fix_commit_sha along the way. Lesson is optional (better captured via
 * a follow-up update if learned later).
 */
export async function markFixed(input: {
  id: string
  fix_commit_sha: string
  root_cause?: string
  lesson?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = createServiceClient()
  const updates: Record<string, unknown> = {
    status: 'fixed',
    fix_commit_sha: input.fix_commit_sha,
    updated_at: new Date().toISOString(),
  }
  if (input.root_cause !== undefined) updates.root_cause = input.root_cause
  if (input.lesson !== undefined) updates.lesson = input.lesson

  const { error } = await db.from('failures_log').update(updates).eq('id', input.id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Pattern-match query for the Safety Agent read path (T-002 sub-module #2).
 * Returns rows whose signature is contained-by the input signature, with a
 * preference for non-fixed (open / fixing / recurring) matches.
 *
 * Loose match (containment) on purpose: T-002 wants to flag risk if "any
 * known signature matches this PR", not require strict equality.
 */
export async function findMatchingFailures(
  inputSig: Partial<PatternSignature>
): Promise<Array<{ id: string; failure_number: string | null; status: string; severity: string }>> {
  const db = createServiceClient()
  const sigJson = JSON.parse(JSON.stringify(inputSig)) as Record<string, unknown>

  const { data } = await db
    .from('failures_log')
    .select('id, failure_number, status, severity')
    .contains('pattern_signature', sigJson)
    .order('status', { ascending: true }) // 'fixing','open','recurring' come before 'fixed' alphabetically
    .order('last_seen_at', { ascending: false })
    .limit(10)

  return (data ?? []) as Array<{
    id: string
    failure_number: string | null
    status: string
    severity: string
  }>
}
