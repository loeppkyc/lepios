// F18: bench=latency_ms<2000 for non-stale calls; surface=agent_events WHERE action='githackers_api_fetch' AND meta->>'tab'='github'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { GitHubRepo, GitHubTrendingResponse } from '@/app/(cockpit)/git-hackers/_components/types'

export const dynamic = 'force-dynamic'
export const revalidate = 21600 // 6 hours

// Compute "7 days ago" date string for the GitHub search query
function sevenDaysAgo(): string {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().slice(0, 10)
}

export async function GET(): Promise<NextResponse> {
  const start = Date.now()
  const supabase = await createClient()

  // Auth guard — cockpit endpoints require an authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const token = process.env.GITHUB_TOKEN
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const query = `pushed:>${sevenDaysAgo()}&sort=stars&order=desc&per_page=25`
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}`

  let repos: GitHubRepo[] = []
  let stale = false
  let error: string | null = null

  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(8000),
    })

    if (res.status === 403 || res.status === 429) {
      // Rate limit — return stale flag so client can show degraded state
      stale = true
      error = `GitHub rate limit exceeded (${res.status}). Try again shortly.`
    } else if (!res.ok) {
      error = `GitHub API error (${res.status})`
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: { items: any[] } = await res.json()
      repos = (data.items ?? []).slice(0, 25).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (item: any): GitHubRepo => ({
          full_name: String(item.full_name ?? ''),
          description: item.description ? String(item.description) : null,
          stargazers_count: Number(item.stargazers_count ?? 0),
          language: item.language ? String(item.language) : null,
          html_url: String(item.html_url ?? ''),
          topics: Array.isArray(item.topics) ? (item.topics as string[]) : [],
        })
      )
    }
  } catch {
    error = 'GitHub API unavailable — try refreshing'
  }

  const latencyMs = Date.now() - start

  // F18: log to agent_events (non-blocking)
  void supabase.from('agent_events').insert({
    domain: 'cockpit',
    action: 'githackers_api_fetch',
    actor: 'server',
    status: error ? 'error' : 'success',
    meta: {
      tab: 'github',
      result_count: repos.length,
      latency_ms: latencyMs,
      cached: false,
      stale,
    },
  })

  const body: GitHubTrendingResponse = { repos, stale, error }
  return NextResponse.json(body)
}
