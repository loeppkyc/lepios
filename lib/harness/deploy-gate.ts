import { createServiceClient } from '@/lib/supabase/service'

const VERCEL_API = 'https://api.vercel.com'

export type PreviewResult = {
  status: 'ready' | 'building' | 'error' | 'not_found'
  deployment_id?: string
  preview_url?: string
  ready_state?: string
}

export async function findPreviewDeployment(commit_sha: string): Promise<PreviewResult> {
  const token = process.env.VERCEL_TOKEN
  const projectId = process.env.VERCEL_PROJECT_ID
  const teamId = process.env.VERCEL_TEAM_ID

  if (!token || !projectId) {
    const missing = !token ? 'VERCEL_TOKEN' : 'VERCEL_PROJECT_ID'
    try {
      const db = createServiceClient()
      await db.from('agent_events').insert({
        domain: 'orchestrator',
        action: 'deploy_gate_runner',
        actor: 'deploy_gate',
        status: 'error',
        task_type: 'deploy_gate_failed',
        output_summary: `gate failed: missing ${missing}`,
        meta: { commit_sha, reason: 'config', missing },
        tags: ['deploy_gate', 'harness', 'chunk_b'],
      })
    } catch {
      // swallow — config error log failure must not crash the cron
    }
    return { status: 'not_found' }
  }

  const params = new URLSearchParams({
    projectId,
    'meta-githubCommitSha': commit_sha,
    limit: '5',
  })
  if (teamId) params.set('teamId', teamId)

  let res: Response
  try {
    res = await fetch(`${VERCEL_API}/v6/deployments?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    return { status: 'not_found' }
  }

  if (!res.ok) return { status: 'not_found' }

  let json: {
    deployments?: Array<{ uid: string; url: string; readyState: string; target?: string }>
  }
  try {
    json = await res.json()
  } catch {
    return { status: 'not_found' }
  }

  const previews = (json.deployments ?? []).filter((d) => d.target !== 'production')
  if (previews.length === 0) return { status: 'not_found' }

  const d = previews[0]
  const state = (d.readyState ?? '').toUpperCase()

  if (state === 'READY') {
    return {
      status: 'ready',
      deployment_id: d.uid,
      preview_url: `https://${d.url}`,
      ready_state: d.readyState,
    }
  }

  if (state === 'ERROR' || state === 'CANCELED') {
    return { status: 'error', deployment_id: d.uid, ready_state: d.readyState }
  }

  // BUILDING, QUEUED, INITIALIZING, etc.
  return { status: 'building', deployment_id: d.uid, ready_state: d.readyState }
}
