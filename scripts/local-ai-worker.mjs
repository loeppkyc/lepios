#!/usr/bin/env node
/**
 * local-ai-worker.mjs — runs on Colin's machine, no Vercel involved.
 *
 * Reads env from .env.local (same file Next.js uses locally).
 * Talks to Supabase directly + Ollama at localhost:11434.
 * Loops every POLL_INTERVAL_MINUTES — does signal review, pre-research,
 * and security scan each tick.
 *
 * To start manually:  node scripts/local-ai-worker.mjs
 * To start on boot:   add scripts/start-ai-worker.bat to Windows Startup folder
 *   (%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup)
 */

import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const POLL_INTERVAL_MINUTES = 15
const OLLAMA_URL = 'http://localhost:11434'
const ANALYSIS_MODEL = process.env.OLLAMA_ANALYSIS_MODEL ?? 'qwen2.5-coder:14b'
const LOOKBACK_HOURS = 12
const GENERATE_TIMEOUT_MS = 90_000
const MAX_SOURCE_CHARS = 6000

// ── Env loader ────────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = join(ROOT, '.env.local')
  if (!existsSync(envPath)) {
    console.error('[worker] .env.local not found at', envPath)
    process.exit(1)
  }
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    '[worker] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local'
  )
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
})

// ── Analyst prompt ────────────────────────────────────────────────────────────

const ANALYST_PROMPT = `You are an analyst, not an assistant. Your job is to look at data and report what it says, including conclusions the user does not want to hear.

Rules:
- Do not affirm the user. Do not validate. Do not encourage.
- If the data is ambiguous, say "ambiguous" and report the spread.
- If the data contradicts the user's hypothesis, lead with the contradiction.
- If the user's plan has a flaw, name the flaw in the first sentence.
- Do not soften. Do not hedge with "however" clauses that walk back the finding.
- If the user asks "is this a good idea," answer "yes" or "no" first, then justify with data.
- Disagree when warranted. Stay disagreed under pressure unless new data is presented.
- Never say "great question," "interesting point," "you're right that," or any pleasantry.
- If you are uncertain, say so explicitly with a probability range.
- Cite the data point or the source of the conclusion. Unsourced claims are forbidden.

You are talking to one person, not a customer. Treat them as a peer reviewing your work.`

// ── Ollama helpers ────────────────────────────────────────────────────────────

async function ollamaHealth() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return { reachable: false, models: [] }
    const data = await res.json()
    const models = (data.models ?? []).map((m) => m.name)
    return { reachable: true, models }
  } catch {
    return { reachable: false, models: [] }
  }
}

async function ollamaGenerate(prompt, { system = ANALYST_PROMPT, model = ANALYSIS_MODEL } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS)
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, system, stream: false }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
    const data = await res.json()
    const text = data.response ?? ''
    const inputTokens = data.prompt_eval_count ?? 0
    const outputTokens = data.eval_count ?? 0
    const tokens = inputTokens + outputTokens
    // Equivalent Claude Sonnet cost ($3/M input, $15/M output)
    const claudeEquivUsd = (inputTokens * 3.0 + outputTokens * 15.0) / 1_000_000
    return { text, tokens, claudeEquivUsd }
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

// ── Supabase logging ──────────────────────────────────────────────────────────

async function logEvent(domain, action, opts = {}) {
  try {
    await db.from('agent_events').insert({
      domain,
      action,
      actor: opts.actor ?? 'local_ai_worker',
      status: opts.status ?? 'success',
      input_summary: opts.inputSummary?.slice(0, 500) ?? null,
      output_summary: opts.outputSummary?.slice(0, 500) ?? null,
      error_message: opts.errorMessage?.slice(0, 1000) ?? null,
      duration_ms: opts.durationMs ?? null,
      tokens_used: opts.tokensUsed ?? null,
      cost_usd: opts.costUsd ?? null,
      meta: opts.meta ?? null,
    })
  } catch {
    /* never break the worker on a log failure */
  }
}

// ── Signal review ─────────────────────────────────────────────────────────────

async function runSignalReview() {
  const start = Date.now()
  log('signal_review: fetching last', LOOKBACK_HOURS, 'h of events...')

  const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString()
  const { data, error } = await db
    .from('agent_events')
    .select('action, status, output_summary, occurred_at')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(50)

  if (error) {
    log('signal_review: DB error:', error.message)
    return
  }

  const rows = data ?? []
  if (rows.length === 0) {
    log('signal_review: no events in window, skipping')
    return
  }

  const summary = rows
    .map((r) => `[${r.action}] ${r.status}: ${(r.output_summary ?? '').slice(0, 100)}`)
    .join('\n')
    .slice(0, 3000)

  const prompt = `You are reviewing the last ${LOOKBACK_HOURS} hours of system events from a personal OS (LepiOS). Identify any anomalies, unexpected patterns, or issues that warrant attention.

Events:
${summary}

Format your response as a numbered list of issues found. If no issues, say "No anomalies detected."`

  try {
    const result = await ollamaGenerate(prompt)
    const durationMs = Date.now() - start
    log(`signal_review: done in ${durationMs}ms — ${rows.length} events, ~${result.tokens} tokens`)
    await logEvent('ollama', 'signal_review', {
      status: 'success',
      outputSummary: result.text.slice(0, 300),
      durationMs,
      tokensUsed: result.tokens,
      costUsd: 0,
      meta: {
        model: ANALYSIS_MODEL,
        events_reviewed: rows.length,
        claude_equivalent_usd: result.claudeEquivUsd,
      },
    })
  } catch (err) {
    log('signal_review: Ollama error:', err.message)
  }
}

// ── Pre-research ──────────────────────────────────────────────────────────────

function extractModuleHints(description) {
  const hints = new Set()
  const filePattern = /\b(\d{2,3})_([A-Za-z][A-Za-z0-9_]+)\.py\b/g
  let match
  while ((match = filePattern.exec(description)) !== null) {
    hints.add(`${match[1]}_${match[2].toLowerCase().split('_')[0]}`)
    hints.add(match[2].toLowerCase())
  }
  const descLower = description.toLowerCase()
  const slugPattern = /\b([a-z][a-z0-9]+(?:_[a-z0-9]+)+)\b/g
  while ((match = slugPattern.exec(descLower)) !== null) {
    const segs = match[1].split('_')
    if (segs.some((s) => s.length >= 4)) hints.add(match[1])
  }
  return [...hints]
}

async function fetchSourceSnippets(hints) {
  if (hints.length === 0) return ''
  const parts = []
  const seen = new Set()
  let total = 0
  for (const hint of hints) {
    if (total >= MAX_SOURCE_CHARS) break
    const { data } = await db
      .from('knowledge')
      .select('entity, title, context')
      .eq('domain', 'streamlit_source')
      .ilike('entity', `%${hint}%`)
      .limit(10)
    for (const row of data ?? []) {
      const key = `${row.entity}:${row.title}`
      if (seen.has(key)) continue
      seen.add(key)
      const snippet = `# ${row.entity} — ${row.title}\n${row.context}`
      const remaining = MAX_SOURCE_CHARS - total
      if (snippet.length > remaining) {
        parts.push(snippet.slice(0, remaining))
        total = MAX_SOURCE_CHARS
        break
      }
      parts.push(snippet)
      total += snippet.length
    }
  }
  return parts.join('\n\n')
}

async function runPreResearch() {
  const { data: tasks, error } = await db
    .from('task_queue')
    .select('id, task, description, metadata')
    .eq('status', 'queued')

  if (error || !tasks?.length) {
    log('pre_research: no queued tasks')
    return
  }

  let processed = 0
  let skipped = 0
  for (const task of tasks) {
    if (task.metadata?.research_notes) {
      skipped++
      continue
    }
    const descForHints = [task.task, task.description ?? ''].join(' ')
    const hints = extractModuleHints(descForHints)
    if (hints.length === 0) continue
    const source = await fetchSourceSnippets(hints)
    if (!source) continue

    const taskDesc = [task.task, task.description ?? ''].filter(Boolean).join(' — ')
    const prompt = `Task: ${taskDesc}\n\nStreamlit source:\n${source}`
    try {
      const result = await ollamaGenerate(prompt, {
        system:
          'Summarize domain rules, data flow, and edge cases from this Streamlit code. Be precise. Max 400 words.',
      })
      const currentMeta = task.metadata ?? {}
      await db
        .from('task_queue')
        .update({
          metadata: {
            ...currentMeta,
            research_notes: result.text,
            research_notes_generated_at: new Date().toISOString(),
            research_notes_model: ANALYSIS_MODEL,
          },
        })
        .eq('id', task.id)
      processed++
      log(`pre_research: processed task ${task.id} (${result.tokens} tokens)`)
    } catch (err) {
      log(`pre_research: Ollama error on task ${task.id}:`, err.message)
    }
  }
  log(`pre_research: ${processed} processed, ${skipped} skipped (already had notes)`)
}

// ── Security scan ─────────────────────────────────────────────────────────────

async function runSecurityScan() {
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString()
  const { data } = await db
    .from('agent_events')
    .select('domain, action, status, error_message, occurred_at')
    .gte('occurred_at', since)
    .eq('status', 'failure')
    .limit(30)

  const failures = data ?? []
  if (failures.length === 0) return

  const summary = failures
    .map((r) => `[${r.domain}/${r.action}] ${r.error_message ?? 'no message'}`)
    .join('\n')
    .slice(0, 2000)

  const prompt = `Review these system failures from the last 24 hours in a personal OS (LepiOS). Flag anything that looks like a security issue, data leak, repeated auth failure, or abnormal error pattern.

Failures:
${summary}

List only genuine concerns. If nothing stands out as a security issue, say "No security concerns."`

  try {
    const result = await ollamaGenerate(prompt)
    const hasConc = !result.text.toLowerCase().includes('no security concern')
    log(
      `security_scan: ${failures.length} failures reviewed${hasConc ? ' — CONCERNS FOUND' : ' — clean'}`
    )
    if (hasConc) {
      await logEvent('ollama', 'security_scan', {
        status: 'warning',
        outputSummary: result.text.slice(0, 400),
        tokensUsed: result.tokens,
        costUsd: 0,
        meta: {
          model: ANALYSIS_MODEL,
          failures_reviewed: failures.length,
          claude_equivalent_usd: result.claudeEquivUsd,
        },
      })
    }
  } catch (err) {
    log('security_scan: Ollama error:', err.message)
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function tick() {
  log('=== Worker tick start ===')
  const health = await ollamaHealth()

  if (!health.reachable) {
    log('Ollama not reachable at', OLLAMA_URL, '— skipping this tick')
    return
  }

  const modelLoaded = health.models.includes(ANALYSIS_MODEL)
  log(
    `Ollama up — ${health.models.length} models, ${ANALYSIS_MODEL}: ${modelLoaded ? 'loaded' : 'NOT LOADED'}`
  )
  if (!modelLoaded) {
    log('Analysis model not loaded — skipping AI tasks this tick')
    return
  }

  await runSignalReview()
  await runPreResearch()
  await runSecurityScan()

  log('=== Worker tick done ===')
}

async function main() {
  log(`Local AI Worker starting — poll every ${POLL_INTERVAL_MINUTES} min, Ollama: ${OLLAMA_URL}`)
  log(`Analysis model: ${ANALYSIS_MODEL}`)

  while (true) {
    try {
      await tick()
    } catch (err) {
      log('Tick error (continuing):', err.message)
    }
    log(`Sleeping ${POLL_INTERVAL_MINUTES} min until next tick...`)
    await sleep(POLL_INTERVAL_MINUTES * 60 * 1000)
  }
}

main().catch((err) => {
  console.error('[worker] Fatal:', err)
  process.exit(1)
})
