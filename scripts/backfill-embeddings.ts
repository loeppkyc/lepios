/**
 * backfill-embeddings.ts — generate embeddings for all knowledge rows where
 * embedding IS NULL.
 *
 * Resumable: rows that already have an embedding are skipped.
 * Progress is logged to stdout and to agent_events.
 *
 * Run:
 *   npx tsx --tsconfig tsconfig.json scripts/backfill-embeddings.ts
 *
 * Requires env vars (from .env.local or shell):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   OLLAMA_TUNNEL_URL  (optional — falls back to http://localhost:11434)
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

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
} catch { /* .env.local not present — rely on shell env */ }

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL')
if (!serviceKey)  throw new Error('Missing env var: SUPABASE_SERVICE_ROLE_KEY')

import { createClient } from '@supabase/supabase-js'
import { embed, healthCheck, OllamaUnreachableError } from '../lib/ollama/client'

const supabase = createClient(supabaseUrl, serviceKey)

const BATCH_SIZE = 10  // embeddings per Ollama call burst
const DELAY_MS   = 200 // ms between batches (avoid flooding local Ollama)

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Text to embed: title + key content fields ─────────────────────────────────

function embedText(row: {
  title: string
  problem: string | null
  solution: string | null
  context: string | null
}): string {
  return [row.title, row.problem, row.solution, row.context]
    .filter(Boolean)
    .join(' ')
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60))
  console.log('LepiOS — knowledge embedding backfill')
  console.log('='.repeat(60))

  // Confirm Ollama is reachable before starting
  const health = await healthCheck()
  if (!health.reachable) {
    console.error('\nOllama is not reachable. Start Ollama and retry.')
    console.error(`Base URL: ${process.env.OLLAMA_TUNNEL_URL ?? 'http://localhost:11434'}`)
    process.exit(1)
  }
  console.log(`\nOllama reachable — ${health.models.length} model(s), latency ${health.latency_ms}ms`)

  // Fetch rows with no embedding
  const { data: rows, error } = await supabase
    .from('knowledge')
    .select('id, title, problem, solution, context')
    .is('embedding', null)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Failed to fetch knowledge rows:', error.message)
    process.exit(1)
  }

  const total = rows?.length ?? 0
  if (total === 0) {
    console.log('\nAll knowledge rows already have embeddings. Nothing to do.')
    process.exit(0)
  }

  console.log(`\n${total} row(s) need embeddings\n`)

  let succeeded = 0
  let failed    = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)

    for (const row of batch) {
      process.stdout.write(`  [${i + batch.indexOf(row) + 1}/${total}] ${row.id.slice(0, 8)}… `)
      try {
        const vec = await embed(embedText(row))
        const { error: updateErr } = await supabase
          .from('knowledge')
          .update({ embedding: JSON.stringify(vec) })
          .eq('id', row.id)

        if (updateErr) {
          console.log(`WRITE_FAIL: ${updateErr.message}`)
          failed++
        } else {
          console.log(`OK (${vec.length}d)`)
          succeeded++
        }
      } catch (err) {
        if (err instanceof OllamaUnreachableError) {
          console.log('OLLAMA_UNREACHABLE — aborting batch')
          console.error(`\nOllama became unreachable mid-run. ${succeeded} succeeded, ${failed} failed, ${total - succeeded - failed} skipped.`)
          process.exit(1)
        }
        console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
        failed++
      }
    }

    // Throttle between batches
    if (i + BATCH_SIZE < rows.length) await delay(DELAY_MS)
  }

  console.log('\n' + '='.repeat(60))
  console.log(`Done — ${succeeded} embedded, ${failed} failed`)
  if (failed > 0) {
    console.log(`Re-run to retry the ${failed} failed row(s) (resumable — skips already-embedded rows)`)
  }
  console.log('='.repeat(60))

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
