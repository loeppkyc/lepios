import { spawn } from 'child_process'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'
import { createServiceClient } from '@/lib/supabase/service'
import { captureFsDiff } from './fs-diff'
import { monotonicNow } from './monotonic'
import type { SandboxScope } from '@/lib/security/sandbox-contract'

const execFileAsync = promisify(execFile)

export interface SandboxRunOptions {
  /** Who is asking — matches harness_components slug */
  agentId: string
  /** What they're doing — passed to checkSandboxAction (slice 2) */
  capability: string
  /** From lib/security/sandbox-contract.ts */
  scope: SandboxScope
  /** Default 60_000; max 300_000 */
  timeoutMs?: number
  /** Optional sub-path within worktree */
  cwd?: string
  /** Merged over clean baseline env */
  env?: Record<string, string>
  /** Free-form; written to sandbox_runs.reason */
  reason?: string
}

export interface SandboxRunResult {
  sandboxId: string
  worktreePath: string
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
  filesChanged: string[]
  diffStat: { insertions: number; deletions: number; files: number }
  diffHash: string
  runId: string
  warnings: string[]
}

const MAX_OUTPUT_BYTES = 256 * 1024 // 256 KB
const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TIMEOUT_MS = 300_000

// Repo root — 3 levels up from lib/harness/sandbox/
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
// Worktrees live in .claude/worktrees/ at project root
const WORKTREES_BASE = path.join(REPO_ROOT, '.claude', 'worktrees')

function truncate(s: string): string {
  if (Buffer.byteLength(s, 'utf8') <= MAX_OUTPUT_BYTES) return s
  return Buffer.from(s, 'utf8').subarray(0, MAX_OUTPUT_BYTES).toString('utf8') + '\n[truncated]'
}

function buildWarnings(scope: SandboxScope): string[] {
  const warnings: string[] = []

  // Always in slice 1 — no Docker/firejail
  warnings.push('process_isolation_not_enforced')

  // Net scope present and non-empty
  if (scope.net && (scope.net.allowedHosts?.length ?? 0) > 0) {
    warnings.push('net_isolation_not_enforced')
  }

  // Denied paths present
  if ((scope.fs.deniedPaths?.length ?? 0) > 0) {
    warnings.push('fs_isolation_advisory')
  }

  return warnings
}

/** Generates a ULID-style unique ID (time-based, URL-safe) */
function generateUlid(): string {
  const ts = Date.now().toString(36).toUpperCase().padStart(10, '0')
  const rand = Math.random().toString(36).substring(2, 12).toUpperCase().padStart(10, '0')
  return `${ts}${rand}`
}

/**
 * Orphan GC query — selects sandbox_runs that started > 24h ago, are in a live
 * status, but were never cleaned. Slice 2 runs the sweep; slice 1 ships the query.
 */
export function buildOrphanGcQuery(db: ReturnType<typeof createServiceClient>) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  return db
    .from('sandbox_runs')
    .select('id, worktree_path, started_at')
    .in('status', ['running', 'completed'])
    .lt('started_at', cutoff)
    .is('cleaned_at', null)
}

export async function runInSandbox(
  cmd: string | string[],
  opts: SandboxRunOptions
): Promise<SandboxRunResult> {
  const timeoutMs = Math.min(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
  const warnings = buildWarnings(opts.scope)

  // Step 1: create ephemeral worktree
  fs.mkdirSync(WORKTREES_BASE, { recursive: true })
  const ulid = generateUlid()
  const worktreeDirName = `sandbox-${ulid}`
  const worktreePath = path.join(WORKTREES_BASE, worktreeDirName)

  // Step 2: sandboxId = '{agentId}:{worktree_dir_name}' — pinned after creation
  const sandboxId = `${opts.agentId}:${worktreeDirName}`

  // Get HEAD sha before worktree creation
  let baseSha = 'HEAD'
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT })
    baseSha = stdout.trim()
  } catch {
    // Non-fatal — use literal 'HEAD' as fallback
  }

  // Create the worktree
  try {
    await execFileAsync('git', ['worktree', 'add', '--detach', worktreePath, baseSha], {
      cwd: REPO_ROOT,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await writeInfraFailureEvent(sandboxId, null, message)
    throw new Error(`sandbox: failed to create worktree at ${worktreePath}: ${message}`)
  }

  // Step 3: insert sandbox_runs row with status='running'
  const db = createServiceClient()
  const cmdStr = Array.isArray(cmd) ? cmd.join(' ') : cmd
  // Generate a run ID upfront; if DB insert succeeds, we use the returned ID
  let runId = crypto.randomUUID()

  const insertPayload = {
    id: runId,
    sandbox_id: sandboxId,
    agent_id: opts.agentId,
    capability: opts.capability,
    scope: opts.scope as unknown as Record<string, unknown>,
    status: 'running',
    worktree_path: worktreePath,
    base_sha: baseSha,
    cmd: cmdStr,
    cwd: opts.cwd ?? null,
    reason: opts.reason ?? null,
    warnings: warnings,
  }

  const { data: insertedRow, error: insertError } = await db
    .from('sandbox_runs')
    .insert(insertPayload)
    .select('id')
    .single()

  if (insertError || !insertedRow) {
    await writeInfraFailureEvent(sandboxId, runId, insertError?.message ?? 'insert failed')
    // Continue — audit_action_id will be null; run proceeds
  } else {
    runId = (insertedRow as { id: string }).id
  }

  // Step 4: Slice 1 — skip checkSandboxAction() (Slice 2 wires security_layer)

  // Step 5: insert agent_actions audit row — non-fatal if 0045 not applied
  let auditActionId: string | null = null
  try {
    const { data: actionRow, error: actionError } = await db
      .from('agent_actions')
      .insert({
        agent_id: opts.agentId,
        capability: opts.capability,
        action_type: 'sandbox_check',
        result: 'allowed',
        reason: opts.reason ?? `sandbox run: ${cmdStr.substring(0, 100)}`,
        enforcement_mode: 'log_only',
        context: { sandbox_id: sandboxId, run_id: runId },
      })
      .select('id')
      .single()

    if (!actionError && actionRow) {
      auditActionId = (actionRow as { id: string }).id
      await db.from('sandbox_runs').update({ audit_action_id: auditActionId }).eq('id', runId)
    }
  } catch {
    // Non-fatal — audit_action_id stays null
  }

  // Suppress unused variable warning — auditActionId is written to DB, not returned
  void auditActionId

  // Step 6: spawn the command
  const effectiveCwd = opts.cwd ? path.join(worktreePath, opts.cwd) : worktreePath

  const shellArgs: string[] = Array.isArray(cmd) ? cmd.slice(1) : ['-c', cmd]
  const shellBin: string = Array.isArray(cmd) ? cmd[0] : 'sh'

  // Clean baseline env — pass as unknown to satisfy spawn overload
  // (spawn accepts Record<string,string> at runtime; NodeJS.ProcessEnv is wider)
  const mergedEnvObj: Record<string, string> = {}
  if (process.env.PATH) mergedEnvObj['PATH'] = process.env.PATH
  if (process.env.HOME) mergedEnvObj['HOME'] = process.env.HOME
  if (process.env.USER) mergedEnvObj['USER'] = process.env.USER
  if (opts.env) Object.assign(mergedEnvObj, opts.env)
  const mergedEnv = mergedEnvObj as NodeJS.ProcessEnv

  const startMs = monotonicNow()

  let exitCode: number | null = null
  let timedOut = false
  let stdoutData = ''
  let stderrData = ''

  await new Promise<void>((resolve) => {
    const child = spawn(shellBin, shellArgs, {
      cwd: effectiveCwd,
      env: mergedEnv,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as import('child_process').ChildProcess

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(child as any).stdout?.on('data', (chunk: Buffer) => {
      stdoutData += chunk.toString('utf8')
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(child as any).stderr?.on('data', (chunk: Buffer) => {
      stderrData += chunk.toString('utf8')
    })

    const killTimer = setTimeout(() => {
      timedOut = true
      if (child.pid != null) {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch {
          // Process may have already exited
        }
        // SIGKILL after 2s grace
        setTimeout(() => {
          if (child.pid != null) {
            try {
              process.kill(-child.pid, 'SIGKILL')
            } catch {
              // Ignore
            }
          }
        }, 2000)
      }
    }, timeoutMs)

    child.on('close', (code: number | null) => {
      clearTimeout(killTimer)
      exitCode = timedOut ? null : code
      resolve()
    })

    child.on('error', () => {
      clearTimeout(killTimer)
      resolve()
    })
  })

  const durationMs = monotonicNow() - startMs

  // Step 7: capture fs-diff
  let fsDiff = {
    filesChanged: [] as string[],
    diffStat: { insertions: 0, deletions: 0, files: 0 },
    diffHash: '',
  }
  try {
    fsDiff = await captureFsDiff(worktreePath, baseSha)
  } catch {
    // Non-fatal
  }

  // Determine final status
  const finalStatus: string = timedOut ? 'timeout' : exitCode === 0 ? 'completed' : 'failed'

  // Update sandbox_runs row
  try {
    await db
      .from('sandbox_runs')
      .update({
        status: finalStatus,
        ended_at: new Date().toISOString(),
        duration_ms: durationMs,
        exit_code: timedOut ? null : exitCode,
        timed_out: timedOut,
        stdout_truncated: truncate(stdoutData),
        stderr_truncated: truncate(stderrData),
        files_changed: fsDiff.filesChanged,
        diff_stat: fsDiff.diffStat,
        diff_hash: fsDiff.diffHash,
        warnings: warnings,
      })
      .eq('id', runId)
  } catch {
    // Non-fatal
  }

  return {
    sandboxId,
    worktreePath,
    exitCode,
    stdout: truncate(stdoutData),
    stderr: truncate(stderrData),
    timedOut,
    durationMs,
    filesChanged: fsDiff.filesChanged,
    diffStat: fsDiff.diffStat,
    diffHash: fsDiff.diffHash,
    runId,
    warnings,
  }
}

export async function cleanupSandbox(runId: string): Promise<void> {
  const db = createServiceClient()

  const { data, error } = await db
    .from('sandbox_runs')
    .select('worktree_path')
    .eq('id', runId)
    .single()

  if (error || !data) {
    throw new Error(`cleanupSandbox: could not find sandbox_run with id=${runId}`)
  }

  const worktreePath = (data as { worktree_path: string }).worktree_path

  // Remove worktree from git tracking
  try {
    await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], {
      cwd: REPO_ROOT,
    })
  } catch {
    // If git worktree remove fails, try manual filesystem removal
    try {
      fs.rmSync(worktreePath, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup
    }
  }

  // Update DB record
  await db
    .from('sandbox_runs')
    .update({ status: 'cleaned', cleaned_at: new Date().toISOString() })
    .eq('id', runId)
}

async function writeInfraFailureEvent(
  sandboxId: string,
  runId: string | null,
  errorMessage: string
): Promise<void> {
  try {
    const db = createServiceClient()
    await db.from('agent_events').insert({
      domain: 'sandbox',
      action: 'sandbox.infrastructure_failure',
      actor: 'sandbox/runtime',
      status: 'error',
      meta: {
        sandbox_id: sandboxId,
        run_id: runId,
        error: errorMessage,
      },
      occurred_at: new Date().toISOString(),
    })
  } catch {
    // Truly non-fatal
  }
}
