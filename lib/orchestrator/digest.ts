import { createServiceClient } from '@/lib/supabase/service'
import { postMessage, MissingTelegramConfigError } from './telegram'
import { fetchHistoricalContext, scoreMorningDigest } from './scoring'
import { CURRENT_CAPACITY_TIER } from './config'
import type { DigestResult, DigestStatus, QualityScore, TickResult } from './types'

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
