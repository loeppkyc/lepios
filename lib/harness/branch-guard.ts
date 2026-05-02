import { execSync } from 'child_process'
import { createServiceClient } from '@/lib/supabase/service'
import { requireCapability } from '@/lib/security/capability'

export function getExpectedBranch(taskId: string): string {
  return `harness/task-${taskId}`
}

export function getCurrentBranch(): string {
  return execSync('git branch --show-current', { encoding: 'utf8' }).trim()
}

export async function assertCorrectBranch(
  taskId: string,
  opts?: { agentId?: string }
): Promise<void> {
  if (!taskId) {
    throw new Error(
      'branch-guard: task_id is required — cannot verify branch without it.\n' +
        'The coordinator must be invoked with a valid task_id from task_queue.'
    )
  }

  await requireCapability({ agentId: opts?.agentId ?? 'coordinator', capability: 'shell.run' })

  const expected = getExpectedBranch(taskId)
  const current = getCurrentBranch()

  if (current !== expected) {
    await logBranchGuardTriggered(taskId, current, expected).catch(() => {
      // Non-fatal — throw the branch error regardless of logging outcome
    })
    throw new Error(
      `branch-guard: wrong branch.\n` +
        `  Current:  ${current}\n` +
        `  Expected: ${expected}\n` +
        `  Fix: git checkout -b ${expected}`
    )
  }
}

// ── F18: morning_digest summary line ─────────────────────────────────────────
// Never throws — returns "status unavailable" on any error.

export async function buildBranchGuardLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const { data, error } = await db
      .from('agent_events')
      .select('meta')
      .eq('action', 'branch_guard_triggered')
      .gte('occurred_at', since)
      .limit(10)

    if (error || !data) return 'Branch guard: status unavailable'

    const count = data.length
    if (count === 0) return 'Branch guard fires (24h): 0 ✅'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const taskIds = [...new Set((data as any[]).map((r) => r.meta?.task_id).filter(Boolean))]
    const idList = taskIds.length > 0 ? ` — task_ids: [${taskIds.join(', ')}]` : ''
    return `Branch guard fires (24h): ${count}${idList}`
  } catch {
    return 'Branch guard: status unavailable'
  }
}

async function logBranchGuardTriggered(
  taskId: string,
  attemptedBranch: string,
  expectedBranch: string
): Promise<void> {
  const db = createServiceClient()
  await db.from('agent_events').insert({
    domain: 'orchestrator',
    action: 'branch_guard_triggered',
    actor: 'branch-guard',
    status: 'warning',
    meta: {
      task_id: taskId,
      attempted_branch: attemptedBranch,
      expected_branch: expectedBranch,
    },
    occurred_at: new Date().toISOString(),
  })
}
