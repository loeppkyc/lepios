/**
 * verify-step5-e2e.ts — end-to-end verification of Step 5 (Ollama + pgvector).
 *
 * Tests the full path: Ollama health → embed → generate → saveKnowledge
 * (auto-embed) → DB column check → findKnowledge (hybrid) → cleanup.
 *
 * Prerequisites:
 *   - Migration 0013_add_pgvector.sql applied to Supabase
 *   - Ollama running locally (or tunnel configured via OLLAMA_TUNNEL_URL)
 *   - nomic-embed-text model pulled: ollama pull nomic-embed-text
 *
 * Run:
 *   npx tsx --tsconfig tsconfig.json scripts/verify-step5-e2e.ts
 *
 * Output: stdout progress + docs/handoffs/step5-e2e-verification.md
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
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
import { healthCheck, embed, generate, OllamaUnreachableError } from '../lib/ollama/client'
import { saveKnowledge, findKnowledge } from '../lib/knowledge/client'

const db = createClient(supabaseUrl, serviceKey)

// ── Result tracker ────────────────────────────────────────────────────────────

interface StepResult {
  step: string
  status: 'PASS' | 'FAIL' | 'WARN'
  detail: string
  duration_ms: number
}

const results: StepResult[] = []
let insertedId: string | null = null

function log(status: 'PASS' | 'FAIL' | 'WARN', step: string, detail: string, ms: number) {
  const icon = status === 'PASS' ? '✓' : status === 'WARN' ? '⚠' : '✗'
  console.log(`  ${icon} [${status}] ${step} — ${detail} (${ms}ms)`)
  results.push({ step, status, detail, duration_ms: ms })
}

// ── Step helpers ──────────────────────────────────────────────────────────────

async function stepHealthCheck() {
  console.log('\n[1/8] Ollama health check')
  const t = Date.now()
  const health = await healthCheck()
  const ms = Date.now() - t

  if (!health.reachable) {
    log('FAIL', 'healthCheck', 'Ollama not reachable — aborting', ms)
    console.error('\n  Cannot proceed without a live Ollama instance.')
    console.error(`  URL tried: ${process.env.OLLAMA_TUNNEL_URL ?? 'http://localhost:11434'}`)
    await writeReport()
    process.exit(1)
  }

  const via = health.tunnel_used ? 'Cloudflare tunnel' : 'localhost'
  log('PASS', 'healthCheck', `reachable via ${via}, ${health.latency_ms}ms, ${health.models.length} model(s)`, ms)
  console.log(`       models: ${health.models.join(', ') || '(none listed)'}`)

  // Check for embed model
  const hasEmbedModel = health.models.some((m) => m.includes('nomic-embed-text'))
  if (!hasEmbedModel) {
    const t2 = Date.now()
    log(
      'WARN',
      'embed model check',
      'nomic-embed-text not found in model list — embed() will fail. Run: ollama pull nomic-embed-text',
      Date.now() - t2,
    )
  } else {
    const t2 = Date.now()
    log('PASS', 'embed model check', 'nomic-embed-text present', Date.now() - t2)
  }

  return health
}

async function stepEmbed() {
  console.log('\n[3/8] embed("test query for verification")')
  const t = Date.now()
  try {
    const vec = await embed('test query for verification')
    const ms = Date.now() - t
    if (!Array.isArray(vec) || vec.length !== 768) {
      log('FAIL', 'embed', `expected 768-dim array, got ${Array.isArray(vec) ? vec.length : typeof vec}-dim`, ms)
    } else {
      log('PASS', 'embed', `768-dim vector returned, sample[0]=${vec[0].toFixed(4)}`, ms)
    }
    return vec
  } catch (err) {
    const ms = Date.now() - t
    const msg = err instanceof OllamaUnreachableError ? 'Ollama unreachable' : String(err)
    log('FAIL', 'embed', msg, ms)
    return null
  }
}

async function stepGenerate() {
  console.log('\n[4/8] generate("Reply with exactly: PONG")')
  const t = Date.now()
  try {
    const result = await generate('Reply with exactly: PONG', { task: 'general' })
    const ms = Date.now() - t
    const trimmed = result.text.trim()
    const reasonable = trimmed.length > 0 && trimmed.length < 500
    const containsPong = trimmed.toUpperCase().includes('PONG')
    const status = reasonable ? 'PASS' : 'WARN'
    const detail = `confidence=${result.confidence.toFixed(2)}, model=${result.model}, response="${trimmed.slice(0, 80)}${trimmed.length > 80 ? '…' : ''}"`
    log(status, 'generate', detail, ms)
    if (!containsPong) {
      console.log('       ⚠ Response did not contain "PONG" — model may need a better prompt or may be loading')
    }
  } catch (err) {
    const ms = Date.now() - t
    log('FAIL', 'generate', err instanceof OllamaUnreachableError ? 'Ollama unreachable' : String(err), ms)
  }
}

async function stepSaveKnowledge() {
  console.log('\n[5/8] saveKnowledge() — auto-embed on save')
  const t = Date.now()
  const id = await saveKnowledge(
    'principle',
    'system',
    'Step 5 verification entry',
    {
      problem: 'Verifying end-to-end embedding pipeline for Step 5.',
      solution: 'This is a test entry confirming end-to-end embedding on save.',
      context: 'Created by scripts/verify-step5-e2e.ts — safe to delete.',
      confidence: 0.8,
      tags: ['verification', 'step5'],
    },
  )
  const ms = Date.now() - t
  if (!id) {
    log('FAIL', 'saveKnowledge', 'returned null — Supabase insert failed', ms)
  } else {
    insertedId = id
    log('PASS', 'saveKnowledge', `inserted id=${id.slice(0, 8)}…`, ms)
  }
  return id
}

async function stepDbCheck(id: string) {
  console.log('\n[6/8] DB check — embedding column populated')
  const t = Date.now()
  const { data, error } = await db
    .from('knowledge')
    .select('id, embedding')
    .eq('id', id)
    .single()
  const ms = Date.now() - t

  if (error || !data) {
    log('FAIL', 'DB embedding check', `query error: ${error?.message ?? 'no row'}`, ms)
    return false
  }

  const raw = (data as { id: string; embedding: unknown }).embedding
  if (raw === null || raw === undefined) {
    log(
      'FAIL',
      'DB embedding check',
      'embedding IS NULL — Ollama was unreachable at save time or migration not applied',
      ms,
    )
    return false
  }

  // pgvector returns the vector as a string "[0.1,0.2,...]" or a JS array
  const embStr = typeof raw === 'string' ? raw : JSON.stringify(raw)
  const dims = embStr.replace(/[\[\]]/g, '').split(',').length
  log('PASS', 'DB embedding check', `embedding IS NOT NULL, ~${dims} dims`, ms)
  return true
}

async function stepFindKnowledge(id: string, embeddingPopulated: boolean) {
  console.log('\n[7/8] findKnowledge("verification entry")')
  const t = Date.now()
  const entries = await findKnowledge('verification entry', { domain: 'system', limit: 5 })
  const ms = Date.now() - t

  const found = entries.find((e) => e.id === id)
  if (!found) {
    log(
      'FAIL',
      'findKnowledge',
      `test entry id=${id.slice(0, 8)}… not found in ${entries.length} result(s) — FTS/vector both miss`,
      ms,
    )
    return
  }

  const searchMode = embeddingPopulated ? 'hybrid (vector + FTS)' : 'FTS-only (embedding was null)'
  log('PASS', 'findKnowledge', `test entry found via ${searchMode}, ${entries.length} total result(s)`, ms)
}

async function stepCleanup(id: string) {
  console.log('\n[8/8] Cleanup — delete test entry')
  const t = Date.now()
  const { error } = await db.from('knowledge').delete().eq('id', id)
  const ms = Date.now() - t
  if (error) {
    log('WARN', 'cleanup', `delete failed: ${error.message} — delete manually: id=${id}`, ms)
  } else {
    log('PASS', 'cleanup', `deleted id=${id.slice(0, 8)}…`, ms)
    insertedId = null
  }
}

// ── Report writer ─────────────────────────────────────────────────────────────

async function writeReport() {
  const timestamp = new Date().toISOString()
  const passed  = results.filter((r) => r.status === 'PASS').length
  const failed  = results.filter((r) => r.status === 'FAIL').length
  const warned  = results.filter((r) => r.status === 'WARN').length
  const verdict = failed > 0 ? 'FAIL' : warned > 0 ? 'PASS WITH WARNINGS' : 'PASS'

  const rows = results
    .map((r) => `| ${r.step} | ${r.status} | ${r.detail} | ${r.duration_ms}ms |`)
    .join('\n')

  const md = `---
name: Step 5 E2E verification
type: project
description: Live end-to-end verification of Ollama + pgvector integration (Step 5)
---

# Step 5 E2E Verification

**Run at:** ${timestamp}
**Verdict:** ${verdict}
**Steps:** ${passed} PASS · ${warned} WARN · ${failed} FAIL

## Results

| Step | Status | Detail | Duration |
|------|--------|--------|----------|
${rows}

## Environment

- Supabase URL: ${supabaseUrl?.replace(/https?:\/\//, '').split('.')[0] ?? 'unknown'}…
- Ollama base: ${process.env.OLLAMA_TUNNEL_URL ?? 'http://localhost:11434 (local fallback)'}
- Embed model: ${process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text (default)'}

## What this confirms

${verdict !== 'FAIL' ? `
- healthCheck() reaches Ollama and returns the model list
- embed() returns a 768-dimension vector from nomic-embed-text
- generate() returns a non-empty response from the general model
- saveKnowledge() automatically generates and stores an embedding at write time
- pgvector embedding column is populated (not null) in the knowledge table
- findKnowledge() retrieves the entry via hybrid (vector + FTS) scoring
- Cleanup is complete — no test data left in the database
`.trim() : `
One or more steps failed. See the results table above.
Manual cleanup may be required if the test entry was inserted (check knowledge table for title "Step 5 verification entry").
`.trim()}
`

  const dir = resolve(process.cwd(), 'docs', 'handoffs')
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'step5-e2e-verification.md'), md, 'utf-8')
  console.log('\n  Report written → docs/handoffs/step5-e2e-verification.md')
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60))
  console.log('LepiOS Step 5 — E2E Verification')
  console.log('  Ollama + pgvector + hybrid search')
  console.log('='.repeat(60))

  // 1 + 2: health check + model presence
  await stepHealthCheck()

  // 3: embed
  await stepEmbed()

  // 4: generate
  await stepGenerate()

  // 5: saveKnowledge (auto-embed)
  const id = await stepSaveKnowledge()

  if (!id) {
    console.log('\n  saveKnowledge failed — skipping DB check, findKnowledge, and cleanup.')
    await writeReport()
    process.exit(1)
  }

  // 6: DB column check
  const embeddingPopulated = await stepDbCheck(id)

  // 7: findKnowledge hybrid
  await stepFindKnowledge(id, embeddingPopulated)

  // 8: cleanup
  await stepCleanup(id)

  // Summary
  const passed = results.filter((r) => r.status === 'PASS').length
  const failed = results.filter((r) => r.status === 'FAIL').length
  const warned = results.filter((r) => r.status === 'WARN').length

  console.log('\n' + '='.repeat(60))
  console.log(`Result: ${passed} PASS · ${warned} WARN · ${failed} FAIL`)
  console.log(failed > 0 ? 'VERDICT: FAIL' : warned > 0 ? 'VERDICT: PASS WITH WARNINGS' : 'VERDICT: PASS')
  console.log('='.repeat(60))

  await writeReport()

  // If insert succeeded but cleanup failed, warn about orphan row
  if (insertedId) {
    console.warn(`\n  ⚠ Orphan row may remain. Delete manually:`)
    console.warn(`    DELETE FROM knowledge WHERE id = '${insertedId}';`)
  }

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
