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

export type SmokeResult = {
  status: 'pass' | 'fail'
  status_code: number
  response_ms: number
  body_excerpt?: string
  error?: string
}

export async function runSmokeCheck(preview_url: string): Promise<SmokeResult> {
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10_000)
  const start = Date.now()

  try {
    const headers: Record<string, string> = {}
    if (bypassSecret) headers['x-vercel-protection-bypass'] = bypassSecret

    const res = await fetch(`${preview_url}/api/health`, {
      headers,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    const response_ms = Date.now() - start
    const status_code = res.status

    if (!res.ok) {
      return { status: 'fail', status_code, response_ms }
    }

    let body: Record<string, unknown>
    try {
      body = await res.json()
    } catch {
      return { status: 'fail', status_code, response_ms, error: 'json_parse_error' }
    }

    const body_excerpt = JSON.stringify(body).slice(0, 200)

    if (body.ok === true) {
      return { status: 'pass', status_code, response_ms, body_excerpt }
    }
    return { status: 'fail', status_code, response_ms, body_excerpt }
  } catch (err) {
    clearTimeout(timeoutId)
    const response_ms = Date.now() - start
    const error = err instanceof Error ? err.message : 'unknown'
    return { status: 'fail', status_code: 0, response_ms, error }
  }
}

const GITHUB_API = 'https://api.github.com'
const GITHUB_REPO = 'loeppkyc/lepios'

export type MigrationResult = {
  has_migrations: boolean
  migration_files: string[]
  error?: string
}

export async function detectMigrations(
  commit_sha: string,
  _branch: string
): Promise<MigrationResult> {
  const token = process.env.GITHUB_TOKEN

  if (!token) {
    return { has_migrations: false, migration_files: [], error: 'config' }
  }

  let res: Response
  try {
    res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/compare/main...${commit_sha}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
  } catch {
    return { has_migrations: false, migration_files: [], error: 'api_error' }
  }

  if (!res.ok) {
    return { has_migrations: false, migration_files: [], error: 'api_error' }
  }

  let json: { files?: Array<{ filename: string }> }
  try {
    json = await res.json()
  } catch {
    return { has_migrations: false, migration_files: [], error: 'api_error' }
  }

  const migration_files = (json.files ?? [])
    .map((f) => f.filename)
    .filter((name) => name.startsWith('supabase/migrations/'))

  return { has_migrations: migration_files.length > 0, migration_files }
}
