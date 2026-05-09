// Shared types for all OSS Radar sources.
// No Supabase imports. No server-only modules. Pure data shapes.

export type OssEcosystem = 'github' | 'npm' | 'pypi'

/** Canonical candidate shape returned by all three source clients. */
export interface Candidate {
  source: OssEcosystem
  /** Source-unique identifier: "owner/repo" for GitHub, package name for npm/pypi. */
  id: string
  name: string
  url: string
  /** GitHub: stars. npm: weekly downloads. PyPI: last-month downloads (approximate). */
  stars_or_downloads: number | null
  /** ISO-8601 timestamp of last meaningful activity (push / publish). UTC. */
  last_activity_at: string | null
  /** SPDX expression or raw license string. Null if unknown. */
  license: string | null
  /** Primary language (GitHub) or runtime (npm: "node", pypi: "python"). */
  lang: string | null
  /** True if the package/repo is archived, deprecated, or abandoned. */
  archived_or_deprecated: boolean
  /** Full raw API payload — preserved for scoring without re-fetching. */
  raw: unknown
}

// ── GitHub-specific ──────────────────────────────────────────────────────────

export interface GitHubRepoHealth {
  stars: number
  forks: number
  open_issues: number
  license: string | null
  lang: string | null
  archived: boolean
  last_push_at: string | null
  /** open_issues / (closed issues in last 90 days). Null if no data. */
  issue_ratio: number | null
}

export interface GitHubRateLimit {
  remaining: number
  limit: number
  reset_at: string // ISO-8601 UTC
}

export interface GitHubSearchResult {
  total_count: number
  candidates: Candidate[]
  rate_limit: GitHubRateLimit
}

// ── npm-specific ─────────────────────────────────────────────────────────────

export interface NpmPackageMeta {
  name: string
  version: string
  description: string | null
  license: string | null
  weekly_downloads: number | null
  last_published_at: string | null
  deprecated: boolean
  deprecated_message: string | null
  repo_url: string | null
}

export interface NpmSearchResult {
  total: number
  candidates: Candidate[]
}

// ── PyPI-specific ────────────────────────────────────────────────────────────

export interface PypiPackageMeta {
  name: string
  version: string
  description: string | null
  license: string | null
  last_released_at: string | null
  repo_url: string | null
  classifiers: string[]
}

export interface PypiSearchResult {
  candidates: Candidate[]
}

// ── Metrics (F18) ────────────────────────────────────────────────────────────

export interface SourceMetrics {
  source: OssEcosystem
  calls_made: number
  rate_limit_hits: number
  errors: number
  total_duration_ms: number
}

// ── Fetch log entry (F19) ────────────────────────────────────────────────────

export interface FetchLogEntry {
  ts_utc: string
  source: OssEcosystem
  url: string
  status: number
  duration_ms: number
  cached: boolean
  error?: string
}
