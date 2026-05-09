#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * F18 benchmark — PyPI source client.
 * Runs 10 known package lookups and prints latency, license, last release.
 *
 * Usage:
 *   npx tsx scripts/oss-radar/bench-pypi.ts
 *
 * Prerequisite: net.outbound.pypi capability must be seeded in capability_registry
 * and HOST_ALLOW entry added to lib/harness/arms-legs/http.ts by window 2.
 *
 * Note: PyPI has no keyword search API. This bench tests direct name lookups —
 * the primary path for oss_audit (streamlit_modules.external_deps[] contains exact names).
 * See pypi.ts file-level comment for keyword-search options.
 */

import { getPackageMetadata, packageExists, searchPackages } from '@/lib/oss-radar/sources/pypi'
import { getMetrics, resetMetrics } from '@/lib/oss-radar/util/metrics'

// 10 packages commonly found in Streamlit/data-science repos
const KNOWN_PACKAGES = [
  'pandas',
  'requests',
  'boto3',
  'pydantic',
  'sqlalchemy',
  'openpyxl',
  'python-dateutil',
  'pillow',
  'click',
  'httpx',
]

// Package existence checks (simple/fast)
const EXIST_CHECKS = ['numpy', 'pandas', 'this-package-does-not-exist-12345xyz']

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'N/A'
  return iso.slice(0, 10)
}

async function main(): Promise<void> {
  console.log('=== OSS Radar — PyPI Benchmark ===\n')
  console.log('Note: PyPI has no keyword search API — benchmarking direct name lookups.')
  console.log('See lib/oss-radar/sources/pypi.ts for keyword-search alternatives.\n')

  // ── Metadata benchmark ───────────────────────────────────────────────────
  console.log('── Metadata (10 known packages) ───────────────────────────────')
  const metaTimes: number[] = []

  for (const name of KNOWN_PACKAGES) {
    const t0 = Date.now()
    const meta = await getPackageMetadata(name)
    const elapsed = Date.now() - t0
    metaTimes.push(elapsed)
    console.log(
      `  [${fmt(elapsed).padStart(7)}] ${name.padEnd(20)} → license: ${(meta?.license ?? 'N/A').padEnd(12)} last_release: ${fmtDate(meta?.last_released_at ?? null)}`
    )
  }

  const avgMeta = metaTimes.reduce((a, b) => a + b, 0) / metaTimes.length
  const maxMeta = Math.max(...metaTimes)
  console.log(`\n  avg: ${fmt(avgMeta)}  max: ${fmt(maxMeta)}\n`)

  // ── Batch search (via name array) ────────────────────────────────────────
  console.log('── Batch lookup (searchPackages with name array) ───────────────')
  const batchNames = ['fastapi', 'uvicorn', 'aiohttp']
  const t0 = Date.now()
  const batchResult = await searchPackages(batchNames)
  const batchElapsed = Date.now() - t0
  console.log(
    `  [${fmt(batchElapsed).padStart(7)}] ${batchNames.join(', ')} → ${batchResult.candidates.length}/${batchNames.length} found\n`
  )

  // ── Existence check ──────────────────────────────────────────────────────
  console.log('── Existence checks (/simple/ endpoint) ───────────────────────')
  for (const name of EXIST_CHECKS) {
    const t1 = Date.now()
    const exists = await packageExists(name)
    const elapsed = Date.now() - t1
    console.log(
      `  [${fmt(elapsed).padStart(7)}] ${name.padEnd(40)} → ${exists ? 'EXISTS' : 'NOT FOUND'}`
    )
  }
  console.log('')

  // ── Final metrics ─────────────────────────────────────────────────────────
  const m = getMetrics('pypi')
  console.log('── F18 Metrics ────────────────────────────────────────────────')
  console.log(`  calls_made:       ${m.calls_made}`)
  console.log(`  rate_limit_hits:  ${m.rate_limit_hits}`)
  console.log(`  errors:           ${m.errors}`)
  console.log(`  total_duration:   ${fmt(m.total_duration_ms)}`)
  console.log(
    `  avg_per_call:     ${fmt(Math.round(m.total_duration_ms / Math.max(m.calls_made, 1)))}`
  )
  console.log(`\nFetch log written to: .oss-radar/fetch-log.jsonl`)

  resetMetrics('pypi')
}

main().catch((err) => {
  console.error('Benchmark failed:', err)
  process.exit(1)
})
