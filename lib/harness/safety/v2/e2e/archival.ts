/**
 * lib/harness/safety/v2/e2e/archival.ts
 *
 * Archive E2E failures to failures_log. Called by the deploy-gate-runner
 * adapter (Sub-phase D) when an E2EResult comes back with pass=false.
 *
 * One failures_log row per failed assertion (not one per E2E run) — each
 * broken URL is its own pattern to track. The pattern_signature uses:
 *   type: "route-500" if status >= 500, else "manual"
 *   touched_files: PR's file list (caller passes)
 *   keywords: extracted from the assertion's failure reason
 *
 * Severity: critical iff status >= 500 OR navigation_error; else high.
 * The spec calls E2E fail "automatic ESCALATE regardless of risk score" —
 * so we don't downgrade these below 'high'.
 *
 * Spec: docs/leverage-targets.md#safety-agent-0--done (sub-module #9 E2E archival)
 */

import { logFailure } from '@/lib/failures/log'
import { buildSignature } from '@/lib/failures/signature'
import type { E2EResult } from './types'

// F18: lib/harness/safety/v2/e2e/archival

export interface ArchiveE2EInput {
  result: E2EResult
  /** PR identity for trigger_ref + signature.touched_files. */
  pr_number: number | null
  commit_sha: string
  files_changed: string[]
}

export interface ArchiveResult {
  archived_failure_ids: string[]
}

function severityFor(reason: string | undefined, status: number | undefined): 'critical' | 'high' {
  if (reason?.startsWith('navigation_error')) return 'critical'
  if (status !== undefined && status >= 500) return 'critical'
  return 'high'
}

/**
 * Write one failures_log row per failed assertion. Successes are not archived
 * (failures_log is for things that need attention; passing assertions are
 * captured in safety_decisions only).
 *
 * Returns the IDs of the rows written so the caller can attach them to
 * safety_decisions.notes for cross-reference.
 */
export async function archiveE2EFailures(input: ArchiveE2EInput): Promise<ArchiveResult> {
  const failed = input.result.assertions.filter((a) => !a.pass)
  if (failed.length === 0) return { archived_failure_ids: [] }

  const ids: string[] = []
  for (const a of failed) {
    const isHttpFail = a.status !== undefined && a.status >= 500
    const sigType = isHttpFail || a.reason?.startsWith('status_mismatch') ? 'route-500' : 'manual'
    const sig = buildSignature({
      type: sigType,
      files: input.files_changed.slice(0, 5),
      free_text: `${a.url} ${a.reason ?? ''}`,
      http_status: a.status,
    })

    const what = `E2E failure on ${a.url}: ${a.reason ?? 'unknown'}`
    const lesson = a.reason?.startsWith('missing_text')
      ? 'Page rendered but expected content was missing — check upstream data dependency.'
      : a.reason?.startsWith('missing_selector')
        ? 'Page rendered but expected element selector was missing — likely a frontend regression.'
        : a.reason?.startsWith('console_errors')
          ? 'Console errors during page load — runtime exception in client-side code.'
          : a.reason?.startsWith('status_mismatch')
            ? 'Page returned an unexpected HTTP status — server-side regression or routing issue.'
            : 'Page failed to load — investigate the route handler or middleware.'

    const res = await logFailure({
      title: `E2E fail: ${a.url.slice(-60)}`,
      trigger_context: 'safety_agent',
      trigger_ref: input.pr_number != null ? String(input.pr_number) : input.commit_sha.slice(0, 8),
      what_happened: what,
      expected_behavior: `${a.url} loads and renders without console errors.`,
      actual_behavior: a.reason ?? 'unspecified',
      lesson,
      pattern_signature: sig,
      severity: severityFor(a.reason, a.status),
    })

    if (res.ok) ids.push(res.id)
  }

  return { archived_failure_ids: ids }
}
