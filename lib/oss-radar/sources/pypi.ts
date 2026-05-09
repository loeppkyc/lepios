// OSS Radar — PyPI source.
//
// Capability required: net.outbound.pypi (pypi.org)
// Window 2 must add to lib/harness/arms-legs/http.ts HOST_ALLOW:
//   'net.outbound.pypi': 'pypi.org'
// And seed capability_registry in the migration:
//   INSERT INTO capability_registry (capability, default_enforcement) VALUES ('net.outbound.pypi', 'enforce')
//
// Search strategy: PyPI has no public search API endpoint.
//   Option 1 (implemented): use PyPI's /simple/ index — hits pypi.org/simple/{name}/ to check
//     if a package exists, then fetches full metadata from pypi.org/pypi/{name}/json.
//     For name-based lookup this is fast and reliable. "Search by topic" is not possible.
//   Option 2 (not implemented): libraries.io REST API — supports full-text search but requires
//     an API key. Flag: if keyword search is needed, add net.outbound.librariesio capability
//     and LIBRARIES_IO_API_KEY secret. See: https://libraries.io/api
//   Option 3 (not implemented): PyPI XMLRPC API (legacy, being deprecated) — supports
//     search but rate-limited hard and unreliable. Not recommended.
//
// Practical note: oss_audit scans streamlit_modules.external_deps[] which contains exact
// package names — so direct getPackageMetadata() lookups are the primary path. Keyword
// search is a nice-to-have for oss_scout suggestions. The /simple/ name-check is sufficient
// for v1.
//
// No DB writes. No Supabase imports. Returns typed Candidate objects.

import { httpRequest } from '@/lib/harness/arms-legs/http'
import type { Candidate, PypiPackageMeta, PypiSearchResult } from '@/lib/oss-radar/types'
import { appendFetchLog } from '@/lib/oss-radar/util/fetch-log'
import { recordCall, recordError, recordRateLimit } from '@/lib/oss-radar/util/metrics'

const CAPABILITY = 'net.outbound.pypi'
const AGENT_ID = 'oss_radar.pypi'
const PYPI_BASE = 'https://pypi.org'

// ── Internal helpers ─────────────────────────────────────────────────────────

async function pypiGet<T>(path: string): Promise<T | null> {
  const url = `${PYPI_BASE}${path}`
  const start = Date.now()
  const result = await httpRequest({
    url,
    method: 'GET',
    capability: CAPABILITY,
    agentId: AGENT_ID,
    headers: { Accept: 'application/json', 'User-Agent': 'lepios-oss-radar/1.0' },
  })
  const duration = Date.now() - start

  await appendFetchLog({
    ts_utc: new Date().toISOString(),
    source: 'pypi',
    url,
    status: result.status,
    duration_ms: duration,
    cached: false,
    error: result.error,
  })

  if (result.status === 429) {
    recordRateLimit('pypi')
    recordCall('pypi', duration)
    return null
  }

  if (!result.ok) {
    // 404 is normal for "package doesn't exist" — don't count as error
    if (result.status !== 404) recordError('pypi')
    recordCall('pypi', duration)
    return null
  }

  recordCall('pypi', duration)

  try {
    return JSON.parse(result.body) as T
  } catch {
    recordError('pypi')
    return null
  }
}

interface PypiJsonDoc {
  info: {
    name: string
    version: string
    summary?: string
    license?: string
    project_urls?: Record<string, string>
    home_page?: string
    classifiers: string[]
    yanked?: boolean
  }
  releases: Record<string, { upload_time_iso_8601?: string }[]>
}

function extractRepoUrl(doc: PypiJsonDoc): string | null {
  const urls = doc.info.project_urls ?? {}
  for (const key of ['Source', 'Repository', 'Source Code', 'Homepage', 'GitHub']) {
    const v = urls[key]
    if (v && (v.includes('github.com') || v.includes('gitlab.com') || v.includes('bitbucket'))) {
      return v
    }
  }
  const home = doc.info.home_page
  if (home && (home.includes('github.com') || home.includes('gitlab.com'))) return home
  return null
}

function lastReleaseDate(doc: PypiJsonDoc): string | null {
  const dates = Object.values(doc.releases)
    .flat()
    .map((f) => f.upload_time_iso_8601)
    .filter(Boolean)
    .sort()
    .reverse()
  return dates[0] ?? null
}

function docToMeta(doc: PypiJsonDoc): PypiPackageMeta {
  return {
    name: doc.info.name,
    version: doc.info.version,
    description: doc.info.summary ?? null,
    license: doc.info.license ?? null,
    last_released_at: lastReleaseDate(doc),
    repo_url: extractRepoUrl(doc),
    classifiers: doc.info.classifiers ?? [],
  }
}

function metaToCandidate(meta: PypiPackageMeta): Candidate {
  return {
    source: 'pypi',
    id: meta.name,
    name: meta.name,
    url: `https://pypi.org/project/${meta.name}`,
    stars_or_downloads: null, // PyPI public API doesn't expose download counts per-package
    last_activity_at: meta.last_released_at,
    license: meta.license,
    lang: 'python',
    archived_or_deprecated: false,
    raw: meta,
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Fetch full metadata for a single PyPI package by name. */
export async function getPackageMetadata(name: string): Promise<PypiPackageMeta | null> {
  const doc = await pypiGet<PypiJsonDoc>(`/pypi/${name}/json`)
  if (!doc) return null
  return docToMeta(doc)
}

/** Convert to Candidate for scoring pipeline. */
export async function getCandidate(name: string): Promise<Candidate | null> {
  const meta = await getPackageMetadata(name)
  if (!meta) return null
  return metaToCandidate(meta)
}

/**
 * "Search" PyPI packages by name list.
 *
 * PyPI has no keyword search API (see file-level comment for options). This
 * function takes an array of exact package names (e.g. from
 * streamlit_modules.external_deps[]) and returns metadata for all that exist.
 * Pass a single name in an array for simple lookups.
 *
 * For keyword-based search, add the libraries.io integration and call
 * searchByKeyword() once that capability is provisioned.
 */
export async function searchPackages(names: string[]): Promise<PypiSearchResult> {
  const results = await Promise.all(names.map((n) => getCandidate(n)))
  return {
    candidates: results.filter((c): c is Candidate => c !== null),
  }
}

/**
 * Check if a package name exists on PyPI without fetching full metadata.
 * Uses /simple/{name}/ — 200 = exists, 404 = not found.
 */
export async function packageExists(name: string): Promise<boolean> {
  const url = `${PYPI_BASE}/simple/${name}/`
  const start = Date.now()
  const result = await httpRequest({
    url,
    method: 'GET',
    capability: CAPABILITY,
    agentId: AGENT_ID,
    headers: { Accept: 'text/html', 'User-Agent': 'lepios-oss-radar/1.0' },
  })
  const duration = Date.now() - start

  await appendFetchLog({
    ts_utc: new Date().toISOString(),
    source: 'pypi',
    url,
    status: result.status,
    duration_ms: duration,
    cached: false,
    error: result.error,
  })

  recordCall('pypi', duration)
  return result.status === 200
}
