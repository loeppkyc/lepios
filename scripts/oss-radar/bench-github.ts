#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * F18 benchmark — GitHub source client.
 * Runs 10 known queries and prints latency, rate-limit remaining, candidate count.
 *
 * Usage:
 *   npx tsx scripts/oss-radar/bench-github.ts
 *   GITHUB_TOKEN=ghp_xxx npx tsx scripts/oss-radar/bench-github.ts
 *
 * No GITHUB_TOKEN: 60 req/h unauthenticated. With token: 5000 req/h.
 * The benchmark consumes ~16 requests (10 searches + 3 metadata + 3 health).
 */

import {
  searchRepos,
  getRepoMetadata,
  getRepoHealth,
  getRateLimit,
} from '@/lib/oss-radar/sources/github'
import { getMetrics, resetMetrics } from '@/lib/oss-radar/util/metrics'

const SEARCHES: Array<{ label: string; query: string; lang?: string }> = [
  { label: 'CSV parser (Python)', query: 'csv parser', lang: 'python' },
  { label: 'HTTP client (Python)', query: 'http client requests', lang: 'python' },
  { label: 'Data validation (Python)', query: 'data validation pydantic', lang: 'python' },
  { label: 'PDF extraction (Python)', query: 'pdf text extraction', lang: 'python' },
  { label: 'OCR Python', query: 'ocr optical character recognition', lang: 'python' },
  { label: 'Spreadsheet reader (Python)', query: 'excel spreadsheet openpyxl', lang: 'python' },
  { label: 'SQLite ORM (Python)', query: 'sqlite orm peewee', lang: 'python' },
  { label: 'CLI framework (Python)', query: 'cli framework click typer', lang: 'python' },
  { label: 'Task scheduler (Python)', query: 'job scheduler apscheduler', lang: 'python' },
  { label: 'Email parser (Python)', query: 'email imap parser', lang: 'python' },
]

const KNOWN_REPOS = [
  { owner: 'psf', repo: 'requests' },
  { owner: 'pydantic', repo: 'pydantic' },
  { owner: 'pallets', repo: 'click' },
]

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`
}

async function main(): Promise<void> {
  console.log('=== OSS Radar — GitHub Benchmark ===\n')

  const rateLimit = await getRateLimit()
  if (rateLimit) {
    console.log(
      `Rate limit at start: ${rateLimit.remaining}/${rateLimit.limit} remaining (resets ${rateLimit.reset_at})\n`
    )
  }

  // ── Search benchmark ─────────────────────────────────────────────────────
  console.log('── Searches (10 queries) ──────────────────────────────────────')
  const searchTimes: number[] = []

  for (const { label, query, lang } of SEARCHES) {
    const t0 = Date.now()
    const result = await searchRepos(query, { language: lang, perPage: 5 })
    const elapsed = Date.now() - t0
    searchTimes.push(elapsed)
    console.log(
      `  [${fmt(elapsed).padStart(7)}] ${label.padEnd(35)} → ${result.candidates.length} results (total: ${result.total_count}, rl_remaining: ${result.rate_limit.remaining})`
    )
  }

  const avgSearch = searchTimes.reduce((a, b) => a + b, 0) / searchTimes.length
  const maxSearch = Math.max(...searchTimes)
  console.log(`\n  avg: ${fmt(avgSearch)}  max: ${fmt(maxSearch)}\n`)

  // ── Metadata benchmark ───────────────────────────────────────────────────
  console.log('── Metadata (3 known repos) ───────────────────────────────────')
  for (const { owner, repo } of KNOWN_REPOS) {
    const t0 = Date.now()
    const candidate = await getRepoMetadata(owner, repo)
    const elapsed = Date.now() - t0
    console.log(
      `  [${fmt(elapsed).padStart(7)}] ${owner}/${repo} → stars: ${candidate?.stars_or_downloads ?? 'N/A'}, lang: ${candidate?.lang ?? 'N/A'}`
    )
  }
  console.log('')

  // ── Health benchmark ─────────────────────────────────────────────────────
  console.log('── Health (3 known repos) ─────────────────────────────────────')
  for (const { owner, repo } of KNOWN_REPOS) {
    const t0 = Date.now()
    const health = await getRepoHealth(owner, repo)
    const elapsed = Date.now() - t0
    console.log(
      `  [${fmt(elapsed).padStart(7)}] ${owner}/${repo} → stars: ${health?.stars ?? 'N/A'}, issues: ${health?.open_issues ?? 'N/A'}, ratio: ${health?.issue_ratio?.toFixed(2) ?? 'N/A'}, archived: ${health?.archived ?? 'N/A'}`
    )
  }
  console.log('')

  // ── Final metrics ─────────────────────────────────────────────────────────
  const m = getMetrics('github')
  const rateLimitEnd = await getRateLimit()
  const consumed = rateLimit && rateLimitEnd ? rateLimit.remaining - rateLimitEnd.remaining : '?'

  console.log('── F18 Metrics ────────────────────────────────────────────────')
  console.log(`  calls_made:       ${m.calls_made}`)
  console.log(`  rate_limit_hits:  ${m.rate_limit_hits}`)
  console.log(`  errors:           ${m.errors}`)
  console.log(`  total_duration:   ${fmt(m.total_duration_ms)}`)
  console.log(
    `  avg_per_call:     ${fmt(Math.round(m.total_duration_ms / Math.max(m.calls_made, 1)))}`
  )
  console.log(`  rate_limit_cost:  ${consumed} requests consumed`)
  console.log(`\nFetch log written to: .oss-radar/fetch-log.jsonl`)

  resetMetrics('github')
}

main().catch((err) => {
  console.error('Benchmark failed:', err)
  process.exit(1)
})
