import { createServiceClient } from '@/lib/supabase/service'

export interface CommitAttribution {
  agentId: string
  taskId?: string | null
  commitSha: string
  branch: string
}

export interface PRAttribution {
  agentId: string
  runId?: string | null
  prNumber: number
  prUrl: string
  branch: string
}

export async function recordCommit(opts: CommitAttribution): Promise<void> {
  try {
    const db = createServiceClient()
    await db.from('attribution_log').insert({
      agent_id: opts.agentId,
      task_id: opts.taskId ?? null,
      action: 'commit',
      commit_sha: opts.commitSha,
      branch: opts.branch,
    })
  } catch {
    // non-fatal — attribution failure must never block the commit flow
  }
}

export async function recordPR(opts: PRAttribution): Promise<void> {
  try {
    const db = createServiceClient()
    await db.from('attribution_log').insert({
      agent_id: opts.agentId,
      run_id: opts.runId ?? null,
      action: 'pr_open',
      pr_number: opts.prNumber,
      pr_url: opts.prUrl,
      branch: opts.branch,
    })
  } catch {
    // non-fatal
  }
}
