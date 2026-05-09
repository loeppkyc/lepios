// OSS Radar — GitHub data source.
// Uses the existing net.outbound.github capability + httpRequest().
// No DB writes. No Supabase imports. Returns typed Candidate objects.

import { httpRequest } from '@/lib/harness/arms-legs/http'
import type {
  Candidate,
  GitHubRateLimit,
  GitHubRepoHealth,
  GitHubSearchResult,
} from '@/lib/oss-radar/types'
import { appendFetchLog } from '@/lib/oss-radar/util/fetch-log'
import { recordCall, recordError, recordRateLimit } from '@/lib/oss-radar/util/metrics'

const CAPABILITY = 'net.outbound.github'
const AGENT_ID = 'oss_radar.github'
const BASE = 'https://api.github.com'
const DEFAULT_PER_PAGE = 10

// Accept-header required by GitHub API — without it you get a deprecation warning.
const GH_HEADERS: Record<string, string> = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'lepios-oss-radar/1.0',
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function parseRateLimit(headers: Record<string, string>): GitHubRateLimit {
  const remaining = parseInt(headers['x-ratelimit-remaining'] ?? '0', 10)
  const limit = parseInt(headers['x-ratelimit-limit'] ?? '60', 10)
  const resetEpoch = parseInt(headers['x-ratelimit-reset'] ?? '0', 10)
  const reset_at = resetEpoch ? new Date(resetEpoch * 1000).toISOString() : new Date().toISOString()
  return { remaining, limit, reset_at }
}

function repoToCandidate(repo: Record<string, unknown>): Candidate {
  const owner = (repo.owner as Record<string, unknown> | null)?.login ?? ''
  const name = (repo.name as string) ?? ''
  return {
    source: 'github',
    id: `${owner}/${name}`,
    name: `${owner}/${name}`,
    url: (repo.html_url as string) ?? `${BASE}/${owner}/${name}`,
    stars_or_downloads: (repo.stargazers_count as number) ?? null,
    last_activity_at: (repo.pushed_at as string) ?? null,
    license: ((repo.license as Record<string, unknown> | null)?.spdx_id as string) ?? null,
    lang: (repo.language as string) ?? null,
    archived_or_deprecated: (repo.archived as boolean) ?? false,
    raw: repo,
  }
}

async function ghGet<T>(
  path: string
): Promise<{ data: T; headers: Record<string, string> } | null> {
  const url = `${BASE}${path}`
  const start = Date.now()
  const result = await httpRequest({
    url,
    method: 'GET',
    capability: CAPABILITY,
    agentId: AGENT_ID,
    headers: GH_HEADERS,
  })
  const duration = Date.now() - start

  await appendFetchLog({
    ts_utc: new Date().toISOString(),
    source: 'github',
    url,
    status: result.status,
    duration_ms: duration,
    cached: result.headers['x-from-cache'] === '1',
    error: result.error,
  })

  if (result.status === 403 || result.status === 429) {
    recordRateLimit('github')
    recordCall('github', duration)
    return null
  }

  if (!result.ok) {
    recordError('github')
    recordCall('github', duration)
    return null
  }

  recordCall('github', duration)

  try {
    return { data: JSON.parse(result.body) as T, headers: result.headers }
  } catch {
    recordError('github')
    return null
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface SearchReposOpts {
  /** Sort order. Default: 'stars'. */
  sort?: 'stars' | 'forks' | 'updated' | 'help-wanted-issues' | 'best-match'
  language?: string
  perPage?: number
}

/** Search GitHub repositories. Returns up to perPage (default 10) candidates. */
export async function searchRepos(
  query: string,
  opts: SearchReposOpts = {}
): Promise<GitHubSearchResult> {
  const { sort = 'stars', language, perPage = DEFAULT_PER_PAGE } = opts

  const q = language ? `${query} language:${language}` : query
  const params = new URLSearchParams({
    q,
    sort,
    order: 'desc',
    per_page: String(perPage),
  })

  const res = await ghGet<{ total_count: number; items: Record<string, unknown>[] }>(
    `/search/repositories?${params}`
  )

  if (!res) {
    return {
      total_count: 0,
      candidates: [],
      rate_limit: { remaining: 0, limit: 60, reset_at: new Date().toISOString() },
    }
  }

  return {
    total_count: res.data.total_count,
    candidates: (res.data.items ?? []).map(repoToCandidate),
    rate_limit: parseRateLimit(res.headers),
  }
}

/** Fetch metadata for a single repo by owner/repo slug. */
export async function getRepoMetadata(owner: string, repo: string): Promise<Candidate | null> {
  const res = await ghGet<Record<string, unknown>>(`/repos/${owner}/${repo}`)
  if (!res) return null
  return repoToCandidate(res.data)
}

/** Fetch health signals for a repo: stars, issues, license, archived flag. */
export async function getRepoHealth(owner: string, repo: string): Promise<GitHubRepoHealth | null> {
  // Primary repo data
  const repoRes = await ghGet<Record<string, unknown>>(`/repos/${owner}/${repo}`)
  if (!repoRes) return null
  const r = repoRes.data

  // Closed-issues count from last 90 days (used for issue ratio)
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const closedRes = await ghGet<unknown[]>(
    `/repos/${owner}/${repo}/issues?state=closed&since=${since}&per_page=100`
  )
  const closedCount = closedRes ? closedRes.data.length : null
  const openCount = typeof r.open_issues_count === 'number' ? r.open_issues_count : null
  const issueRatio =
    closedCount !== null && closedCount > 0 && openCount !== null ? openCount / closedCount : null

  return {
    stars: (r.stargazers_count as number) ?? 0,
    forks: (r.forks_count as number) ?? 0,
    open_issues: openCount ?? 0,
    license: ((r.license as Record<string, unknown> | null)?.spdx_id as string) ?? null,
    lang: (r.language as string) ?? null,
    archived: (r.archived as boolean) ?? false,
    last_push_at: (r.pushed_at as string) ?? null,
    issue_ratio: issueRatio,
  }
}

/** Read the current rate limit without consuming a search slot. */
export async function getRateLimit(): Promise<GitHubRateLimit | null> {
  const res = await ghGet<{ rate: { remaining: number; limit: number; reset: number } }>(
    '/rate_limit'
  )
  if (!res) return null
  const { rate } = res.data
  return {
    remaining: rate.remaining,
    limit: rate.limit,
    reset_at: new Date(rate.reset * 1000).toISOString(),
  }
}
