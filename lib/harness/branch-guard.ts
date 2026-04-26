import { execSync } from 'child_process'
import { createServiceClient } from '@/lib/supabase/service'

export function getExpectedBranch(taskId: string): string {
  return `harness/task-${taskId}`
}

export function getCurrentBranch(): string {
  return execSync('git branch --show-current', { encoding: 'utf8' }).trim()
}

export async function assertCorrectBranch(taskId: string): Promise<void> {
  if (!taskId) {
    throw new Error(
      'branch-guard: task_id is required — cannot verify branch without it.\n' +
        'The coordinator must be invoked with a valid task_id from task_queue.'
    )
  }

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
