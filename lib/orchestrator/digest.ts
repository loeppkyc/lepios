import { createServiceClient } from '@/lib/supabase/service'
import { postMessage, MissingTelegramConfigError } from './telegram'
import { fetchHistoricalContext, scoreMorningDigest } from './scoring'
import { CURRENT_CAPACITY_TIER } from './config'
import type { DigestResult, DigestStatus, QualityScore, TickResult } from './types'
import { getDigestStallSummary } from '@/lib/harness/stall-check'
import { buildBranchGuardLine } from '@/lib/harness/branch-guard'
import { buildProcessEfficiencyLines } from '@/lib/harness/process-efficiency'
import { buildFtsFallbackLine } from '@/lib/twin/fts-fallback'
import { buildDrainStatsLine, buildReviewTimeoutLine } from '@/lib/harness/telegram-stats'
import { buildQuotaCliffLine } from '@/lib/harness/quota-cliff'
import { buildHarnessRollupLine } from '@/lib/harness/rollup'
import { buildQuotaGuardLine } from '@/lib/harness/quota-guard'
import { buildStartupForecastLine } from '@/lib/harness/quota-forecast'
import { buildTaxSanityLine } from '@/lib/harness/tax-sanity'
import { buildAmazonOrdersSyncLine } from '@/lib/amazon/orders-digest'
export function composeMorningDigest(tick: TickResult): string {
  const date = tick.started_at.slice(0, 10)
  const lines: string[] = [`LepiOS night report — ${date}`, '']

  for (const check of tick.checks) {
    const icon = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌'
    const flagCount = check.flags.length

    if (check.name === 'site_health') {
      const pass = check.counts.pass ?? 0
      lines.push(`${icon} Site health: ${pass}/3 pass`)
    } else if (check.name === 'scan_integrity') {
      const scans = check.counts.total ?? 0
      lines.push(`${icon} Scan integrity: ${scans} scans, ${flagCount} flags`)
    } else if (check.name === 'event_log_consistency') {
      const events = check.counts.total ?? 0
      lines.push(`${icon} Event log: ${events} events, ${flagCount} flagged`)
    }
  }

  lines.push('')
  lines.push(`Tick duration: ${(tick.duration_ms / 1000).toFixed(1)}s`)
  lines.push(`Tick ID: ${tick.tick_id.slice(0, 8)}`)

  const allFlags = tick.checks.flatMap((c) => c.flags)
  if (allFlags.length > 0) {
    lines.push('')
    lines.push('Flags:')
    for (const f of allFlags.slice(0, 5)) {
      const entity = f.entity_id ? ` [${f.entity_id.slice(0, 8)}]` : ''
      lines.push(`• ${f.message}${entity}`)
    }
  }

  return lines.join('\n')
}

// ── F18: Ollama stats line ────────────────────────────────────────────────────

/**
 * Build one Telegram message line summarising Ollama activity in the last 24h.
 * Never throws — on any error returns "Ollama: stats unavailable".
 */
export async function buildOllamaStatsLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()

    // Both queries always run (consistent slot count for test mocking)
    const [generateResult, twinResult] = await Promise.all([
      db
        .from('agent_events')
        .select('status, duration_ms')
        .eq('action', 'ollama.generate')
        .gte('occurred_at', since),
      db.from('agent_events').select('meta').eq('action', 'twin.ask').gte('occurred_at', since),
    ])

    const generateRows = generateResult.data
    const twinRows = twinResult.data

    const total = generateRows?.length ?? 0
    if (total === 0) return 'Ollama: no calls in last 24h'

    const successes = (generateRows ?? []).filter((r) => r.status === 'success').length
    const uptimePct = Math.round((successes / total) * 100)

    const latencies = (generateRows ?? [])
      .filter((r) => r.status === 'success' && r.duration_ms != null)
      .map((r) => r.duration_ms as number)
      .sort((a, b) => a - b)
    const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : null

    const twinTotal = (twinRows ?? []).length
    const localServed = (twinRows ?? []).filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r: any) => r.meta?.routing_decision === 'ollama'
    ).length
    const fallbackPct =
      twinTotal > 0 ? Math.round(((twinTotal - localServed) / twinTotal) * 100) : null

    const parts: string[] = [
      `Ollama: ${uptimePct}% uptime`,
      `${successes}/${total} calls served locally`,
    ]
    if (fallbackPct !== null) parts.push(`${fallbackPct}% fell back to Claude`)
    if (p95 !== null) parts.push(`p95 ${p95}ms`)

    return parts.join(' | ')
  } catch {
    return 'Ollama: stats unavailable'
  }
}

// agent_events.status CHECK constraint mapping for digest rows (spec_v1)
function toColumnStatus(digestStatus: DigestStatus): 'success' | 'warning' | 'error' {
  if (digestStatus === 'sent') return 'success'
  if (digestStatus === 'no_tick_found') return 'warning'
  return 'error' // 'telegram_failed'
}

async function writeDigestEvent(result: DigestResult): Promise<void> {
  // Score — never throws to caller; fallback signals scoring failure in dashboard
  let qualityScore: QualityScore | Record<string, unknown>
  try {
    const scoringClient = createServiceClient()
    const history = await fetchHistoricalContext(
      scoringClient,
      'morning_digest',
      CURRENT_CAPACITY_TIER
    )
    qualityScore = scoreMorningDigest(result, history)
  } catch {
    qualityScore = {
      aggregate: null,
      capacity_tier: CURRENT_CAPACITY_TIER,
      dimensions: null,
      weights_version: 'v1',
      scored_at: new Date().toISOString(),
      scored_by: 'rule_based_v1_fallback',
    }
  }

  try {
    const supabase = createServiceClient()
    await supabase.from('agent_events').insert({
      domain: 'orchestrator',
      action: 'morning_digest',
      actor: 'night_watchman',
      status: toColumnStatus(result.status),
      output_summary: `Morning digest status: ${result.status}`,
      duration_ms: result.telegram_latency_ms ?? undefined,
      tags: ['morning_digest', 'step6'],
      task_type: 'morning_digest',
      quality_score: qualityScore,
      meta: {
        digest_status: result.status,
        mapped_from: 'spec_v1',
      },
    })
  } catch {
    // Non-critical
  }
}

export async function sendMorningDigest(): Promise<DigestStatus> {
  const supabase = createServiceClient()
  const cutoff = new Date(Date.now() - 12 * 3_600_000).toISOString()
  const composed_at = new Date().toISOString()

  const { data } = await supabase
    .from('agent_events')
    .select('output_summary, meta')
    .eq('action', 'night_tick')
    .gte('occurred_at', cutoff)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .single()

  let messageToSend: string
  let digestStatus: DigestStatus
  let foundTick = false
  let characterCount = 0
  let sourceFlagCount = 0

  if (!data?.output_summary) {
    messageToSend = '⚠️ No night tick found for last night'
    digestStatus = 'no_tick_found'
  } else {
    try {
      const tick = JSON.parse(data.output_summary) as TickResult
      messageToSend = composeMorningDigest(tick)
      digestStatus = 'sent'
      foundTick = true
      characterCount = messageToSend.length
      sourceFlagCount = tick.checks.reduce((s, c) => s + c.flags.length, 0)
    } catch {
      messageToSend = '⚠️ No night tick found for last night'
      digestStatus = 'no_tick_found'
    }
  }

  // ── Stall summary line — T3 + T4 tasks, omitted if count = 0 ────────────────
  // Not deduped — always reflects current state (see stall-alert acceptance doc).
  try {
    const stall = await getDigestStallSummary()
    if (stall.count > 0) {
      const stallLine = `⚠️ ${stall.count} stalled — ${stall.descriptions.join(', ')}`
      // Insert near the top: right after the first line (date header + blank line)
      const lines = messageToSend.split('\n')
      // Insert after line index 1 (blank line after header)
      lines.splice(2, 0, stallLine)
      messageToSend = lines.join('\n')
    }
  } catch {
    // Non-fatal — digest still sends without stall summary
  }

  // ── F18: Append Ollama stats line — always added, never breaks digest ────────
  const ollamaStatsLine = await buildOllamaStatsLine()
  messageToSend = `${messageToSend}\n${ollamaStatsLine}`

  // ── F18: Append branch guard line — always added, never breaks digest ────────
  const branchGuardLine = await buildBranchGuardLine()
  messageToSend = `${messageToSend}\n${branchGuardLine}`

  // ── F18: Append FTS fallback line — always added, never breaks digest ─────────
  const ftsFallbackLine = await buildFtsFallbackLine()
  messageToSend = `${messageToSend}\n${ftsFallbackLine}`

  // ── 20% Better: Append process efficiency section ─────────────────────────────
  const processEfficiencyLines = await buildProcessEfficiencyLines()
  messageToSend = `${messageToSend}\n${processEfficiencyLines}`

  // ── F18: Routines quota cliff signal ─────────────────────────────────────────
  const quotaCliffLine = await buildQuotaCliffLine()
  messageToSend = `${messageToSend}\n${quotaCliffLine}`

  // ── Quota guard: pickup skips due to 429 backoff (prevention layer) ───────────
  const quotaGuardLine = await buildQuotaGuardLine()
  messageToSend = `${messageToSend}\n${quotaGuardLine}`

  // ── Quota forecast: coordinator startup skips ────────────────────────────────
  const startupForecastLine = await buildStartupForecastLine()
  messageToSend = `${messageToSend}\n${startupForecastLine}`

  // ── Harness rollup — auto-computed from harness_components table ──────────────
  const harnessRollupLine = await buildHarnessRollupLine()
  messageToSend = `${messageToSend}\n${harnessRollupLine}`

  // ── P6+P1: Drain stats + review timeout lines ─────────────────────────────────
  const drainStatsLine = await buildDrainStatsLine()
  messageToSend = `${messageToSend}\n${drainStatsLine}`
  const reviewTimeoutLine = await buildReviewTimeoutLine()
  if (reviewTimeoutLine !== null) {
    messageToSend = `${messageToSend}\n${reviewTimeoutLine}`
  }

  // ── F18: Tax projection sanity-check guard-rails ──────────────────────────
  const taxSanityLine = await buildTaxSanityLine()
  messageToSend = `${messageToSend}\n${taxSanityLine}`

  // ── F18: Amazon orders sync — daily row count vs. baseline ───────────────
  const amazonOrdersSyncLine = await buildAmazonOrdersSyncLine()
  messageToSend = `${messageToSend}\n${amazonOrdersSyncLine}`

  characterCount = messageToSend.length

  // Attempt send — measure Telegram latency, override status on failure
  let telegramLatencyMs: number | null = null
  let sentAt: string | null = null
  try {
    const sendStart = Date.now()
    await postMessage(messageToSend)
    telegramLatencyMs = Date.now() - sendStart
    sentAt = new Date().toISOString()
  } catch (err) {
    if (err instanceof MissingTelegramConfigError || err instanceof Error) {
      digestStatus = 'telegram_failed'
    }
  }

  const digestResult: DigestResult = {
    status: digestStatus,
    composed_at,
    sent_at: sentAt,
    found_tick: foundTick,
    character_count: characterCount,
    telegram_latency_ms: telegramLatencyMs,
    source_flag_count: sourceFlagCount,
  }

  await writeDigestEvent(digestResult)
  return digestStatus
}
