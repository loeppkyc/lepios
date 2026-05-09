#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * F18 benchmark — npm source client.
 * Runs 10 known queries and prints latency, download counts, metadata quality.
 *
 * Usage:
 *   npx tsx scripts/oss-radar/bench-npm.ts
 *
 * Prerequisite: net.outbound.npm capability must be seeded in capability_registry
 * and HOST_ALLOW entry added to lib/harness/arms-legs/http.ts by window 2.
 */

import { searchPackages, getPackageMetadata } from '@/lib/oss-radar/sources/npm'
import { getMetrics, resetMetrics } from '@/lib/oss-radar/util/metrics'

const SEARCHES: Array<{ label: string; query: string }> = [
  { label: 'CSV parser', query: 'csv parser' },
  { label: 'HTTP client', query: 'http client axios' },
  { label: 'Date library', query: 'date time formatting' },
  { label: 'Validation', query: 'data validation zod yup' },
  { label: 'PDF generation', query: 'pdf generation' },
  { label: 'Excel/spreadsheet', query: 'excel xlsx reader' },
  { label: 'Email sender', query: 'email smtp sender' },
  { label: 'Job scheduler', query: 'job scheduler cron' },
  { label: 'CLI builder', query: 'cli argument parser commander' },
  { label: 'Database ORM', query: 'database orm prisma' },
]

const KNOWN_PACKAGES = ['axios', 'zod', 'date-fns', 'lodash', 'commander']

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`
}

function fmtNum(n: number | null): string {
  if (n === null) return 'N/A'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M/wk`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K/wk`
  return `${n}/wk`
}

async function main(): Promise<void> {
  console.log('=== OSS Radar — npm Benchmark ===\n')

  // ── Search benchmark ─────────────────────────────────────────────────────
  console.log('── Searches (10 queries) ──────────────────────────────────────')
  const searchTimes: number[] = []

  for (const { label, query } of SEARCHES) {
    const t0 = Date.now()
    const result = await searchPackages(query, 5)
    const elapsed = Date.now() - t0
    searchTimes.push(elapsed)
    const topDl = result.candidates[0]?.stars_or_downloads
    console.log(
      `  [${fmt(elapsed).padStart(7)}] ${label.padEnd(25)} → ${result.candidates.length} results (total: ${result.total}, top: ${fmtNum(topDl ?? null)})`
    )
  }

  const avgSearch = searchTimes.reduce((a, b) => a + b, 0) / searchTimes.length
  const maxSearch = Math.max(...searchTimes)
  console.log(`\n  avg: ${fmt(avgSearch)}  max: ${fmt(maxSearch)}\n`)

  // ── Metadata benchmark ───────────────────────────────────────────────────
  console.log('── Metadata (5 known packages) ────────────────────────────────')
  for (const name of KNOWN_PACKAGES) {
    const t0 = Date.now()
    const meta = await getPackageMetadata(name)
    const elapsed = Date.now() - t0
    console.log(
      `  [${fmt(elapsed).padStart(7)}] ${name.padEnd(15)} → downloads: ${fmtNum(meta?.weekly_downloads ?? null)}, license: ${meta?.license ?? 'N/A'}, deprecated: ${meta?.deprecated ?? 'N/A'}`
    )
  }
  console.log('')

  // ── Final metrics ─────────────────────────────────────────────────────────
  const m = getMetrics('npm')
  console.log('── F18 Metrics ────────────────────────────────────────────────')
  console.log(`  calls_made:       ${m.calls_made}`)
  console.log(`  rate_limit_hits:  ${m.rate_limit_hits}`)
  console.log(`  errors:           ${m.errors}`)
  console.log(`  total_duration:   ${fmt(m.total_duration_ms)}`)
  console.log(
    `  avg_per_call:     ${fmt(Math.round(m.total_duration_ms / Math.max(m.calls_made, 1)))}`
  )
  console.log(`\nFetch log written to: .oss-radar/fetch-log.jsonl`)

  resetMetrics('npm')
}

main().catch((err) => {
  console.error('Benchmark failed:', err)
  process.exit(1)
})
