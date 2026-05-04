import crypto from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { checkSiteHealth } from './checks/site-health'
import { checkOllamaHealth } from './checks/ollama-health-check'
import { checkSignalReview } from './checks/signal-review'
import { fetchHistoricalContext, scoreDaytimeTick } from './scoring'
import { CURRENT_CAPACITY_TIER } from './config'
import type { CheckResult, DaytimeTickResult, TickStatus, QualityScore } from './types'

const SIGNAL_REVIEW_TIMEOUT_MS = 50_000
const DEFAULT_CHECK_TIMEOUT_MS = 15_000

async function safeCheck(
  name: string,
  fn: () => Promise<CheckResult>,
  timeoutMs = DEFAULT_CHECK_TIMEOUT_MS
): Promise<CheckResult> {
  const start = Date.now()
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`check '${name}' timed out after ${timeoutMs}ms`)),
          timeoutMs
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

function toColumnStatus(tickStatus: TickStatus): 'success' | 'warning' | 'error' {
  if (tickStatus === 'completed') return 'success'
  if (tickStatus === 'partial_failure') return 'warning'
  return 'error'
}

function getTunnelUsed(): boolean {
  const url = process.env.OLLAMA_TUNNEL_URL ?? ''
  return url.length > 0 && !url.includes('localhost')
}

export async function runDaytimeTick(): Promise<DaytimeTickResult> {
  const tick_id = crypto.randomUUID()
  const run_id = crypto.randomUUID()
  const started_at = new Date().toISOString()
  const tickStart = Date.now()
  const tunnel_used = getTunnelUsed()

  const checks: CheckResult[] = []
  checks.push(await safeCheck('ollama_health', checkOllamaHealth))
  checks.push(await safeCheck('signal_review', checkSignalReview, SIGNAL_REVIEW_TIMEOUT_MS))
  checks.push(await safeCheck('site_health', checkSiteHealth))

  const finished_at = new Date().toISOString()
  const duration_ms = Date.now() - tickStart
  const tickStatus = deriveTickStatus(checks)

  const result: DaytimeTickResult = {
    tick_id,
    run_id,
    mode: 'daytime_ollama',
    checks,
    duration_ms,
    started_at,
    finished_at,
    status: tickStatus,
    tunnel_used,
  }

  // Score — never throws to caller
  let qualityScore: QualityScore | Record<string, unknown>
  try {
    const scoringClient = createServiceClient()
    const history = await fetchHistoricalContext(
      scoringClient,
      'daytime_tick',
      CURRENT_CAPACITY_TIER
    )
    qualityScore = scoreDaytimeTick(result, history)
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

  // Write exactly one agent_events row — never throws to caller
  try {
    const supabase = createServiceClient()
    await supabase.from('agent_events').insert({
      domain: 'orchestrator',
      action: 'daytime_tick',
      actor: 'daytime_watchman',
      status: toColumnStatus(tickStatus),
      output_summary: JSON.stringify(result),
      duration_ms,
      tags: ['daytime_tick', 'step6.5', 'ollama', 'read_only'],
      task_type: 'daytime_tick',
      quality_score: qualityScore,
      meta: {
        tick_id,
        run_id,
        mode: 'daytime_ollama',
        tick_status: tickStatus,
        mapped_from: 'spec_v1',
        tunnel_used,
      },
    })
  } catch {
    // Swallow insert errors — result is still returned to caller
  }

  return result
}
