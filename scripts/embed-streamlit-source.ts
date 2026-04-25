/**
 * embed-streamlit-source.ts — chunk .py and .md files from streamlit_app/,
 * generate embeddings via Ollama nomic-embed-text, and insert into the
 * knowledge table (domain='streamlit_source').
 *
 * F17: streamlit_source knowledge embeddings feed Twin corpus; catalog rows feed task backlog
 *
 * Post-embed: rebuilds IVFFlat index with lists=50 (was lists=10 for <1K rows).
 *
 * Idempotent: SELECT id check before INSERT/UPDATE — safe to re-run.
 * Failure threshold: if >20% of chunks fail, script exits with code 1.
 *
 * Run:
 *   npx tsx scripts/embed-streamlit-source.ts
 *
 * Requires env vars (from .env.local or shell):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   OLLAMA_TUNNEL_URL  (optional — falls back to http://localhost:11434)
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

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { embed, healthCheck, OllamaUnreachableError } from '../lib/ollama/client'
import { recordAttribution } from '../lib/attribution/writer'

// ── Paths ─────────────────────────────────────────────────────────────────────

const STREAMLIT_ROOT = resolve(process.cwd(), '..', 'streamlit_app')

// ── Exclusion lists ───────────────────────────────────────────────────────────

const EXCLUDE_FROM_EMBED = new Set(['knowledge_export.py', 'proactive_agents.py', 'task_queue.py'])

const EXCLUDE_DIRS = new Set(['tests'])

const EXCLUDE_PREFIXES = ['test_']

// .md files to embed (exactly these 5 from streamlit_app/ root)
const MD_FILES = [
  'ARCHITECTURE.md',
  'CLAUDE.md',
  'CODEBASE_INDEX.md',
  'KNOWLEDGE_SYSTEM.md',
  'SYSTEM_INTEGRITY_CHECKLIST.md',
]

// ── Python chunker ────────────────────────────────────────────────────────────

const TOP_LEVEL_DEF = /^def \w/
const METHOD_DEF = /^    def \w/
const CLASS_DEF = /^class \w/

export interface PythonChunk {
  header: string
  body: string
  functionName: string
}

export function chunkPythonFile(content: string, relativePath: string): PythonChunk[] {
  const lines = content.split('\n')
  const chunks: PythonChunk[] = []

  let currentClass: string | null = null
  let currentFn: string | null = null
  let currentLines: string[] = []

  function flushChunk() {
    if (currentFn === null || currentLines.length === 0) return
    // Minimum 5 lines
    if (currentLines.length < 5) return

    // Maximum 200 lines: split at blank-line boundary
    let body = currentLines
    if (body.length > 200) {
      // Find last blank line before line 200
      let splitAt = 200
      for (let i = 200; i > 150; i--) {
        if ((body[i] ?? '').trim() === '') {
          splitAt = i
          break
        }
      }
      body = body.slice(0, splitAt)
    }

    const fnLabel = currentClass !== null ? `class ${currentClass}.${currentFn}` : currentFn

    const header = `# File: ${relativePath} — ${fnLabel}\n`
    chunks.push({
      header,
      body: body.join('\n'),
      functionName: fnLabel,
    })
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Detect class definition
    if (CLASS_DEF.test(line)) {
      flushChunk()
      currentClass = (line.match(/^class (\w+)/) ?? [])[1] ?? null
      currentFn = null
      currentLines = [line]
      continue
    }

    // Detect top-level function
    if (TOP_LEVEL_DEF.test(line)) {
      flushChunk()
      currentClass = null // reset class context for top-level def
      currentFn = (line.match(/^def (\w+)/) ?? [])[1] ?? `fn_${i}`
      currentLines = [line]
      continue
    }

    // Detect class method (4-space indent)
    if (METHOD_DEF.test(line)) {
      flushChunk()
      currentFn = (line.match(/^    def (\w+)/) ?? [])[1] ?? `method_${i}`
      currentLines = [line]
      continue
    }

    // Append to current chunk
    if (currentFn !== null) {
      currentLines.push(line)
    }
  }

  // Flush last chunk
  flushChunk()

  return chunks
}

// ── Markdown chunker ──────────────────────────────────────────────────────────

interface MdChunk {
  header: string
  body: string
  title: string
}

function chunkMdFile(content: string, filename: string): MdChunk[] {
  const MAX_CHARS = 6_000
  let body = content

  if (body.length > MAX_CHARS) {
    // Truncate at last ## section boundary before MAX_CHARS
    const slice = body.slice(0, MAX_CHARS)
    const lastSection = slice.lastIndexOf('\n##')
    body = lastSection > 0 ? slice.slice(0, lastSection) : slice
  }

  const header = `# Doc: ${filename}\n`
  return [{ header, body, title: filename }]
}

// ── File walker ───────────────────────────────────────────────────────────────

function walkDir(dir: string, results: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      if (!EXCLUDE_DIRS.has(entry)) {
        walkDir(fullPath, results)
      }
    } else if (entry.endsWith('.py')) {
      if (!EXCLUDE_FROM_EMBED.has(entry) && !EXCLUDE_PREFIXES.some((p) => entry.startsWith(p))) {
        results.push(fullPath)
      }
    }
  }
  return results
}

// ── Classification lookup (for tags) ─────────────────────────────────────────

function classifyForTags(relPath: string, content: string): string {
  const base = basename(relPath)
  const rel = relPath.replace(/\\/g, '/')
  if (base.startsWith('test_') || rel.includes('/tests/')) return 'test'
  if (['knowledge_export.py', 'proactive_agents.py', 'task_queue.py'].includes(base)) return 'dead'
  if (
    rel.includes('/pages/') ||
    /^\d+_/.test(base) ||
    base === 'app.py' ||
    base === 'Business_Review.py'
  )
    return 'page'
  if (
    base.endsWith('_api.py') ||
    /\bgoogleapiclient\b|\bsp_api\b|\bgspread\b/.test(content.slice(0, 500))
  )
    return 'client'
  if (['auth.py', 'config.py', 'style.py', 'data_layer.py', '__init__.py'].includes(base))
    return 'config'
  return 'util'
}

function detectExternalDepsForTags(content: string): string[] {
  const patterns: [RegExp, string][] = [
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
  const deps: string[] = []
  for (const [pat, name] of patterns) {
    if (pat.test(content) && !deps.includes(name)) deps.push(name)
  }
  return deps
}

// ── Upsert helper (SELECT + INSERT or UPDATE) ─────────────────────────────────

async function upsertKnowledgeChunk(
  db: SupabaseClient,
  params: {
    relativePath: string
    title: string
    chunkText: string
    embedding: number[]
    classification: string
    externalDeps: string[]
  }
): Promise<'inserted' | 'updated' | 'failed'> {
  const { relativePath, title, chunkText, embedding, classification, externalDeps } = params

  // Check for existing row — knowledge table has no UNIQUE constraint on (domain, title)
  const { data: existing, error: selErr } = await db
    .from('knowledge')
    .select('id')
    .eq('domain', 'streamlit_source')
    .eq('title', title)
    .limit(1)
    .maybeSingle()

  if (selErr) {
    console.error(`  SELECT error for "${title.slice(0, 60)}": ${selErr.message}`)
    return 'failed'
  }

  if (existing) {
    // UPDATE existing row
    const { error: updErr } = await db
      .from('knowledge')
      .update({
        context: chunkText,
        embedding: JSON.stringify(embedding),
        updated_at: new Date().toISOString(),
      })
      .eq('id', (existing as { id: string }).id)

    if (updErr) {
      console.error(`  UPDATE error for "${title.slice(0, 60)}": ${updErr.message}`)
      return 'failed'
    }
    return 'updated'
  } else {
    // INSERT new row
    const { error: insErr } = await db.from('knowledge').insert({
      category: 'pattern',
      domain: 'streamlit_source',
      entity: relativePath,
      title: title.slice(0, 500),
      context: chunkText,
      confidence: 0.8,
      tags: JSON.stringify([classification, ...externalDeps]),
      embedding: JSON.stringify(embedding),
    })

    if (insErr) {
      console.error(`  INSERT error for "${title.slice(0, 60)}": ${insErr.message}`)
      return 'failed'
    }
    return 'inserted'
  }
}

// ── Smoke test queries ────────────────────────────────────────────────────────

const SMOKE_QUERIES = [
  { query: 'how does SP-API pagination work', expect_entity_contains: ['amazon'] },
  {
    query: 'where is GST rate calculated',
    expect_entity_contains: ['amazon_fees', '__init__', 'sourcing'],
  },
  {
    query: 'circuit breaker pattern prevent cascading failures',
    expect_entity_contains: ['circuit_breaker'],
  },
  {
    query: 'Gmail invoice extraction email scanner',
    expect_entity_contains: ['gmail', 'email_invoices'],
  },
  {
    query: 'offline-first SQLite sync Google Sheets',
    expect_entity_contains: ['data_layer', 'sync_engine'],
  },
]

async function runSmokeTests(db: SupabaseClient): Promise<number> {
  console.log('\n── Recall@5 smoke test ─────────────────────────────────────────')
  let passed = 0

  for (const sq of SMOKE_QUERIES) {
    let vec: number[]
    try {
      vec = await embed(sq.query)
    } catch {
      console.log(`  [SKIP] "${sq.query}" — Ollama unreachable for smoke test`)
      continue
    }

    const { data, error } = await db.rpc('match_knowledge', {
      query_embedding: vec,
      match_count: 5,
      min_confidence: 0,
    })

    if (error || !data || !Array.isArray(data) || data.length === 0) {
      console.log(`  [FAIL] "${sq.query}" — no results or RPC error`)
      continue
    }

    const entities = (data as Array<{ entity?: string }>).map((r) => (r.entity ?? '').toLowerCase())
    const expected = Array.isArray(sq.expect_entity_contains)
      ? sq.expect_entity_contains
      : [sq.expect_entity_contains]
    const hit = expected.some((exp: string) => entities.some((e) => e.includes(exp.toLowerCase())))

    if (hit) {
      console.log(`  [PASS] "${sq.query}"`)
      passed++
    } else {
      console.log(`  [FAIL] "${sq.query}" — top-5 entities: ${entities.join(', ')}`)
    }
  }

  return passed
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL')
  if (!serviceKey) throw new Error('Missing env var: SUPABASE_SERVICE_ROLE_KEY')

  const db = createClient(supabaseUrl, serviceKey)

  const startMs = Date.now()

  console.log('='.repeat(60))
  console.log('LepiOS — embed streamlit source corpus')
  console.log('='.repeat(60))
  console.log(`\nStreamlit root: ${STREAMLIT_ROOT}`)

  // Confirm Ollama is reachable
  const health = await healthCheck()
  if (!health.reachable) {
    console.error('\nOllama is not reachable. Start Ollama and retry.')
    console.error(`Base URL: ${process.env.OLLAMA_TUNNEL_URL ?? 'http://localhost:11434'}`)
    process.exit(1)
  }
  console.log(
    `\nOllama reachable — ${health.models.length} model(s), latency ${health.latency_ms}ms`
  )

  // Collect files
  let pyFiles: string[]
  try {
    pyFiles = walkDir(STREAMLIT_ROOT)
  } catch (err) {
    console.error(
      `\nFailed to walk ${STREAMLIT_ROOT}:`,
      err instanceof Error ? err.message : String(err)
    )
    process.exit(1)
  }

  // Collect md files
  const mdFiles: string[] = MD_FILES.map((f) => join(STREAMLIT_ROOT, f)).filter((f) => {
    try {
      statSync(f)
      return true
    } catch {
      return false
    }
  })

  console.log(`\nPy files: ${pyFiles.length}, Md files: ${mdFiles.length}`)

  // Build all chunks
  interface ChunkJob {
    relativePath: string
    title: string
    chunkText: string
    classification: string
    externalDeps: string[]
  }

  const jobs: ChunkJob[] = []

  // .py chunks
  for (const fullPath of pyFiles) {
    const relPath = relative(STREAMLIT_ROOT, fullPath).replace(/\\/g, '/')
    const content = readFileSync(fullPath, 'utf-8')
    const classification = classifyForTags(relPath, content)
    const externalDeps = detectExternalDepsForTags(content)
    const pyChunks = chunkPythonFile(content, relPath)

    for (const chunk of pyChunks) {
      const chunkText = chunk.header + chunk.body
      jobs.push({
        relativePath: relPath,
        title: `${relPath} — ${chunk.functionName}`,
        chunkText,
        classification,
        externalDeps,
      })
    }
  }

  // .md chunks
  for (const fullPath of mdFiles) {
    const filename = basename(fullPath)
    const content = readFileSync(fullPath, 'utf-8')
    const mdChunks = chunkMdFile(content, filename)
    for (const chunk of mdChunks) {
      const chunkText = chunk.header + chunk.body
      jobs.push({
        relativePath: filename,
        title: chunk.title,
        chunkText,
        classification: 'config',
        externalDeps: [],
      })
    }
  }

  const totalChunks = jobs.length
  console.log(`\nTotal chunks to embed: ${totalChunks}`)
  console.log('Starting embed pass (this may take 5-15 minutes)...\n')

  let rowsInserted = 0
  let rowsUpdated = 0
  let embedFailures = 0

  const PROGRESS_INTERVAL = 50

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]

    // Progress reporting
    if (i > 0 && i % PROGRESS_INTERVAL === 0) {
      const pct = ((i / totalChunks) * 100).toFixed(1)
      console.log(`Embedded ${i}/${totalChunks} chunks (${pct}%)...`)
    }

    // Generate embedding
    let vec: number[]
    try {
      vec = await embed(job.chunkText)
    } catch (err) {
      if (err instanceof OllamaUnreachableError) {
        embedFailures++
        process.stdout.write('.')
        continue
      }
      embedFailures++
      continue
    }

    // Upsert to knowledge table
    const result = await upsertKnowledgeChunk(db, {
      relativePath: job.relativePath,
      title: job.title,
      chunkText: job.chunkText,
      embedding: vec,
      classification: job.classification,
      externalDeps: job.externalDeps,
    })

    if (result === 'inserted') rowsInserted++
    else if (result === 'updated') rowsUpdated++
    else embedFailures++
  }

  const durationMs = Date.now() - startMs

  console.log(`\n\nEmbed pass complete:`)
  console.log(`  Chunks: ${totalChunks}`)
  console.log(`  Inserted: ${rowsInserted}`)
  console.log(`  Updated: ${rowsUpdated}`)
  console.log(`  Failures: ${embedFailures}`)
  console.log(`  Duration: ${(durationMs / 1000).toFixed(1)}s`)

  // Failure rate gate: >20% is a hard failure
  const failureRate = totalChunks > 0 ? embedFailures / totalChunks : 0
  if (failureRate > 0.2) {
    console.error(
      `\nFAIL: embed failure rate ${(failureRate * 100).toFixed(1)}% exceeds 20% threshold`
    )
    console.error('Check Ollama connectivity and retry.')
    process.exit(1)
  }

  // ── Rebuild IVFFlat index ──────────────────────────────────────────────────
  console.log('\n── Rebuilding IVFFlat index (lists=50) ─────────────────────────')
  const { error: rpcErr } = await db.rpc('rebuild_knowledge_ivfflat_index')
  if (rpcErr) {
    console.error(`  WARN: rebuild_knowledge_ivfflat_index failed: ${rpcErr.message}`)
    console.error('  Run migration 0023 first if this is a fresh deploy.')
  } else {
    console.log('  IVFFlat index rebuilt with lists=50')
  }

  // ── Smoke tests ────────────────────────────────────────────────────────────
  const smokePassed = await runSmokeTests(db)
  console.log(`\nSmoke tests: ${smokePassed}/${SMOKE_QUERIES.length} passed`)

  if (smokePassed < 4) {
    console.error('\nFAIL: recall@5 smoke test — fewer than 4/5 queries returned a relevant result')
    console.error(
      'Verify that nomic-embed-text is loaded and knowledge rows have non-null embeddings.'
    )
  }

  // ── Log to agent_events ────────────────────────────────────────────────────
  await db.from('agent_events').insert({
    domain: 'streamlit',
    action: 'streamlit.corpus_embedded',
    actor: 'system',
    status: failureRate > 0.05 ? 'warning' : 'success',
    output_summary: `Embedded ${rowsInserted + rowsUpdated} chunks (${rowsInserted} new, ${rowsUpdated} updated), ${embedFailures} failures`,
    meta: {
      total_files: pyFiles.length + mdFiles.length,
      total_chunks: totalChunks,
      rows_inserted: rowsInserted,
      rows_updated: rowsUpdated,
      embed_failures: embedFailures,
      failure_rate: failureRate,
      duration_ms: durationMs,
      smoke_passed: smokePassed,
    },
    tags: ['streamlit', 'corpus', 'embed'],
  })

  // ── Record attribution ────────────────────────────────────────────────────
  void recordAttribution(
    { actor_type: 'cron', actor_id: 'embed-streamlit-source-script' },
    { type: 'knowledge_corpus', id: 'streamlit_source' },
    'embedded',
    { chunks: totalChunks, rows_inserted: rowsInserted, rows_updated: rowsUpdated }
  )

  console.log('\n' + '='.repeat(60))
  console.log('Corpus embed complete.')
  console.log('='.repeat(60))

  process.exit(smokePassed < 4 ? 1 : 0)
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
