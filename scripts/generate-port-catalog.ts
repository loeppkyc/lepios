/**
 * generate-port-catalog.ts — reads streamlit_modules from Supabase and writes
 * docs/streamlit-port-catalog.md as a human-readable tier-grouped table.
 *
 * No Supabase writes. Read-only.
 *
 * Run:
 *   npx tsx scripts/generate-port-catalog.ts
 *
 * Requires env vars (from .env.local or shell):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'

// ── Load .env.local ────────────────────────────────────────────────────────────
try {
  const envLines = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8').split('\n')
  for (const line of envLines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1)
    if (key && !(key in process.env)) process.env[key] = val
  }
} catch {
  /* .env.local not present — rely on shell env */
}

import { createClient } from '@supabase/supabase-js'

// ── Types ─────────────────────────────────────────────────────────────────────

interface StreamlitModule {
  id: string
  path: string
  lines: number
  classification: string
  external_deps: string[]
  suggested_tier: number | null
  port_status: string
  notes: string | null
}

// ── Sort order: pending first, then in_progress, then others ─────────────────

const STATUS_ORDER: Record<string, number> = {
  pending: 0,
  in_progress: 1,
  complete: 2,
  deferred: 3,
  skip: 4,
}

function statusSort(a: StreamlitModule, b: StreamlitModule): number {
  const sa = STATUS_ORDER[a.port_status] ?? 99
  const sb = STATUS_ORDER[b.port_status] ?? 99
  if (sa !== sb) return sa - sb
  return a.path.localeCompare(b.path)
}

// ── Markdown table row ────────────────────────────────────────────────────────

function tableRow(m: StreamlitModule): string {
  const deps = m.external_deps.length > 0 ? m.external_deps.join(', ') : '—'
  const notes = m.notes ?? ''
  return `| ${m.path} | ${m.lines} | ${m.classification} | ${deps} | ${m.port_status} | ${notes} |`
}

// ── Tier labels ───────────────────────────────────────────────────────────────

const TIER_LABELS: Record<number, string> = {
  1: 'Pure Logic',
  2: 'Data/Client',
  3: 'Display Pages',
  4: 'Interactive Pages',
  5: 'Deep Streamlit UX',
}

// ── Catalog generator (exported for tests) ────────────────────────────────────

export function generatePortCatalog(modules: StreamlitModule[]): string {
  const now = new Date().toISOString()
  const total = modules.length
  const pending = modules.filter((m) => m.port_status === 'pending').length
  const complete = modules.filter((m) => m.port_status === 'complete').length
  const deferred = modules.filter((m) => m.port_status === 'deferred').length

  const lines: string[] = []

  lines.push('# Streamlit Port Catalog')
  lines.push(`Generated: ${now}`)
  lines.push(
    `Total modules: ${total} | Pending: ${pending} | Complete: ${complete} | Deferred: ${deferred}`
  )
  lines.push('')

  const TABLE_HEADER = '| Module | Lines | Classification | External Deps | Status | Notes |'
  const TABLE_SEP = '|---|---|---|---|---|---|'

  // Tier sections 1-5
  for (let tier = 1; tier <= 5; tier++) {
    const tierModules = modules
      .filter(
        (m) => m.suggested_tier === tier && m.classification !== 'dead' && m.port_status !== 'skip'
      )
      .sort(statusSort)

    lines.push(`## Tier ${tier} — ${TIER_LABELS[tier]} (${tierModules.length} modules)`)
    lines.push(TABLE_HEADER)
    lines.push(TABLE_SEP)

    if (tierModules.length === 0) {
      lines.push('| — | — | — | — | — | — |')
    } else {
      for (const m of tierModules) {
        lines.push(tableRow(m))
      }
    }
    lines.push('')
  }

  // Dead / Skip section
  const deadSkip = modules
    .filter((m) => m.classification === 'dead' || m.port_status === 'skip')
    .sort((a, b) => a.path.localeCompare(b.path))

  lines.push(`## Dead / Skip (${deadSkip.length} modules)`)
  lines.push(TABLE_HEADER)
  lines.push(TABLE_SEP)

  if (deadSkip.length === 0) {
    lines.push('| — | — | — | — | — | — |')
  } else {
    for (const m of deadSkip) {
      lines.push(tableRow(m))
    }
  }
  lines.push('')

  return lines.join('\n')
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL')
  if (!serviceKey) throw new Error('Missing env var: SUPABASE_SERVICE_ROLE_KEY')

  const db = createClient(supabaseUrl, serviceKey)

  console.log('='.repeat(60))
  console.log('LepiOS — generate Streamlit port catalog')
  console.log('='.repeat(60))

  // Fetch all modules from Supabase
  const { data, error } = await db
    .from('streamlit_modules')
    .select('id, path, lines, classification, external_deps, suggested_tier, port_status, notes')
    .order('suggested_tier', { ascending: true, nullsFirst: false })
    .order('path', { ascending: true })

  if (error) {
    console.error('Failed to fetch streamlit_modules:', error.message)
    process.exit(1)
  }

  const modules = (data ?? []) as StreamlitModule[]
  console.log(`\nFetched ${modules.length} module rows`)

  if (modules.length === 0) {
    console.error('\nNo rows in streamlit_modules. Run populate-streamlit-modules.ts first.')
    process.exit(1)
  }

  const catalog = generatePortCatalog(modules)

  // Write to docs/streamlit-port-catalog.md
  const outPath = resolve(process.cwd(), 'docs', 'streamlit-port-catalog.md')
  try {
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, catalog, 'utf-8')
    console.log(`\nWrote: ${outPath}`)
  } catch (err) {
    console.error('Failed to write catalog:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  // Print tier summary
  const tierCounts: Record<number, number> = {}
  for (const m of modules) {
    if (m.suggested_tier) {
      tierCounts[m.suggested_tier] = (tierCounts[m.suggested_tier] ?? 0) + 1
    }
  }
  console.log('\nTier distribution:')
  for (const [t, c] of Object.entries(tierCounts).sort()) {
    console.log(`  Tier ${t}: ${c}`)
  }

  console.log('\n' + '='.repeat(60))
  console.log('Catalog generated.')
  console.log('='.repeat(60))
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
