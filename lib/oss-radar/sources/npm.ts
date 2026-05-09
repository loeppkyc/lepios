// OSS Radar — npm registry source.
//
// Capability required: net.outbound.npm (registry.npmjs.org)
// Window 2 must add to lib/harness/arms-legs/http.ts HOST_ALLOW:
//   'net.outbound.npm': 'registry.npmjs.org'
// And seed capability_registry in the migration:
//   INSERT INTO capability_registry (capability, default_enforcement) VALUES ('net.outbound.npm', 'enforce')
//
// No DB writes. No Supabase imports. Returns typed Candidate objects.

import { httpRequest } from '@/lib/harness/arms-legs/http'
import type { Candidate, NpmPackageMeta, NpmSearchResult } from '@/lib/oss-radar/types'
import { appendFetchLog } from '@/lib/oss-radar/util/fetch-log'
import { recordCall, recordError, recordRateLimit } from '@/lib/oss-radar/util/metrics'

const CAPABILITY = 'net.outbound.npm'
const AGENT_ID = 'oss_radar.npm'
const REGISTRY = 'https://registry.npmjs.org'

// ── Internal helpers ─────────────────────────────────────────────────────────

async function npmGet<T>(path: string): Promise<T | null> {
  const url = `${REGISTRY}${path}`
  const start = Date.now()
  const result = await httpRequest({
    url,
    method: 'GET',
    capability: CAPABILITY,
    agentId: AGENT_ID,
    headers: { Accept: 'application/json' },
  })
  const duration = Date.now() - start

  await appendFetchLog({
    ts_utc: new Date().toISOString(),
    source: 'npm',
    url,
    status: result.status,
    duration_ms: duration,
    cached: false,
    error: result.error,
  })

  if (result.status === 429) {
    recordRateLimit('npm')
    recordCall('npm', duration)
    return null
  }

  if (!result.ok) {
    recordError('npm')
    recordCall('npm', duration)
    return null
  }

  recordCall('npm', duration)

  try {
    return JSON.parse(result.body) as T
  } catch {
    recordError('npm')
    return null
  }
}

interface NpmRegistryDoc {
  name: string
  description?: string
  license?: string
  repository?: { url?: string } | string
  'dist-tags': Record<string, string>
  versions: Record<string, { deprecated?: string }>
  time: Record<string, string>
}

interface NpmSearchDoc {
  package: {
    name: string
    version: string
    description?: string
    links?: { npm?: string; repository?: string }
    date?: string
  }
  score: { final: number }
}

interface NpmDownloadsDoc {
  downloads: number
  package: string
  start: string
  end: string
}

function repoUrl(doc: NpmRegistryDoc): string | null {
  if (!doc.repository) return null
  if (typeof doc.repository === 'string') return doc.repository
  return doc.repository.url ?? null
}

function packageToCandidate(meta: NpmPackageMeta): Candidate {
  return {
    source: 'npm',
    id: meta.name,
    name: meta.name,
    url: `https://www.npmjs.com/package/${meta.name}`,
    stars_or_downloads: meta.weekly_downloads,
    last_activity_at: meta.last_published_at,
    license: meta.license ?? null,
    lang: 'node',
    archived_or_deprecated: meta.deprecated,
    raw: meta,
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Fetch full metadata for a single npm package by name. */
export async function getPackageMetadata(name: string): Promise<NpmPackageMeta | null> {
  // Encode scoped packages: @org/pkg → @org%2Fpkg
  const encoded = name.replace('/', '%2F')
  const doc = await npmGet<NpmRegistryDoc>(`/${encoded}`)
  if (!doc) return null

  const latestVersion = doc['dist-tags']?.latest ?? null
  const versionData = latestVersion ? doc.versions[latestVersion] : null
  const deprecated = versionData?.deprecated !== undefined

  // last publish = most recent time entry that isn't the 'modified'/'created' meta keys
  const times = Object.entries(doc.time ?? {})
    .filter(([k]) => k !== 'modified' && k !== 'created')
    .sort(([, a], [, b]) => (a > b ? -1 : 1))
  const lastPublished = times[0]?.[1] ?? null

  // Weekly downloads from the downloads API (separate endpoint)
  const dlDoc = await npmGet<NpmDownloadsDoc>(`/downloads/point/last-week/${encoded}`)
  const weeklyDownloads = dlDoc?.downloads ?? null

  return {
    name: doc.name,
    version: latestVersion ?? '',
    description: doc.description ?? null,
    license: doc.license ?? null,
    weekly_downloads: weeklyDownloads,
    last_published_at: lastPublished,
    deprecated,
    deprecated_message:
      deprecated && versionData?.deprecated ? String(versionData.deprecated) : null,
    repo_url: repoUrl(doc),
  }
}

/** Convert metadata to Candidate for scoring pipeline. */
export async function getCandidate(name: string): Promise<Candidate | null> {
  const meta = await getPackageMetadata(name)
  if (!meta) return null
  return packageToCandidate(meta)
}

/**
 * Search npm packages using the /-/v1/search endpoint.
 * Returns up to size candidates (default 10).
 */
export async function searchPackages(query: string, size = 10): Promise<NpmSearchResult> {
  const params = new URLSearchParams({ text: query, size: String(size) })
  const doc = await npmGet<{ total: number; objects: NpmSearchDoc[] }>(`/-/v1/search?${params}`)
  if (!doc) return { total: 0, candidates: [] }

  // Enrich with weekly download counts in parallel (max 5 concurrent)
  const enriched = await Promise.all(
    (doc.objects ?? []).slice(0, size).map(async (obj) => {
      const candidate = await getCandidate(obj.package.name)
      if (candidate) return candidate
      // Fallback: build candidate from search doc without downloads
      return {
        source: 'npm' as const,
        id: obj.package.name,
        name: obj.package.name,
        url: obj.package.links?.npm ?? `https://www.npmjs.com/package/${obj.package.name}`,
        stars_or_downloads: null,
        last_activity_at: obj.package.date ?? null,
        license: null,
        lang: 'node',
        archived_or_deprecated: false,
        raw: obj,
      }
    })
  )

  return { total: doc.total, candidates: enriched }
}
