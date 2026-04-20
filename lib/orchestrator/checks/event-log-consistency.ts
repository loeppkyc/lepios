import { createServiceClient } from '@/lib/supabase/service'
import {
  KNOWN_EVENT_DOMAINS,
  STUCK_PROCESSING_THRESHOLD_MS,
  SLOW_EVENT_THRESHOLD_MS,
  getYesterdayRangeMT,
} from '../config'
import type { CheckResult, Flag } from '../types'

const KNOWN_DOMAINS_SET = new Set<string>(KNOWN_EVENT_DOMAINS)

export async function checkEventLogConsistency(): Promise<CheckResult> {
  const start = Date.now()
  const flags: Flag[] = []
  const counts: Record<string, number> = {
    total: 0,
    stuck_processing: 0,
    slow_events: 0,
    unknown_domain: 0,
  }

  try {
    const supabase = createServiceClient()
    const { start: rangeStart, end: rangeEnd } = getYesterdayRangeMT()

    const { data, error } = await supabase
      .from('agent_events')
      .select('id, domain, status, duration_ms, occurred_at')
      .gte('occurred_at', rangeStart)
      .lt('occurred_at', rangeEnd)

    if (error || !data) {
      flags.push({
        severity: 'critical',
        message: `agent_events query failed: ${error?.message ?? 'no data'}`,
        entity_type: 'table',
      })
      return {
        name: 'event_log_consistency',
        status: 'fail',
        flags,
        counts,
        duration_ms: Date.now() - start,
      }
    }

    counts.total = data.length
    const now = Date.now()

    for (const row of data) {
      if (row.status === 'processing') {
        const age = now - new Date(row.occurred_at).getTime()
        if (age > STUCK_PROCESSING_THRESHOLD_MS) {
          counts.stuck_processing++
          flags.push({
            severity: 'warn',
            message: `event stuck in 'processing' for ${Math.round(age / 60_000)}m`,
            entity_id: row.id,
            entity_type: 'agent_event',
          })
        }
      }

      if (row.duration_ms !== null && row.duration_ms > SLOW_EVENT_THRESHOLD_MS) {
        counts.slow_events++
        flags.push({
          severity: 'warn',
          message: `slow event: ${row.duration_ms}ms (domain: ${row.domain})`,
          entity_id: row.id,
          entity_type: 'agent_event',
        })
      }

      if (!KNOWN_DOMAINS_SET.has(row.domain)) {
        counts.unknown_domain++
        flags.push({
          severity: 'warn',
          message: `unknown domain: '${row.domain}'`,
          entity_id: row.id,
          entity_type: 'agent_event',
        })
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    flags.push({
      severity: 'critical',
      message: `checkEventLogConsistency threw: ${msg}`,
      entity_type: 'check',
    })
    return {
      name: 'event_log_consistency',
      status: 'fail',
      flags,
      counts,
      duration_ms: Date.now() - start,
    }
  }

  const hasCritical = flags.some((f) => f.severity === 'critical')
  const hasFlags = flags.length > 0
  return {
    name: 'event_log_consistency',
    status: hasCritical ? 'fail' : hasFlags ? 'warn' : 'pass',
    flags,
    counts,
    duration_ms: Date.now() - start,
  }
}
