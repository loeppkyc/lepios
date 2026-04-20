import crypto from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { checkSiteHealth } from './checks/site-health'
import { checkScanIntegrity } from './checks/scan-integrity'
import { checkEventLogConsistency } from './checks/event-log-consistency'
import type { CheckResult, TickResult, TickStatus } from './types'

const CHECK_TIMEOUT_MS = 15_000

async function safeCheck(name: string, fn: () => Promise<CheckResult>): Promise<CheckResult> {
  const start = Date.now()
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`check '${name}' timed out after ${CHECK_TIMEOUT_MS}ms`)),
          CHECK_TIMEOUT_MS
        )
      ),
    ])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      name,
      status: 'fail',
      flags: [{ severity: 'critical', message: msg, entity_type: 'check' }],
      counts: {},
      duration_ms: Date.now() - start,
    }
  }
}

function deriveTickStatus(checks: CheckResult[]): TickStatus {
  if (checks.every((c) => c.status === 'fail')) return 'failed'
  if (checks.some((c) => c.status === 'fail' || c.status === 'warn')) return 'partial_failure'
  return 'completed'
}

// agent_events.status CHECK constraint only allows 'success'|'error'|'warning'.
// Fine-grained tick_status is preserved in meta.tick_status (spec_v1 mapping).
function toColumnStatus(tickStatus: TickStatus): 'success' | 'warning' | 'error' {
  if (tickStatus === 'completed') return 'success'
  if (tickStatus === 'partial_failure') return 'warning'
  return 'error' // 'failed'
}

export async function runNightTick(): Promise<TickResult> {
  const tick_id = crypto.randomUUID()
  const run_id = crypto.randomUUID()
  const started_at = new Date().toISOString()
  const tickStart = Date.now()

  const checks: CheckResult[] = []
  checks.push(await safeCheck('site_health', checkSiteHealth))
  checks.push(await safeCheck('scan_integrity', checkScanIntegrity))
  checks.push(await safeCheck('event_log_consistency', checkEventLogConsistency))

  const finished_at = new Date().toISOString()
  const duration_ms = Date.now() - tickStart
  const tickStatus = deriveTickStatus(checks)

  const result: TickResult = {
    tick_id,
    run_id,
    mode: 'overnight_readonly',
    checks,
    duration_ms,
    started_at,
    finished_at,
    status: tickStatus,
  }

  // Write exactly one agent_events row — never throws to caller
  try {
    const supabase = createServiceClient()
    await supabase.from('agent_events').insert({
      domain: 'orchestrator',
      action: 'night_tick',
      actor: 'night_watchman',
      status: toColumnStatus(tickStatus),
      output_summary: JSON.stringify(result),
      duration_ms,
      tags: ['night_tick', 'step6', 'read_only'],
      meta: {
        tick_id,
        run_id,
        mode: 'overnight_readonly',
        tick_status: tickStatus,
        mapped_from: 'spec_v1',
      },
    })
  } catch {
    // Swallow insert errors — result is still returned to caller
  }

  return result
}
