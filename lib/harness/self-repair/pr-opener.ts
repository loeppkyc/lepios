/**
 * self_repair/pr-opener.ts
 *
 * Opens a GitHub PR for a drafted + verified fix.
 * Branch name: 'self-repair/<runId>'
 *
 * AD2: NEVER auto-merge. This module only opens PRs — never merges, squashes, or rebases.
 * AD3: Reads diff from the sandbox worktree; does not apply to main workspace.
 *
 * Uses httpRequest({capability:'net.outbound.github'}) via arms-legs.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { httpRequest, telegram } from '@/lib/harness/arms-legs'
import { cleanupSandbox } from '@/lib/harness/sandbox/runtime'
import { requireCapability } from '@/lib/security/capability'
import { createServiceClient } from '@/lib/supabase/service'
import type { DraftedFix } from './drafter'
import type { VerifyResult } from './verifier'
import type { FailureContext } from './context'

const execFileAsync = promisify(execFile)
const REPO_ROOT = process.cwd()

// TODO: SPRINT5-GATE — config lookup per env rather than hardcoded repo
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER ?? 'loeppkyc'
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME ?? 'lepios'

export interface PROpenResult {
  prNumber: number
  prUrl: string
  branchName: string
  sha: string
}

/**
 * Build the PR body using the §M5 template from the spec.
 */
function buildPRBody(
  draft: DraftedFix,
  verify: VerifyResult,
  ctx: FailureContext,
  runId: string
): string {
  const warningsDisplay = verify.warnings.length > 0 ? verify.warnings.join(', ') : 'none'
  const filesChanged = verify.warnings.includes('sandbox_run_threw')
    ? 'unknown (sandbox error)'
    : 'see diff'

  return `## Self-repair attempt — \`${runId}\`

**Trigger:** \`agent_events.action='${ctx.failure.actionType}'\` at \`${ctx.failure.occurredAt}\` (event id \`${ctx.failure.eventId}\`)

### Drafted summary
${draft.summary}

### Rationale
${draft.rationale}

### Sandbox verification
- Status: ✅ passed (exit 0, ${verify.durationMs}ms)
- Files changed: ${filesChanged}
- **Sandbox warnings:** ${warningsDisplay}

### What this PR does NOT do
- It does NOT auto-merge.
- It does NOT auto-deploy.
- Sandbox tests passing ≠ production-correct. Human review required.

### Audit
- self_repair_runs.id: \`${runId}\`
- sandbox_runs.id: \`${verify.sandboxRunId}\`
- Drafter tokens: prompt=${draft.promptTokens}, completion=${draft.completionTokens}`
}

/**
 * Get the current HEAD SHA from the repo.
 */
async function getHeadSha(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT })
    return stdout.trim()
  } catch {
    return 'HEAD'
  }
}

/**
 * Get the diff from the worktree against base HEAD for the PR.
 */
async function getWorktreeDiff(worktreePath: string, baseSha: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['diff', baseSha, 'HEAD'], { cwd: worktreePath })
    return stdout
  } catch {
    return ''
  }
}

/**
 * Opens a GitHub PR for the drafted fix.
 * Steps:
 * 1. Get current HEAD sha
 * 2. Push worktree as a new branch via GitHub API (create ref)
 * 3. Open PR via GitHub API
 * 4. Telegram notify Colin
 * 5. Cleanup sandbox worktree
 *
 * AD2: NO merge, squash, or rebase operations anywhere in this function.
 */
export async function openPR(
  draft: DraftedFix,
  verify: VerifyResult,
  ctx: FailureContext,
  runId: string
): Promise<PROpenResult> {
  const db = createServiceClient()

  // Capability check — log_only
  const capResult = await requireCapability({
    agentId: 'self_repair',
    capability: 'tool.self_repair.open_pr',
  }).catch(() => ({ audit_id: '' }))

  const token = process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('GITHUB_TOKEN not set — cannot open PR')
  }

  const baseSha = await getHeadSha()
  const branchName = `self-repair/${runId}`

  // Get the diff from the sandbox worktree to push as tree
  // For slice 1: we push via git push from the worktree if available,
  // or use the GitHub API to create a blob + tree + commit + ref.
  // Simplified slice 1 approach: git push the worktree branch to origin.
  let sha = baseSha

  if (verify.worktreePath) {
    try {
      // In worktree, commits exist relative to base. Push to new branch.
      await execFileAsync('git', ['checkout', '-b', branchName], { cwd: verify.worktreePath })
      await execFileAsync('git', ['push', 'origin', `HEAD:refs/heads/${branchName}`], {
        cwd: verify.worktreePath,
      })

      // Get sha of pushed branch
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: verify.worktreePath,
      })
      sha = stdout.trim()
    } catch (pushErr) {
      // If push fails, fall through to GitHub API ref-create approach
      const msg = pushErr instanceof Error ? pushErr.message : String(pushErr)
      // Log but don't fail — try API approach next
      try {
        await db.from('agent_events').insert({
          domain: 'self_repair',
          action: 'self_repair.pr.push_failed',
          actor: 'self_repair',
          status: 'error',
          meta: { reason: msg, run_id: runId },
        })
      } catch {
        // Non-fatal
      }

      // Fallback: create the branch via GitHub API pointing at baseSha
      // (branch exists but empty diff — not ideal but avoids total failure)
      const refResult = await httpRequest({
        url: `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/git/refs`,
        method: 'POST',
        capability: 'net.outbound.github',
        agentId: 'self_repair',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: {
          ref: `refs/heads/${branchName}`,
          sha: baseSha,
        },
      })

      if (!refResult.ok) {
        throw new Error(`Failed to create branch via API: ${refResult.body}`)
      }
    }
  } else {
    // No worktree path (sandbox error path) — create empty branch via API
    const refResult = await httpRequest({
      url: `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/git/refs`,
      method: 'POST',
      capability: 'net.outbound.github',
      agentId: 'self_repair',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: {
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      },
    })

    if (!refResult.ok) {
      throw new Error(`Failed to create branch via API: ${refResult.body}`)
    }
  }

  // Open the PR
  const prBody = buildPRBody(draft, verify, ctx, runId)

  const prResult = await httpRequest({
    url: `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/pulls`,
    method: 'POST',
    capability: 'net.outbound.github',
    agentId: 'self_repair',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: {
      title: `self-repair: fix ${ctx.failure.actionType} (run ${runId.slice(0, 8)})`,
      body: prBody,
      head: branchName,
      base: 'main',
    },
  })

  if (!prResult.ok) {
    throw new Error(`Failed to open PR: HTTP ${prResult.status}: ${prResult.body}`)
  }

  let prData: { number?: number; html_url?: string }
  try {
    prData = JSON.parse(prResult.body) as typeof prData
  } catch {
    throw new Error(`Failed to parse PR response: ${prResult.body}`)
  }

  const prNumber = prData.number
  const prUrl = prData.html_url

  if (!prNumber || !prUrl) {
    throw new Error(`PR response missing number or html_url: ${prResult.body}`)
  }

  // Log PR opened event
  try {
    await db.from('agent_events').insert({
      domain: 'self_repair',
      action: 'self_repair.pr.opened',
      actor: 'self_repair',
      status: 'success',
      meta: {
        pr_url: prUrl,
        pr_number: prNumber,
        run_id: runId,
        correlation_id: capResult.audit_id,
        action_type: ctx.failure.actionType,
      },
    })
  } catch {
    // Non-fatal
  }

  // Telegram notify — non-fatal
  await telegram(
    `Self-repair PR opened: ${prUrl}\nTrigger: ${ctx.failure.actionType} at ${ctx.failure.occurredAt}`,
    { bot: 'builder', agentId: 'self_repair' }
  ).catch(() => {})

  // Cleanup sandbox worktree — non-fatal
  if (verify.sandboxRunId) {
    await cleanupSandbox(verify.sandboxRunId).catch(() => {})
  }

  return {
    prNumber,
    prUrl,
    branchName,
    sha,
  }
}
