#!/usr/bin/env node
/**
 * local-ai-worker.mjs — runs on Colin's machine, no Vercel involved.
 *
 * Reads env from .env.local (same file Next.js uses locally).
 * Talks to Supabase directly + Ollama at localhost:11434.
 * Loops every POLL_INTERVAL_MINUTES — does signal review, pre-research,
 * and security scan each tick.
 *
 * Alerts go via outbound_notifications → /api/harness/notifications-drain
 * (no bot token needed locally — Vercel handles Telegram delivery).
 *
 * To start manually:  node scripts/local-ai-worker.mjs
 * To start on boot:   add scripts/start-ai-worker.bat to Windows Startup folder
 *   (%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup)
 */

import { readFileSync, existsSync, readdirSync, statSync, watch } from 'fs'
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
const LEPIOS_URL = 'https://lepios-one.vercel.app'

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
      .replace(/\\n$/g, '') // strip trailing literal \n injected by vercel env pull on Windows
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
const CRON_SECRET = process.env.CRON_SECRET?.trim()

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    '[worker] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local'
  )
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
})

// Loaded from harness_config on startup
let telegramChatId = null

async function loadRuntimeConfig() {
  const { data } = await db
    .from('harness_config')
    .select('key, value')
    .in('key', ['TELEGRAM_CHAT_ID'])
  for (const row of data ?? []) {
    if (row.key === 'TELEGRAM_CHAT_ID') telegramChatId = row.value
  }
  log(`Runtime config: TELEGRAM_CHAT_ID=${telegramChatId ? 'loaded' : 'missing'}`)
}

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

// ── Telegram notifications via outbound_notifications + drain ─────────────────

// Per-type cooldown: don't fire the same alert class more than once per 4 hours
const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000
const lastAlertAt = {}

async function notify(message, type = 'general') {
  if (!telegramChatId) {
    log('notify: no TELEGRAM_CHAT_ID — skipping')
    return
  }
  const now = Date.now()
  if (lastAlertAt[type] && now - lastAlertAt[type] < ALERT_COOLDOWN_MS) {
    const cooldownRemaining = Math.round((ALERT_COOLDOWN_MS - (now - lastAlertAt[type])) / 60_000)
    log(`notify: ${type} cooldown active — ${cooldownRemaining} min remaining, skipping`)
    return
  }
  lastAlertAt[type] = now
  try {
    await db.from('outbound_notifications').insert({
      channel: 'telegram',
      chat_id: telegramChatId,
      payload: { text: message },
      status: 'pending',
    })
    if (CRON_SECRET) {
      await fetch(`${LEPIOS_URL}/api/harness/notifications-drain`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
        signal: AbortSignal.timeout(10_000),
      })
    }
  } catch (err) {
    log('notify: failed:', err.message)
  }
}

// ── Signal review ─────────────────────────────────────────────────────────────

async function runSignalReview() {
  const start = Date.now()
  log('signal_review: fetching last', LOOKBACK_HOURS, 'h of events...')

  const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString()
  const { data, error } = await db
    .from('agent_events')
    .select('action, status, output_summary, error_message, occurred_at')
    .gte('occurred_at', since)
    .in('status', ['failure', 'warning']) // only actual problems, not routine success events
    .order('occurred_at', { ascending: false })
    .limit(50)

  if (error) {
    log('signal_review: DB error:', error.message)
    return
  }

  const rows = data ?? []
  if (rows.length === 0) {
    log('signal_review: no failures/warnings in window — clean')
    return
  }

  const summary = rows
    .map(
      (r) =>
        `[${r.action}] ${r.status}: ${(r.error_message ?? r.output_summary ?? '').slice(0, 100)}`
    )
    .join('\n')
    .slice(0, 3000)

  const prompt = `You are reviewing ${rows.length} failures and warnings from the last ${LOOKBACK_HOURS} hours of a personal OS (LepiOS). Identify which ones warrant immediate attention vs which are routine noise.

Issues:
${summary}

Format your response as a numbered list of genuine concerns. If nothing needs action, say "No anomalies detected."`

  try {
    const result = await ollamaGenerate(prompt)
    const durationMs = Date.now() - start
    const hasAnomalies = !result.text.toLowerCase().includes('no anomalies detected')
    log(
      `signal_review: done in ${durationMs}ms — ${rows.length} failures/warnings, ~${result.tokens} tokens${hasAnomalies ? ' — ANOMALIES FOUND' : ''}`
    )
    await logEvent('ollama', 'signal_review', {
      status: hasAnomalies ? 'warning' : 'success',
      outputSummary: result.text.slice(0, 300),
      durationMs,
      tokensUsed: result.tokens,
      costUsd: 0,
      meta: {
        model: ANALYSIS_MODEL,
        events_reviewed: rows.length,
        claude_equivalent_usd: result.claudeEquivUsd,
        has_anomalies: hasAnomalies,
      },
    })
    if (hasAnomalies) {
      await notify(
        `LepiOS Signal Review — anomalies found:\n\n${result.text.slice(0, 800)}`,
        'signal_review'
      )
    }
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

// ── LepiOS health digest ──────────────────────────────────────────────────────

async function runHealthDigest() {
  const start = Date.now()
  // Pull recent agent_events across all domains for a quick health snapshot
  const since = new Date(Date.now() - 60 * 60_000).toISOString() // last 1h
  const { data } = await db
    .from('agent_events')
    .select('domain, action, status, occurred_at')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(40)

  const rows = data ?? []
  const failures = rows.filter((r) => r.status === 'failure').length
  const domains = [...new Set(rows.map((r) => r.domain))]

  const summary =
    rows.length === 0
      ? 'No events in the last hour.'
      : rows
          .map((r) => `[${r.domain}/${r.action}] ${r.status}`)
          .join('\n')
          .slice(0, 2000)

  const prompt = `LepiOS health check — last 1 hour of system activity.
${summary}

In 2-3 sentences: is the system healthy? Flag any domain that looks stalled or failing. If everything looks normal, say so briefly.`

  try {
    const result = await ollamaGenerate(prompt, {
      system: 'You are a system health monitor. Be terse. No pleasantries.',
    })
    const durationMs = Date.now() - start
    // Only alert on actual failure-status events, not on Ollama's word choices
    const isUnhealthy = failures > 0
    log(
      `health_digest: ${rows.length} events, ${failures} failures, ${domains.length} domains — ${durationMs}ms, ~${result.tokens} tokens`
    )
    await logEvent('ollama', 'health_digest', {
      status: isUnhealthy ? 'warning' : 'success',
      outputSummary: result.text.slice(0, 300),
      durationMs,
      tokensUsed: result.tokens,
      costUsd: 0,
      meta: {
        model: ANALYSIS_MODEL,
        events_reviewed: rows.length,
        failures,
        domains,
        claude_equivalent_usd: result.claudeEquivUsd,
      },
    })
    if (isUnhealthy) {
      await notify(`LepiOS Health Alert:\n\n${result.text.slice(0, 600)}`, 'health_digest')
    }
  } catch (err) {
    log('health_digest: Ollama error:', err.message)
  }
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
      await notify(`LepiOS Security Alert:\n\n${result.text.slice(0, 800)}`, 'security_scan')
    }
  } catch (err) {
    log('security_scan: Ollama error:', err.message)
  }
}

// ── Claude Code session scanner ───────────────────────────────────────────────

const CLAUDE_SESSIONS_DIR = 'C:\\Users\\Colin\\.claude\\projects'
const CLAUDE_CODE_WATERMARK_KEY = 'claude_code_last_scan_at'

// Claude Sonnet 4.6 pricing ($ per 1M tokens)
const CC_PRICING = { input: 3.0, output: 15.0, cache_read: 0.3, cache_creation: 3.75 }

async function getClaudeCodeWatermark() {
  try {
    const { data } = await db
      .from('harness_config')
      .select('value')
      .eq('key', CLAUDE_CODE_WATERMARK_KEY)
      .single()
    if (data?.value) return new Date(data.value)
  } catch {
    /* no row yet */
  }
  // First run: go back 24 h to capture today's sessions
  return new Date(Date.now() - 24 * 3_600_000)
}

async function setClaudeCodeWatermark(ts) {
  try {
    const { data: existing } = await db
      .from('harness_config')
      .select('key')
      .eq('key', CLAUDE_CODE_WATERMARK_KEY)
      .maybeSingle()
    if (existing) {
      await db
        .from('harness_config')
        .update({ value: ts.toISOString() })
        .eq('key', CLAUDE_CODE_WATERMARK_KEY)
    } else {
      await db
        .from('harness_config')
        .insert({ key: CLAUDE_CODE_WATERMARK_KEY, value: ts.toISOString() })
    }
  } catch (err) {
    log('claude_code_scan: watermark write failed:', err.message)
  }
}

function findJsonlFiles(dir, results = []) {
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) findJsonlFiles(full, results)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) results.push(full)
    }
  } catch {
    /* skip unreadable dirs */
  }
  return results
}

let claudeCodeScanRunning = false

async function runClaudeCodeUsageScan() {
  if (claudeCodeScanRunning) return
  claudeCodeScanRunning = true

  const watermark = await getClaudeCodeWatermark()
  const now = new Date()

  if (!existsSync(CLAUDE_SESSIONS_DIR)) {
    log('claude_code_scan: sessions dir not found — skipping')
    return
  }

  const files = findJsonlFiles(CLAUDE_SESSIONS_DIR)
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheCreationTokens = 0
  let filesScanned = 0
  let linesWithUsage = 0

  for (const filePath of files) {
    try {
      const stat = statSync(filePath)
      // Skip files not touched since watermark (mtime prefilter — append-only files are safe)
      if (stat.mtimeMs <= watermark.getTime()) continue
      const content = readFileSync(filePath, 'utf-8')
      filesScanned++
      for (const line of content.split('\n')) {
        if (!line.trim()) continue
        try {
          const obj = JSON.parse(line)
          // Per-line timestamp filter: skip lines before watermark
          if (obj.timestamp && new Date(obj.timestamp) <= watermark) continue
          // Usage lives at obj.message.usage in Claude Code JSONL format
          const usage = obj.message?.usage ?? obj.usage
          if (!usage) continue
          const it = usage.input_tokens ?? 0
          const ot = usage.output_tokens ?? 0
          const cr = usage.cache_read_input_tokens ?? 0
          const cc = usage.cache_creation_input_tokens ?? 0
          if (it + ot + cr + cc === 0) continue
          inputTokens += it
          outputTokens += ot
          cacheReadTokens += cr
          cacheCreationTokens += cc
          linesWithUsage++
        } catch {
          /* skip malformed lines */
        }
      }
    } catch {
      /* skip unreadable files */
    }
  }

  await setClaudeCodeWatermark(now)

  if (linesWithUsage === 0) {
    log(
      `claude_code_scan: ${filesScanned} files checked — no new usage since ${watermark.toISOString().slice(0, 16)}`
    )
    claudeCodeScanRunning = false
    return
  }

  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens
  const costUsd =
    (inputTokens * CC_PRICING.input +
      outputTokens * CC_PRICING.output +
      cacheReadTokens * CC_PRICING.cache_read +
      cacheCreationTokens * CC_PRICING.cache_creation) /
    1_000_000

  log(
    `claude_code_scan: ${filesScanned} files, ${linesWithUsage} entries — ` +
      `${totalTokens.toLocaleString()} tokens, $${costUsd.toFixed(4)}`
  )

  await logEvent('claude_code', 'claude.usage', {
    inputSummary: `${filesScanned} session files, ${linesWithUsage} usage entries`,
    outputSummary: `${totalTokens.toLocaleString()} tokens — $${costUsd.toFixed(4)} USD`,
    tokensUsed: totalTokens,
    costUsd,
    meta: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: cacheReadTokens,
      cache_creation_tokens: cacheCreationTokens,
      files_scanned: filesScanned,
      usage_entries: linesWithUsage,
      watermark_from: watermark.toISOString(),
      watermark_to: now.toISOString(),
    },
  })
  claudeCodeScanRunning = false
}

// ── Session file watcher (near-real-time Claude Code token tracking) ──────────

function startSessionWatcher() {
  if (!existsSync(CLAUDE_SESSIONS_DIR)) {
    log('session_watcher: dir not found, skipping')
    return null
  }

  let debounceTimer = null
  const DEBOUNCE_MS = 2_000

  const watcher = watch(CLAUDE_SESSIONS_DIR, { recursive: true }, (eventType, filename) => {
    if (!filename?.endsWith('.jsonl')) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(async () => {
      log(`session_watcher: ${filename} changed — scanning`)
      try {
        await runClaudeCodeUsageScan()
      } catch (err) {
        log('session_watcher: scan error:', err.message)
      }
    }, DEBOUNCE_MS)
  })

  watcher.on('error', (err) => log('session_watcher: error:', err.message))
  log(`session_watcher: watching ${CLAUDE_SESSIONS_DIR} (recursive, 2s debounce)`)
  return watcher
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

  // Always run — no Ollama dependency
  await runClaudeCodeUsageScan()

  const health = await ollamaHealth()

  if (!health.reachable) {
    log('Ollama not reachable at', OLLAMA_URL, '— skipping Ollama tasks')
    log('=== Worker tick done ===')
    return
  }

  const modelLoaded = health.models.includes(ANALYSIS_MODEL)
  log(
    `Ollama up — ${health.models.length} models, ${ANALYSIS_MODEL}: ${modelLoaded ? 'loaded' : 'NOT LOADED'}`
  )
  if (!modelLoaded) {
    log('Analysis model not loaded — skipping AI tasks this tick')
    log('=== Worker tick done ===')
    return
  }

  await runHealthDigest()
  await runSignalReview()
  await runPreResearch()
  await runSecurityScan()

  log('=== Worker tick done ===')
}

async function main() {
  log(`Local AI Worker starting — poll every ${POLL_INTERVAL_MINUTES} min, Ollama: ${OLLAMA_URL}`)
  log(`Analysis model: ${ANALYSIS_MODEL}`)

  await loadRuntimeConfig()
  startSessionWatcher()

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
