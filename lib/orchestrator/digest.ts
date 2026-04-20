import { createServiceClient } from '@/lib/supabase/service'
import { postMessage, MissingTelegramConfigError } from './telegram'
import type { DigestStatus, TickResult } from './types'

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

async function writeDigestEvent(digestStatus: DigestStatus): Promise<void> {
  try {
    const supabase = createServiceClient()
    await supabase.from('agent_events').insert({
      domain: 'orchestrator',
      action: 'morning_digest',
      actor: 'night_watchman',
      status: toColumnStatus(digestStatus),
      output_summary: `Morning digest status: ${digestStatus}`,
      tags: ['morning_digest', 'step6'],
      meta: {
        digest_status: digestStatus,
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

  const { data } = await supabase
    .from('agent_events')
    .select('output_summary, meta')
    .eq('action', 'night_tick')
    .gte('occurred_at', cutoff)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .single()

  // Determine what to send
  let messageToSend: string
  let digestStatus: DigestStatus

  if (!data?.output_summary) {
    messageToSend = '⚠️ No night tick found for last night'
    digestStatus = 'no_tick_found'
  } else {
    try {
      const tick = JSON.parse(data.output_summary) as TickResult
      messageToSend = composeMorningDigest(tick)
      digestStatus = 'sent'
    } catch {
      messageToSend = '⚠️ No night tick found for last night'
      digestStatus = 'no_tick_found'
    }
  }

  // Attempt send — override status on Telegram failure
  try {
    await postMessage(messageToSend)
  } catch (err) {
    if (err instanceof MissingTelegramConfigError || err instanceof Error) {
      digestStatus = 'telegram_failed'
    }
  }

  await writeDigestEvent(digestStatus)
  return digestStatus
}
