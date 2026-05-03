/**
 * self_repair/context.ts
 *
 * Gathers context for a detected failure: the failure event itself, recent commits
 * touching likely-related files, relevant source files, and sibling events.
 *
 * Slice 1: hardcoded file-path hints per action_type (one entry).
 * Slice 3+ may move to self_repair_watchlist.likely_files TEXT[] column.
 *
 * Total context capped at ~32KB to keep LLM prompt bounded.
 * Individual files capped at 8KB (head + tail).
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { DetectedFailure } from './detector'
import { createServiceClient } from '@/lib/supabase/service'

const execFileAsync = promisify(execFile)

const FILE_CAP_BYTES = 8 * 1024 // 8KB per file
const TOTAL_CAP_BYTES = 32 * 1024 // 32KB total context
const REPO_ROOT = join(process.cwd())

// Slice 1 hardcoded mapping — one entry locks slice 1 scope (spec §M2)
const ACTION_TYPE_FILE_HINTS: Record<string, string[]> = {
  coordinator_await_timeout: [
    'lib/harness/invoke-coordinator.ts',
    'lib/orchestrator/await-result.ts',
    'app/api/harness/invoke-coordinator/route.ts',
  ],
}

export interface FailureContext {
  failure: DetectedFailure
  recentCommits: { sha: string; subject: string; files: string[] }[]
  relevantFiles: { path: string; content: string }[]
  relatedEvents: { occurred_at: string; action: string; context: unknown }[]
}

/**
 * Truncate content to cap bytes, preserving head + tail if over limit.
 */
function truncateContent(content: string, capBytes: number): string {
  const buf = Buffer.from(content, 'utf8')
  if (buf.byteLength <= capBytes) return content
  const half = Math.floor(capBytes / 2)
  const head = buf.subarray(0, half).toString('utf8')
  const tail = buf.subarray(buf.byteLength - half).toString('utf8')
  return `${head}\n... [truncated] ...\n${tail}`
}

/**
 * Read the last N git commits with their changed files.
 * Non-fatal — returns [] on any error.
 */
async function getRecentCommits(
  fileHints: string[]
): Promise<{ sha: string; subject: string; files: string[] }[]> {
  try {
    // Get last 10 commits
    const { stdout: logOut } = await execFileAsync('git', ['log', '--format=%H %s', '-n', '10'], {
      cwd: REPO_ROOT,
    })

    const commits: { sha: string; subject: string; files: string[] }[] = []

    for (const line of logOut.split('\n').filter(Boolean)) {
      const spaceIdx = line.indexOf(' ')
      if (spaceIdx === -1) continue
      const sha = line.slice(0, spaceIdx)
      const subject = line.slice(spaceIdx + 1)

      // Get files changed in this commit
      let files: string[] = []
      try {
        const { stdout: filesOut } = await execFileAsync(
          'git',
          ['diff-tree', '--no-commit-id', '-r', '--name-only', sha],
          { cwd: REPO_ROOT }
        )
        files = filesOut.split('\n').filter(Boolean)
      } catch {
        // Non-fatal
      }

      // Include commit if it touches any hinted file (or include all if no hints)
      if (
        fileHints.length === 0 ||
        files.some((f) => fileHints.some((hint) => f.includes(hint) || hint.includes(f)))
      ) {
        commits.push({ sha, subject, files })
      }
    }

    return commits.slice(0, 10)
  } catch {
    return []
  }
}

/**
 * Read relevant source files based on action_type hints.
 * Files that don't exist are silently skipped (file may have been renamed).
 * Enforces 8KB per file + 32KB total cap.
 */
function readRelevantFiles(
  actionType: string,
  totalCapBytes: number
): { path: string; content: string }[] {
  const hints = ACTION_TYPE_FILE_HINTS[actionType] ?? []
  const result: { path: string; content: string }[] = []
  let totalBytes = 0

  for (const hint of hints) {
    if (totalBytes >= totalCapBytes) break

    const fullPath = join(REPO_ROOT, hint)
    if (!existsSync(fullPath)) continue

    try {
      const raw = readFileSync(fullPath, 'utf8')
      const truncated = truncateContent(raw, FILE_CAP_BYTES)
      const bytes = Buffer.byteLength(truncated, 'utf8')

      if (totalBytes + bytes > totalCapBytes) {
        // Take what we can
        const remaining = totalCapBytes - totalBytes
        if (remaining < 512) break // Not worth including a tiny fragment
        result.push({ path: hint, content: truncateContent(raw, remaining) })
        totalBytes = totalCapBytes
      } else {
        result.push({ path: hint, content: truncated })
        totalBytes += bytes
      }
    } catch {
      // Non-fatal — file may be unreadable
    }
  }

  return result
}

/**
 * Load the last 20 agent_events rows in the same 1h window as the failure.
 * Non-fatal — returns [] on any error.
 */
async function getRelatedEvents(
  occurredAt: string
): Promise<{ occurred_at: string; action: string; context: unknown }[]> {
  try {
    const db = createServiceClient()
    const windowStart = new Date(new Date(occurredAt).getTime() - 60 * 60 * 1000).toISOString()
    const windowEnd = new Date(new Date(occurredAt).getTime() + 60 * 60 * 1000).toISOString()

    const { data } = await db
      .from('agent_events')
      .select('occurred_at, action, meta')
      .gte('occurred_at', windowStart)
      .lte('occurred_at', windowEnd)
      .order('occurred_at', { ascending: false })
      .limit(20)

    return ((data ?? []) as { occurred_at: string; action: string; meta: unknown }[]).map((r) => ({
      occurred_at: r.occurred_at,
      action: r.action,
      context: r.meta,
    }))
  } catch {
    return []
  }
}

/**
 * Gather all context needed for the fix drafter.
 * Never throws — individual sub-gatherers are each non-fatal.
 */
export async function gatherContext(failure: DetectedFailure): Promise<FailureContext> {
  const fileHints = ACTION_TYPE_FILE_HINTS[failure.actionType] ?? []

  const [recentCommits, relatedEvents] = await Promise.all([
    getRecentCommits(fileHints),
    getRelatedEvents(failure.occurredAt),
  ])

  const relevantFiles = readRelevantFiles(failure.actionType, TOTAL_CAP_BYTES)

  return {
    failure,
    recentCommits,
    relevantFiles,
    relatedEvents,
  }
}
