/**
 * populate-streamlit-modules.ts — walk streamlit_app/, analyze each .py file,
 * and insert one row per module into the streamlit_modules catalog table.
 *
 * Idempotent: ON CONFLICT (path) DO UPDATE — safe to re-run.
 *
 * Run:
 *   npx tsx scripts/populate-streamlit-modules.ts
 *
 * Requires env vars (from .env.local or shell):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, relative, basename, join } from 'path'

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

// ── Paths ─────────────────────────────────────────────────────────────────────

// Use process.cwd() at runtime (lepios root) or __dirname (scripts/) depending on context.
// The acceptance doc says: use path.resolve(process.cwd(), '..', 'streamlit_app')
const STREAMLIT_ROOT = resolve(process.cwd(), '..', 'streamlit_app')

// ── Classification ────────────────────────────────────────────────────────────

const DEAD_MODULES = new Set(['knowledge_export.py', 'proactive_agents.py', 'task_queue.py'])

export function classifyFile(filePath: string, firstLines: string): string {
  const base = basename(filePath)
  const rel = filePath.replace(/\\/g, '/')

  // test
  if (base.startsWith('test_') || rel.includes('/tests/')) return 'test'
  // dead
  if (DEAD_MODULES.has(base)) return 'dead'
  // page
  if (
    rel.includes('/pages/') ||
    /^\d+_/.test(base) ||
    base === 'app.py' ||
    base === 'Business_Review.py'
  )
    return 'page'
  // client
  if (base.endsWith('_api.py') || /\bgoogleapiclient\b|\bsp_api\b|\bgspread\b/.test(firstLines))
    return 'client'
  // config
  if (['auth.py', 'config.py', 'style.py', 'data_layer.py', '__init__.py'].includes(base))
    return 'config'
  // util
  return 'util'
}

// ── Tier heuristic ────────────────────────────────────────────────────────────

export function applyTierHeuristic(content: string, filePath: string): number {
  const base = basename(filePath)

  // Tier 5: deep Streamlit UX — must redesign
  if (['app.py', 'auth.py', 'style.py', 'data_layer.py'].includes(base)) return 5
  if (/st\.(set_page_config|navigation|Page)\b/.test(content)) return 5

  // Tier 1: zero Streamlit
  if (!/\bst\./.test(content)) return 1

  // Tier 2: only st.secrets / st.cache_data / st.cache_resource (no UI widgets)
  const uiPattern =
    /st\.(write|metric|button|selectbox|text_input|dataframe|plotly_chart|bar_chart|line_chart|columns|tabs|expander|form|sidebar\.\w)/
  if (!uiPattern.test(content)) return 2

  // Tier 4: significant session_state
  const sessionStateCount = (content.match(/st\.session_state/g) ?? []).length
  if (sessionStateCount >= 5) return 4

  // Tier 3: display calls but limited session_state
  return 3
}

// ── External dep detection ────────────────────────────────────────────────────

const EXTERNAL_DEP_PATTERNS: [RegExp, string][] = [
  [/sp_api|amazon_sp/, 'sp_api'],
  [/keepa/, 'keepa'],
  [/gspread|from utils\.sheets|import sheets/, 'sheets'],
  [/googleapiclient|gmail\.py|from utils\.gmail/, 'gmail'],
  [/anthropic|claude/, 'anthropic'],
  [/ollama/, 'ollama'],
  [/chromadb/, 'chromadb'],
  [/telegram/, 'telegram'],
  [/sqlite3/, 'sqlite'],
  [/dropbox/, 'dropbox'],
  [/ebay/, 'ebay'],
]

function detectExternalDeps(content: string): string[] {
  const deps: string[] = []
  for (const [pattern, name] of EXTERNAL_DEP_PATTERNS) {
    if (pattern.test(content) && !deps.includes(name)) {
      deps.push(name)
    }
  }
  return deps
}

// ── Dependency scanning ───────────────────────────────────────────────────────

// deps_out: what THIS file imports from the project (utils.X or pages.X)
const IMPORT_PATTERN = /(?:from utils\.(\w+)|from pages\.(\w+)|import utils\.(\w+))/g

function detectDepsOut(content: string): string[] {
  const deps: string[] = []
  let match: RegExpExecArray | null
  IMPORT_PATTERN.lastIndex = 0
  while ((match = IMPORT_PATTERN.exec(content)) !== null) {
    const dep = match[1] ?? match[2] ?? match[3]
    if (dep && !deps.includes(dep)) deps.push(dep)
  }
  return deps
}

// ── F17/F18 auto-population ───────────────────────────────────────────────────

export function getF17Signal(classification: string, externalDeps: string[]): string | null {
  if (externalDeps.includes('sp_api'))
    return 'Amazon order/inventory events → deal pipeline state signal'
  if (externalDeps.includes('keepa')) return 'Price rank events → deal opportunity signal'
  if (externalDeps.includes('sheets')) return 'Data sync events → knowledge corpus freshness signal'
  if (classification === 'page') return 'User interaction events → behavioral ingestion utterances'
  return null
}

export function getF18Metric(externalDeps: string[]): string | null {
  if (externalDeps.includes('sp_api')) return 'SP-API quota usage, order fetch latency p95'
  if (externalDeps.includes('keepa')) return 'Keepa token consumption, lookup latency p95'
  if (externalDeps.includes('sheets')) return 'Sheets call latency p95, error rate'
  if (externalDeps.includes('gmail')) return 'Gmail scan latency p95, messages classified'
  return null
}

// ── Suggested chunks ──────────────────────────────────────────────────────────

function getSuggestedChunks(
  filePath: string,
  tier: number,
  lines: number
): Array<{ task: string; scope: string; estimated_lines: number }> {
  const base = basename(filePath)
  const domain = filePath.replace(/\\/g, '/').split('/')[0] ?? 'lib'
  const tsFilename = base.replace(/\.py$/, '.ts')

  if (tier <= 2) {
    return [
      {
        task: `Port ${base} to lib/${domain}/${tsFilename}`,
        scope: 'file',
        estimated_lines: lines,
      },
    ]
  }

  return [
    { task: `Port ${base} page component`, scope: 'page', estimated_lines: lines },
    {
      task: `Extract data hooks from ${base}`,
      scope: 'hooks',
      estimated_lines: Math.round(lines * 0.4),
    },
  ]
}

// ── File walker ───────────────────────────────────────────────────────────────

function walkDir(dir: string, results: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      walkDir(fullPath, results)
    } else if (entry.endsWith('.py')) {
      results.push(fullPath)
    }
  }
  return results
}

// ── Build reverse dep index (deps_in) ────────────────────────────────────────

function buildDepsInIndex(
  files: string[],
  depsOutMap: Map<string, string[]>
): Map<string, string[]> {
  const depsIn = new Map<string, string[]>()
  for (const [filePath, depsOut] of depsOutMap.entries()) {
    for (const dep of depsOut) {
      // dep is module name like 'amazon' or 'sheets'; match against basenames
      const existing = depsIn.get(dep) ?? []
      if (!existing.includes(filePath)) {
        existing.push(filePath)
      }
      depsIn.set(dep, existing)
    }
  }
  return depsIn
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface ModuleRow {
  path: string
  lines: number
  classification: string
  deps_in: string[]
  deps_out: string[]
  external_deps: string[]
  suggested_tier: number
  suggested_chunks: Array<{ task: string; scope: string; estimated_lines: number }>
  f17_signal: string | null
  f18_metric_candidate: string | null
  port_status: string
  notes: string | null
  updated_at: string
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL')
  if (!serviceKey) throw new Error('Missing env var: SUPABASE_SERVICE_ROLE_KEY')

  const db = createClient(supabaseUrl, serviceKey)

  console.log('='.repeat(60))
  console.log('LepiOS — populate streamlit_modules catalog')
  console.log('='.repeat(60))
  console.log(`\nStreamlit root: ${STREAMLIT_ROOT}`)

  // Collect all .py files
  let allFiles: string[]
  try {
    allFiles = walkDir(STREAMLIT_ROOT)
  } catch (err) {
    console.error(
      `\nFailed to walk ${STREAMLIT_ROOT}:`,
      err instanceof Error ? err.message : String(err)
    )
    process.exit(1)
  }

  console.log(`\nFound ${allFiles.length} .py files`)

  // First pass: compute deps_out for all files (needed to build deps_in)
  const depsOutMap = new Map<string, string[]>()
  const contentCache = new Map<string, string>()

  for (const fullPath of allFiles) {
    const content = readFileSync(fullPath, 'utf-8')
    contentCache.set(fullPath, content)
    const relPath = relative(STREAMLIT_ROOT, fullPath).replace(/\\/g, '/')
    depsOutMap.set(relPath, detectDepsOut(content))
  }

  const depsInIndex = buildDepsInIndex(
    allFiles.map((f) => relative(STREAMLIT_ROOT, f).replace(/\\/g, '/')),
    depsOutMap
  )

  // Second pass: build rows
  const rows: ModuleRow[] = []

  for (const fullPath of allFiles) {
    const relPath = relative(STREAMLIT_ROOT, fullPath).replace(/\\/g, '/')
    const content = contentCache.get(fullPath) ?? ''
    const lines = content.split('\n').length
    const firstLines = content.split('\n').slice(0, 100).join('\n')

    const classification = classifyFile(relPath, firstLines)
    const tier = applyTierHeuristic(content, relPath)
    const externalDeps = detectExternalDeps(content)
    const depsOut = depsOutMap.get(relPath) ?? []
    const moduleName = basename(relPath, '.py')
    const depsIn = depsInIndex.get(moduleName) ?? []
    const f17 = getF17Signal(classification, externalDeps)
    const f18 = getF18Metric(externalDeps)
    const chunks = getSuggestedChunks(relPath, tier, lines)

    rows.push({
      path: relPath,
      lines,
      classification,
      deps_in: depsIn,
      deps_out: depsOut,
      external_deps: externalDeps,
      suggested_tier: tier,
      suggested_chunks: chunks,
      f17_signal: f17,
      f18_metric_candidate: f18,
      port_status: 'pending',
      notes: null,
      updated_at: new Date().toISOString(),
    })
  }

  // Upsert in batches of 50
  const BATCH_SIZE = 50
  let inserted = 0
  let failed = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await db.from('streamlit_modules').upsert(batch, { onConflict: 'path' })

    if (error) {
      console.error(`Batch ${i / BATCH_SIZE + 1} failed: ${error.message}`)
      failed += batch.length
    } else {
      inserted += batch.length
    }
  }

  console.log(`\nUpserted: ${inserted} rows, Failed: ${failed} rows`)

  // Summary by classification and tier
  const byClassification: Record<string, number> = {}
  const byTier: Record<number, number> = {}
  for (const row of rows) {
    byClassification[row.classification] = (byClassification[row.classification] ?? 0) + 1
    byTier[row.suggested_tier] = (byTier[row.suggested_tier] ?? 0) + 1
  }

  console.log('\nBy classification:')
  for (const [cls, count] of Object.entries(byClassification)) {
    console.log(`  ${cls}: ${count}`)
  }
  console.log('\nBy tier:')
  for (const [tier, count] of Object.entries(byTier).sort()) {
    console.log(`  Tier ${tier}: ${count}`)
  }

  // Log to agent_events
  const { error: logErr } = await db.from('agent_events').insert({
    domain: 'streamlit',
    action: 'streamlit.catalog_populated',
    actor: 'system',
    status: failed === 0 ? 'success' : 'warning',
    output_summary: `Populated streamlit_modules: ${inserted} rows, ${failed} failed`,
    meta: {
      total: rows.length,
      inserted,
      failed,
      by_tier: byTier,
      by_classification: byClassification,
    },
    tags: ['streamlit', 'catalog'],
  })

  if (logErr) {
    console.warn('Warning: failed to log agent_events:', logErr.message)
  }

  console.log('\n' + '='.repeat(60))
  console.log(`Done — ${inserted} modules cataloged`)
  console.log('='.repeat(60))

  process.exit(failed > 0 ? 1 : 0)
}

// Conditional export for tests
if (require.main === module) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
