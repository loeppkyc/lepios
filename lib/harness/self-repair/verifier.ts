/**
 * self_repair/verifier.ts
 *
 * Applies a drafted unified diff inside a sandbox worktree, then runs
 * npm test to verify the fix doesn't break existing tests.
 *
 * AD3: ALL execution happens inside runInSandbox(). Main workspace untouched.
 * Never auto-merges. Sandbox warnings are mirrored verbatim to VerifyResult.warnings.
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { runInSandbox, cleanupSandbox } from '@/lib/harness/sandbox/runtime'
import type { DraftedFix } from './drafter'
import type { FailureContext } from './context'

const execFileAsync = promisify(execFile)
const REPO_ROOT = join(process.cwd())

// TODO: tune with real data — default per spec §Out of scope (3 min for npm test)
const VERIFY_TIMEOUT_MS = 180_000

export interface VerifyResult {
  passed: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
  sandboxRunId: string
  worktreePath: string
  warnings: string[]
}

/**
 * Apply the unified diff in a sandbox worktree and run npm test.
 *
 * Returns a VerifyResult with passed=false on any failure (diff apply error,
 * test failure, timeout, sandbox error).
 *
 * Never touches the main workspace. AD3.
 */
export async function verifyDraft(draft: DraftedFix, _ctx: FailureContext): Promise<VerifyResult> {
  // Empty diff = nothing to verify, escalate
  if (!draft.unifiedDiff.trim()) {
    return {
      passed: false,
      exitCode: 1,
      stdout: '',
      stderr: 'drafter returned empty unifiedDiff — no fix to verify',
      durationMs: 0,
      sandboxRunId: '',
      worktreePath: '',
      warnings: [],
    }
  }

  // Step 1: Run sandbox — first apply the patch, then run tests
  // We write the diff to a temp file inside the worktree via a shell heredoc,
  // then git apply it, then run npm test.
  // The whole operation runs as a multi-step shell command inside the sandbox.

  // Encode the diff as a base64 string to avoid shell escaping issues
  const diffBase64 = Buffer.from(draft.unifiedDiff, 'utf8').toString('base64')

  // Shell script: decode diff, apply it, run tests
  const shellScript = [
    // Write diff from base64 (avoids shell quoting issues with special characters)
    `echo '${diffBase64}' | base64 -d > /tmp/self_repair_patch.diff`,
    `git apply --check /tmp/self_repair_patch.diff 2>&1`,
    `git apply /tmp/self_repair_patch.diff 2>&1`,
    `npm test 2>&1`,
  ].join(' && ')

  const start = Date.now()

  try {
    const sandboxResult = await runInSandbox(shellScript, {
      agentId: 'self_repair',
      capability: 'sandbox.run',
      scope: { fs: { allowedPaths: ['.'] } },
      timeoutMs: VERIFY_TIMEOUT_MS,
      reason: 'self_repair: verify drafted fix via git apply + npm test',
    })

    const durationMs = Date.now() - start
    const passed = !sandboxResult.timedOut && sandboxResult.exitCode === 0

    return {
      passed,
      exitCode: sandboxResult.exitCode,
      stdout: sandboxResult.stdout,
      stderr: sandboxResult.stderr,
      durationMs,
      sandboxRunId: sandboxResult.runId,
      worktreePath: sandboxResult.worktreePath,
      warnings: sandboxResult.warnings,
    }
  } catch (err) {
    const durationMs = Date.now() - start
    const msg = err instanceof Error ? err.message : String(err)
    return {
      passed: false,
      exitCode: null,
      stdout: '',
      stderr: `sandbox error: ${msg}`,
      durationMs,
      sandboxRunId: '',
      worktreePath: '',
      warnings: ['sandbox_run_threw'],
    }
  }
}
