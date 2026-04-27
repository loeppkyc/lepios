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

export type MergeResult = {
  ok: boolean
  merge_sha?: string
  error?: string
}

export async function mergeToMain(
  branch: string,
  taskId: string,
  commitSha: string
): Promise<MergeResult> {
  const token = process.env.GITHUB_TOKEN
  if (!token) return { ok: false, error: 'config' }

  let res: Response
  try {
    res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/merges`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        base: 'main',
        head: branch,
        commit_message: `harness: merge task ${taskId} [deploy-gate auto-merge]\n\ncommit: ${commitSha}\nbranch: ${branch}`,
      }),
    })
  } catch {
    return { ok: false, error: 'api_error' }
  }

  if (res.status === 204) return { ok: true }
  if (res.status === 201) {
    let json: { sha?: string }
    try {
      json = await res.json()
    } catch {
      return { ok: true }
    }
    return { ok: true, merge_sha: json.sha }
  }

  return { ok: false, error: `http_${res.status}` }
}

export async function deleteBranch(branch: string): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN
  if (!token) return false

  try {
    const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/git/refs/heads/${branch}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    return res.status === 204
  } catch {
    return false
  }
}

export type RollbackResult = {
  ok: boolean
  revert_sha?: string
  error?: string
}

// Reverts a merge commit on main using the GitHub Git Data API.
// Sequence: GET merge commit → GET parent tree → GET main HEAD →
//   safety check (main must not have moved) → POST revert commit → PATCH main ref.
export async function rollbackDeployment(
  mergeSha: string,
  taskId: string
): Promise<RollbackResult> {
  const token = process.env.GITHUB_TOKEN
  if (!token) return { ok: false, error: 'config' }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  // 1 — Resolve merge commit parents
  let mergeCommit: { parents?: Array<{ sha: string }> }
  try {
    const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/git/commits/${mergeSha}`, {
      headers,
    })
    if (!res.ok) return { ok: false, error: `http_${res.status}` }
    mergeCommit = await res.json()
  } catch {
    return { ok: false, error: 'api_error' }
  }

  const parentSha = mergeCommit.parents?.[0]?.sha
  if (!parentSha) return { ok: false, error: 'no_parent' }

  // 2 — Get parent commit tree (the tree to restore)
  let parentCommit: { tree?: { sha: string } }
  try {
    const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/git/commits/${parentSha}`, {
      headers,
    })
    if (!res.ok) return { ok: false, error: `http_${res.status}` }
    parentCommit = await res.json()
  } catch {
    return { ok: false, error: 'api_error' }
  }

  const preMergeTree = parentCommit.tree?.sha
  if (!preMergeTree) return { ok: false, error: 'no_tree' }

  // 3 — Get current main HEAD
  let mainRef: { object?: { sha: string } }
  try {
    const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/git/refs/heads/main`, { headers })
    if (!res.ok) return { ok: false, error: `http_${res.status}` }
    mainRef = await res.json()
  } catch {
    return { ok: false, error: 'api_error' }
  }

  const currentHead = mainRef.object?.sha
  if (!currentHead) return { ok: false, error: 'no_head' }

  // 4 — Safety: refuse if another commit has landed on main since the merge
  if (currentHead !== mergeSha) return { ok: false, error: 'main_moved_on' }

  // 5 — Create revert commit (same tree as pre-merge parent, parent = merge commit)
  let revertCommit: { sha?: string }
  try {
    const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/git/commits`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: `revert: rollback task ${taskId}\n\nreverts merge commit ${mergeSha}`,
        tree: preMergeTree,
        parents: [mergeSha],
      }),
    })
    if (!res.ok) return { ok: false, error: `http_${res.status}` }
    revertCommit = await res.json()
  } catch {
    return { ok: false, error: 'api_error' }
  }

  const revertSha = revertCommit.sha
  if (!revertSha) return { ok: false, error: 'no_revert_sha' }

  // 6 — Advance main ref to the revert commit
  try {
    const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/git/refs/heads/main`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ sha: revertSha }),
    })
    if (!res.ok) return { ok: false, error: `http_${res.status}` }
  } catch {
    return { ok: false, error: 'api_error' }
  }

  return { ok: true, revert_sha: revertSha }
}

export type NotificationResult = {
  ok: boolean
  message_id?: number
  error?: string
}

export async function sendPromotionNotification(params: {
  task_id: string
  branch: string
  merge_sha: string
  commit_sha: string
}): Promise<NotificationResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return { ok: false, error: 'config' }

  const { task_id, branch, merge_sha, commit_sha } = params
  const callbackData = `dg:rb:${merge_sha.slice(0, 8)}`

  const text = [
    `✅ Promoted to production`,
    `task: ${task_id}`,
    `branch: ${branch}`,
    `sha: ${commit_sha.slice(0, 12)}`,
    `merge: ${merge_sha.slice(0, 12)}`,
    `👎 rollback available for 10 min`,
  ].join('\n')

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: {
          inline_keyboard: [[{ text: '👎 Rollback', callback_data: callbackData }]],
        },
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      return { ok: false, error: `telegram_${res.status}: ${body.slice(0, 100)}` }
    }
    const json = (await res.json()) as { ok: boolean; result?: { message_id: number } }
    return { ok: true, message_id: json.result?.message_id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

export type MigrationSQLResult = {
  files: Array<{ filename: string; content: string; size_bytes: number }>
  total_size_bytes: number
  error?: string
}

export async function fetchMigrationSQL(
  commit_sha: string,
  migration_files: string[]
): Promise<MigrationSQLResult> {
  const token = process.env.GITHUB_TOKEN
  if (!token) return { files: [], total_size_bytes: 0, error: 'config' }

  const results: Array<{ filename: string; content: string; size_bytes: number }> = []

  for (const filePath of migration_files) {
    let res: Response
    try {
      res = await fetch(
        `${GITHUB_API}/repos/${GITHUB_REPO}/contents/${filePath}?ref=${commit_sha}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }
      )
    } catch {
      return { files: [], total_size_bytes: 0, error: 'api_error' }
    }

    if (!res.ok) return { files: [], total_size_bytes: 0, error: 'api_error' }

    let json: { content?: string; encoding?: string }
    try {
      json = await res.json()
    } catch {
      return { files: [], total_size_bytes: 0, error: 'api_error' }
    }

    if (!json.content || json.encoding !== 'base64') {
      return { files: [], total_size_bytes: 0, error: 'api_error' }
    }

    const content = Buffer.from(json.content.replace(/\n/g, ''), 'base64').toString('utf-8')
    results.push({ filename: filePath, content, size_bytes: content.length })
  }

  const total_size_bytes = results.reduce((sum, f) => sum + f.size_bytes, 0)
  return { files: results, total_size_bytes }
}

export type CommitSummary = {
  sha: string
  message: string
}

export async function fetchPRBody(prNumber: number): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN
  if (!token) return null

  let res: Response
  try {
    res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/pulls/${prNumber}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
  } catch {
    return null
  }

  if (!res.ok) return null

  let json: unknown
  try {
    json = await res.json()
  } catch {
    return null
  }

  return (json as { body?: string | null }).body ?? null
}

export async function fetchMainCommits(perPage = 20): Promise<CommitSummary[]> {
  const token = process.env.GITHUB_TOKEN
  if (!token) return []

  let res: Response
  try {
    res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/commits?sha=main&per_page=${perPage}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
  } catch {
    return []
  }

  if (!res.ok) return []

  let json: unknown
  try {
    json = await res.json()
  } catch {
    return []
  }

  if (!Array.isArray(json)) return []

  return (json as Array<{ sha: string; commit: { message: string } }>).map((c) => ({
    sha: c.sha,
    message: c.commit?.message ?? '',
  }))
}

const COMPARE_BASE_URL = `https://github.com/${GITHUB_REPO}/compare/main...`
const MAX_MIGRATION_MSG_CHARS = 3800

export async function insertSmokePendingEvent(params: {
  merge_sha: string
  commit_sha: string
  branch: string
}): Promise<void> {
  try {
    const db = createServiceClient()
    await db.from('agent_events').insert({
      domain: 'orchestrator',
      action: 'production_smoke_pending',
      actor: 'deploy-gate',
      status: 'success',
      meta: {
        merge_sha: params.merge_sha,
        commit_sha: params.commit_sha,
        branch: params.branch,
        merged_at: new Date().toISOString(),
      },
    })
  } catch {
    // Non-fatal — smoke pending event failure must not block the promotion success
  }
}

export type MigrationGateMessageResult = {
  ok: boolean
  message_id?: number
  error?: string
  truncated?: boolean
}

export async function sendMigrationGateMessage(params: {
  task_id: string
  branch: string
  commit_sha: string
  migration_files_with_sql: Array<{ filename: string; content: string; size_bytes: number }>
}): Promise<MigrationGateMessageResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return { ok: false, error: 'config' }

  const { task_id, branch, commit_sha, migration_files_with_sql } = params
  const shaPrefix = commit_sha.slice(0, 8)
  const compareUrl = `${COMPARE_BASE_URL}${commit_sha}`

  const header = [
    `⏸ Migration review required`,
    `task: ${task_id.slice(0, 8)}`,
    `branch: ${branch}`,
    `commit: ${shaPrefix}`,
  ].join('\n')

  let sqlBody = ''
  for (const file of migration_files_with_sql) {
    const filename = file.filename.split('/').pop() ?? file.filename
    sqlBody += `\n\n─── ${filename} ───\n${file.content}`
  }

  const fullText = header + sqlBody
  let truncated = false
  let text: string

  if (fullText.length <= MAX_MIGRATION_MSG_CHARS) {
    text = fullText
  } else {
    const truncNotice = `\n\n... (truncated, view full diff: ${compareUrl})`
    const budget = MAX_MIGRATION_MSG_CHARS - header.length - truncNotice.length
    let truncBody = ''
    let used = 0
    for (const file of migration_files_with_sql) {
      const filename = file.filename.split('/').pop() ?? file.filename
      const section = `\n\n─── ${filename} ───\n`
      if (used + section.length > budget) break
      const lines = file.content.split('\n')
      let lineText = ''
      for (const line of lines) {
        if (used + section.length + lineText.length + line.length + 1 > budget) break
        lineText += line + '\n'
      }
      truncBody += section + lineText
      used += section.length + lineText.length
    }
    text = header + truncBody + truncNotice
    truncated = true
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '👍 Promote', callback_data: `dg:promote:${shaPrefix}` },
              { text: '👎 Abort', callback_data: `dg:abort:${shaPrefix}` },
            ],
          ],
        },
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      return { ok: false, error: `telegram_${res.status}: ${body.slice(0, 100)}` }
    }
    const json = (await res.json()) as { ok: boolean; result?: { message_id: number } }
    return { ok: true, message_id: json.result?.message_id, ...(truncated ? { truncated } : {}) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}
