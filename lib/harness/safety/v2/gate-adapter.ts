/**
 * lib/harness/safety/v2/gate-adapter.ts
 *
 * Deploy-gate adapter for Safety Agent v2.
 *
 * Provides two things:
 *   1. fetchPRDiffInput() — builds a PRDiffInput from the GitHub Compare API.
 *   2. runSafetyGateCheck() — called from deploy-gate-runner between smoke
 *      pass and schema check; returns whether the gate should block.
 *
 * Blocking actions: colin_escalate | twin_hold | twin_escalate.
 * Non-blocking:     auto_merge | twin_proceed | twin_unavailable.
 *
 * Non-blocking twin_unavailable preserves the original deploy-gate behavior
 * when the twin isn't configured — we record the score but don't hold the PR.
 */

import type { PRDiffInput, SafetyAction } from './types'
import { runSafetyDecision, persistSafetyDecision } from './driver'
import type { SafetyDecisionResult } from './driver'

const GITHUB_API = 'https://api.github.com'
const GITHUB_REPO = 'loeppkyc/lepios'

// ── GitHub diff fetch ─────────────────────────────────────────────────────────

type CompareFile = {
  filename: string
  additions: number
  deletions: number
  status: string
  patch?: string
}

type CompareResponse = {
  files?: CompareFile[]
  commits?: Array<{ commit: { message: string } }>
}

/**
 * Build a PRDiffInput from the GitHub Compare API (main...commit_sha).
 * Fetches file list + stats + migration SQL in one round-trip (plus one
 * per migration file, capped at 5). Returns null on any API failure so
 * callers can treat infra errors as non-blocking.
 */
export async function fetchPRDiffInput(
  commit_sha: string,
  _branch: string
): Promise<{ input: PRDiffInput | null; error?: string }> {
  const token = process.env.GITHUB_TOKEN
  if (!token) return { input: null, error: 'config' }

  let compareJson: CompareResponse
  try {
    const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/compare/main...${commit_sha}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!res.ok) return { input: null, error: `api_${res.status}` }
    compareJson = (await res.json()) as CompareResponse
  } catch {
    return { input: null, error: 'api_error' }
  }

  const files = compareJson.files ?? []
  const files_changed = files.map((f) => f.filename)
  const loc_added = files.reduce((s, f) => s + f.additions, 0)
  const loc_removed = files.reduce((s, f) => s + f.deletions, 0)
  const new_files = files.filter((f) => f.status === 'added').map((f) => f.filename)

  const unified_diff = files
    .filter((f) => f.patch)
    .map((f) => `+++ b/${f.filename}\n${f.patch}`)
    .join('\n')

  const commits = compareJson.commits ?? []
  const commit_message = commits[commits.length - 1]?.commit?.message ?? ''

  // Fetch SQL for migration files — cap at 5 to bound latency
  const migrationPaths = files_changed.filter(
    (f) => f.startsWith('supabase/migrations/') && f.endsWith('.sql')
  )
  const migration_files: Array<{ path: string; sql: string }> = []

  for (const filePath of migrationPaths.slice(0, 5)) {
    try {
      const res = await fetch(
        `${GITHUB_API}/repos/${GITHUB_REPO}/contents/${filePath}?ref=${commit_sha}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }
      )
      if (!res.ok) continue
      const json = (await res.json()) as { content?: string; encoding?: string }
      if (json.encoding === 'base64' && json.content) {
        const sql = Buffer.from(json.content.replace(/\n/g, ''), 'base64').toString('utf-8')
        if (sql.length <= 50_000) {
          migration_files.push({ path: filePath, sql })
        }
      }
    } catch {
      // skip this file — schema signal just won't fire for it
    }
  }

  return {
    input: {
      unified_diff,
      files_changed,
      loc_added,
      loc_removed,
      migration_files,
      new_files,
      commit_message,
    },
  }
}

// ── Telegram escalation ───────────────────────────────────────────────────────

async function sendSafetyEscalation(params: {
  commit_sha: string
  branch: string
  task_id: string
  decision: SafetyDecisionResult
  sdId: string | null
}): Promise<void> {
  const { commit_sha, branch, task_id, decision, sdId } = params
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return

  const topFindings = decision.findings
    .slice(0, 3)
    .map((f) => `  • ${f.name} (${f.evidence.slice(0, 60)})`)
    .join('\n')

  const text = [
    `🛑 Safety Agent blocked deploy`,
    `task: ${task_id}`,
    `branch: ${branch}`,
    `sha: ${commit_sha.slice(0, 12)}`,
    `action: ${decision.action}`,
    `score: ${decision.score.score} (${decision.tier})`,
    topFindings ? `top signals:\n${topFindings}` : '',
    sdId ? `audit: safety_decisions/${sdId.slice(0, 8)}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
  } catch {
    // best-effort — don't let Telegram failure block the gate decision
  }
}

// ── Gate check ────────────────────────────────────────────────────────────────

const BLOCKING_ACTIONS = new Set<SafetyAction>(['colin_escalate', 'twin_hold', 'twin_escalate'])

export type SafetyGateResult = {
  /** True when Safety Agent says to block the deploy. */
  blocking: boolean
  action: SafetyAction
  tier: string
  score: number
  sdId: string | null
  /** Non-null when the diff fetch itself failed — gate proceeds non-blocking. */
  infra_error?: string
}

/**
 * Run the Safety Agent check as part of the deploy gate.
 * Called after smoke passes, before schema check.
 *
 * On any infra failure (diff fetch error, runSafetyDecision exception) the
 * gate is NON-blocking — infra outages must not stop deploys entirely.
 */
export async function runSafetyGateCheck(params: {
  commit_sha: string
  branch: string
  task_id: string
  results: string[]
}): Promise<SafetyGateResult> {
  const { commit_sha, branch, task_id, results } = params

  const diffResult = await fetchPRDiffInput(commit_sha, branch)
  if (!diffResult.input) {
    results.push(`${commit_sha}:safety-diff-fetch-failed`)
    return {
      blocking: false,
      action: 'auto_merge',
      tier: 'low',
      score: 0,
      sdId: null,
      infra_error: diffResult.error,
    }
  }

  const baseUrl = process.env.LEPIOS_BASE_URL ?? 'https://lepios-one.vercel.app'
  const cronSecret = process.env.CRON_SECRET

  let decision: SafetyDecisionResult
  try {
    decision = await runSafetyDecision({
      commit_sha,
      branch,
      task_id,
      diff: diffResult.input,
      twin_arbiter_url: cronSecret ? `${baseUrl}/api/twin/safety-arbitrate` : undefined,
      cron_secret: cronSecret,
    })
  } catch {
    results.push(`${commit_sha}:safety-agent-exception`)
    return {
      blocking: false,
      action: 'auto_merge',
      tier: 'low',
      score: 0,
      sdId: null,
      infra_error: 'exception',
    }
  }

  const sdId = await persistSafetyDecision(decision)
  const isBlocking = BLOCKING_ACTIONS.has(decision.action)

  if (isBlocking) {
    await sendSafetyEscalation({ commit_sha, branch, task_id, decision, sdId })
  }

  results.push(`${commit_sha}:safety-${decision.action}-score${decision.score.score}`)
  return {
    blocking: isBlocking,
    action: decision.action,
    tier: decision.tier,
    score: decision.score.score,
    sdId,
  }
}
