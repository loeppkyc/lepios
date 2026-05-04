import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { recordCommit, recordPR } from '@/lib/harness/attribution'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const commitBody = z.object({
  action: z.literal('commit'),
  agent_id: z.string().min(1),
  task_id: z.string().optional(),
  commit_sha: z.string().min(1),
  branch: z.string().min(1),
})

const prBody = z.object({
  action: z.literal('pr_open'),
  agent_id: z.string().min(1),
  run_id: z.string().optional(),
  pr_number: z.number().int().positive(),
  pr_url: z.string().url(),
  branch: z.string().min(1),
})

const bodySchema = z.discriminatedUnion('action', [commitBody, prBody])

export async function POST(request: Request): Promise<NextResponse> {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  if (parsed.data.action === 'commit') {
    await recordCommit({
      agentId: parsed.data.agent_id,
      taskId: parsed.data.task_id,
      commitSha: parsed.data.commit_sha,
      branch: parsed.data.branch,
    })
  } else {
    await recordPR({
      agentId: parsed.data.agent_id,
      runId: parsed.data.run_id,
      prNumber: parsed.data.pr_number,
      prUrl: parsed.data.pr_url,
      branch: parsed.data.branch,
    })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
