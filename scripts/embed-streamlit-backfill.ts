/**
 * embed-streamlit-backfill.ts — backfill the ~125 chunks that failed during
 * the overnight corpus pass (HTTP 500 / context-length overflow on emoji-dense files).
 *
 * Approach (b): walk all .py files, generate expected chunks, query knowledge
 * for existing titles, embed only what is missing. Does NOT re-embed chunks
 * that already have a row — safe to re-run.
 *
 * Uses MAX_EMBED_CHARS + embedWithRetry promoted from embed-streamlit-gaps.ts.
 *
 * Run:
 *   npx tsx scripts/embed-streamlit-backfill.ts
 *
 * Requires env vars (from .env.local or shell):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   OLLAMA_TUNNEL_URL  (optional — falls back to http://localhost:11434)
 */

import { readFileSync } from 'fs'
import { resolve, relative, join } from 'path'

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
  /* rely on shell env */
}

import { createClient } from '@supabase/supabase-js'
import { healthCheck } from '../lib/ollama/client'
import {
  walkDir,
  chunkPythonFile,
  classifyForTags,
  detectExternalDepsForTags,
  upsertKnowledgeChunk,
  embedWithRetry,
  MAX_EMBED_CHARS,
} from './embed-streamlit-source'

const STREAMLIT_ROOT = resolve(process.cwd(), '..', 'streamlit_app')

const EXCLUDE_FROM_EMBED = new Set(['knowledge_export.py', 'proactive_agents.py', 'task_queue.py'])

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL')
  if (!serviceKey) throw new Error('Missing env var: SUPABASE_SERVICE_ROLE_KEY')

  console.log('='.repeat(60))
  console.log('LepiOS — embed-streamlit-backfill (missing chunks only)')
  console.log('='.repeat(60))
  console.log(`\nMAX_EMBED_CHARS: ${MAX_EMBED_CHARS}`)

  // ── Ollama preflight ───────────────────────────────────────────────────────
  const health = await healthCheck()
  if (!health.reachable) {
    console.error('\nOllama not reachable. Start Ollama and ensure nomic-embed-text is available.')
    process.exit(1)
  }
  console.log(`Ollama reachable — ${health.models.length} model(s), latency ${health.latency_ms}ms`)

  const db = createClient(supabaseUrl, serviceKey)

  // ── Load existing knowledge titles into a Set ──────────────────────────────
  console.log('\nLoading existing knowledge titles...')
  const existingTitles = new Set<string>()
  let offset = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await db
      .from('knowledge')
      .select('title')
      .eq('domain', 'streamlit_source')
      .range(offset, offset + PAGE - 1)
    if (error) {
      console.error(`  ERROR fetching titles at offset ${offset}: ${error.message}`)
      process.exit(1)
    }
    if (!data || data.length === 0) break
    for (const row of data) existingTitles.add(row.title as string)
    if (data.length < PAGE) break
    offset += PAGE
  }
  console.log(`  Found ${existingTitles.size} existing rows in knowledge (domain=streamlit_source)`)

  // ── Walk files and build expected chunk list ───────────────────────────────
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
  console.log(`\nPy files found: ${pyFiles.length}`)

  interface MissingChunk {
    relativePath: string
    title: string
    chunkText: string
    classification: string
    externalDeps: string[]
  }

  const missing: MissingChunk[] = []

  for (const fullPath of pyFiles) {
    const relPath = relative(STREAMLIT_ROOT, fullPath).replace(/\\/g, '/')
    if (EXCLUDE_FROM_EMBED.has(relPath.split('/').pop() ?? '')) continue

    const content = readFileSync(fullPath, 'utf-8')
    const chunks = chunkPythonFile(content, relPath)

    for (const chunk of chunks) {
      const title = `${relPath} — ${chunk.functionName}`
      if (!existingTitles.has(title)) {
        missing.push({
          relativePath: relPath,
          title,
          chunkText: chunk.header + chunk.body,
          classification: classifyForTags(relPath, content),
          externalDeps: detectExternalDepsForTags(content),
        })
      }
    }
  }

  if (missing.length === 0) {
    console.log('\nNo missing chunks found — corpus is complete.')
    process.exit(0)
  }

  console.log(`\nMissing chunks to backfill: ${missing.length}`)
  console.log('Starting embed pass...\n')

  const startMs = Date.now()
  let inserted = 0
  let failed = 0

  for (let i = 0; i < missing.length; i++) {
    const job = missing[i]
    process.stdout.write(`  [${i + 1}/${missing.length}] ${job.title.slice(0, 70)}`)

    const vec = await embedWithRetry(job.chunkText)
    if (!vec) {
      console.log(' — FAIL (embed)')
      failed++
      continue
    }

    const result = await upsertKnowledgeChunk(db, {
      relativePath: job.relativePath,
      title: job.title,
      chunkText: job.chunkText,
      embedding: vec,
      classification: job.classification,
      externalDeps: job.externalDeps,
    })

    if (result === 'inserted') {
      console.log(' — inserted')
      inserted++
    } else if (result === 'updated') {
      // Shouldn't happen (title wasn't in existingTitles), but handle gracefully
      console.log(' — updated (was in DB, race condition?)')
      inserted++
    } else {
      console.log(' — FAIL (upsert)')
      failed++
    }
  }

  const durationMs = Date.now() - startMs

  console.log('\n' + '='.repeat(60))
  console.log(`Backfill complete (${(durationMs / 1000).toFixed(1)}s)`)
  console.log(`  Inserted: ${inserted}`)
  console.log(`  Failed:   ${failed}`)
  console.log('='.repeat(60))

  // ── Log to agent_events ────────────────────────────────────────────────────
  await db.from('agent_events').insert({
    domain: 'streamlit',
    action: 'streamlit.corpus_backfill',
    actor: 'system',
    status: failed > 0 ? 'warning' : 'success',
    output_summary: `Backfilled ${inserted} missing chunks, ${failed} failures`,
    meta: {
      missing_found: missing.length,
      inserted,
      failed,
      duration_ms: durationMs,
      approach: 'b_walk_and_diff',
    },
    tags: ['streamlit', 'corpus', 'backfill'],
  })

  if (failed > 0) {
    console.warn(`\nWARNING: ${failed} chunk(s) failed. Re-run to retry.`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
