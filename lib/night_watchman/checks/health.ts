// Health checks — /api/health, DB ping, cron freshness, stuck task_queue, quota burn.
// All wireable today (no external API tokens needed).

import { createServiceClient } from '@/lib/supabase/service'
import { forecastQuotaBeforeStart } from '@/lib/harness/quota-forecast'
import { registerCheck } from '../registry'
import type { CheckResult } from '../types'

const PROD_URL = 'https://lepios-one.vercel.app'

// ─── health.api ───────────────────────────────────────────────────────────────
registerCheck({
  key: 'health.api',
  category: 'health',
  defaultSeverity: 'high',
  label: '/api/health responds 200',
  async run(): Promise<CheckResult> {
    try {
      const res = await fetch(`${PROD_URL}/api/health`, { cache: 'no-store' })
      const body = await res.json().catch(() => null as unknown)
      if (res.status !== 200) {
        return {
          key: 'health.api',
          category: 'health',
          status: 'fail',
          severity: 'high',
          evidence: { http_status: res.status },
        }
      }
      return {
        key: 'health.api',
        category: 'health',
        status: 'ok',
        evidence: { http_status: 200, body },
      }
    } catch (err) {
      return {
        key: 'health.api',
        category: 'health',
        status: 'fail',
        severity: 'critical',
        evidence: { error: err instanceof Error ? err.message : String(err) },
      }
    }
  },
})

// ─── health.db_ping ───────────────────────────────────────────────────────────
registerCheck({
  key: 'health.db_ping',
  category: 'health',
  defaultSeverity: 'critical',
  label: 'Supabase Postgres responds to SELECT 1',
  async run(): Promise<CheckResult> {
    try {
      const db = createServiceClient()
      const t0 = Date.now()
      const { error } = await db.from('harness_config').select('key').limit(1)
      const elapsed = Date.now() - t0
      if (error) {
        return {
          key: 'health.db_ping',
          category: 'health',
          status: 'fail',
          severity: 'critical',
          evidence: { error: error.message, elapsed_ms: elapsed },
        }
      }
      return {
        key: 'health.db_ping',
        category: 'health',
        status: elapsed > 1000 ? 'warn' : 'ok',
        severity: elapsed > 1000 ? 'medium' : undefined,
        evidence: { elapsed_ms: elapsed },
      }
    } catch (err) {
      return {
        key: 'health.db_ping',
        category: 'health',
        status: 'fail',
        severity: 'critical',
        evidence: { error: err instanceof Error ? err.message : String(err) },
      }
    }
  },
})

// ─── health.cron_freshness ────────────────────────────────────────────────────
// For each known cron, find the most-recent agent_events row and compare against
// expected cadence. Stale = warn or fail depending on how far past expected.
const KNOWN_CRONS: Array<{ actor: string; max_age_h: number }> = [
  { actor: 'night_tick', max_age_h: 26 },
  { actor: 'morning_digest', max_age_h: 26 },
  { actor: 'task_pickup', max_age_h: 26 },
  { actor: 'amazon_orders_sync', max_age_h: 26 },
  { actor: 'amazon_settlements_sync', max_age_h: 26 },
  { actor: 'oura_sync', max_age_h: 26 },
  { actor: 'gmail_scan', max_age_h: 26 },
]

registerCheck({
  key: 'health.cron_freshness',
  category: 'health',
  defaultSeverity: 'medium',
  label: 'All known crons have run within their expected window',
  async run(): Promise<CheckResult> {
    const db = createServiceClient()
    const stale: Array<{
      actor: string
      last_seen: string | null
      max_age_h: number
      age_h: number
    }> = []
    for (const cron of KNOWN_CRONS) {
      const { data } = await db
        .from('agent_events')
        .select('occurred_at')
        .eq('actor', cron.actor)
        .order('occurred_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ occurred_at: string }>()
      const lastSeen = data?.occurred_at ?? null
      const ageH = lastSeen ? (Date.now() - Date.parse(lastSeen)) / (60 * 60 * 1000) : Infinity
      if (ageH > cron.max_age_h) {
        stale.push({
          actor: cron.actor,
          last_seen: lastSeen,
          max_age_h: cron.max_age_h,
          age_h: ageH,
        })
      }
    }
    if (stale.length === 0) {
      return {
        key: 'health.cron_freshness',
        category: 'health',
        status: 'ok',
        evidence: { checked: KNOWN_CRONS.length },
      }
    }
    return {
      key: 'health.cron_freshness',
      category: 'health',
      status: 'fail',
      severity: stale.some((s) => !Number.isFinite(s.age_h)) ? 'high' : 'medium',
      evidence: { stale, checked: KNOWN_CRONS.length },
    }
  },
})

// ─── health.task_queue_stuck ──────────────────────────────────────────────────
// task_queue rows that claimed but never completed and exceeded their TTL.
// reclaimStale handles this on every pickup; we surface as a check so the
// failure pattern shows up in /self-repair even when reclaim is busy retrying.
registerCheck({
  key: 'health.task_queue_stuck',
  category: 'health',
  defaultSeverity: 'medium',
  label: 'No task_queue rows stuck in claimed state past TTL',
  async run(): Promise<CheckResult> {
    const db = createServiceClient()
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { data, error } = await db
      .from('task_queue')
      .select('id, status, claimed_at, retry_count')
      .eq('status', 'in_progress')
      .lt('claimed_at', cutoff)
    if (error) {
      return {
        key: 'health.task_queue_stuck',
        category: 'health',
        status: 'warn',
        severity: 'low',
        evidence: { error: error.message },
      }
    }
    const stuck = (data ?? []) as Array<{ id: string; claimed_at: string; retry_count: number }>
    if (stuck.length === 0) {
      return {
        key: 'health.task_queue_stuck',
        category: 'health',
        status: 'ok',
        evidence: { stuck_count: 0 },
      }
    }
    return {
      key: 'health.task_queue_stuck',
      category: 'health',
      status: 'fail',
      severity: stuck.length > 3 ? 'high' : 'medium',
      evidence: { stuck_count: stuck.length, stuck_ids: stuck.map((s) => s.id) },
    }
  },
  // Repair path: clear claim, requeue (provided by safe-list).
})

// ─── health.quota_burn ────────────────────────────────────────────────────────
// Reads the real QuotaForecastResult shape:
//   safe_to_start, reason, invocations_24h, cliff_threshold,
//   estimated_remaining, recommended_wait_minutes
// Fail when forecast says don't start (active 429 backoff or cliff risk).
// Warn when estimated_remaining drops to single digits — tight runway but
// no active backoff yet.
registerCheck({
  key: 'health.quota_burn',
  category: 'health',
  defaultSeverity: 'medium',
  label: 'Quota forecast within budget envelope',
  async run(): Promise<CheckResult> {
    try {
      const forecast = await forecastQuotaBeforeStart()
      if (!forecast.safe_to_start) {
        const isCliff = forecast.reason === 'burn_rate_cliff_risk'
        return {
          key: 'health.quota_burn',
          category: 'health',
          status: 'fail',
          severity: isCliff ? 'high' : 'medium',
          evidence: { forecast },
        }
      }
      // Tight runway: <10 calls left in the 24h window but not yet at cliff.
      if (forecast.estimated_remaining >= 0 && forecast.estimated_remaining < 10) {
        return {
          key: 'health.quota_burn',
          category: 'health',
          status: 'warn',
          severity: 'medium',
          evidence: { forecast },
        }
      }
      return {
        key: 'health.quota_burn',
        category: 'health',
        status: 'ok',
        evidence: { forecast },
      }
    } catch (err) {
      return {
        key: 'health.quota_burn',
        category: 'health',
        status: 'skipped',
        evidence: {
          reason: 'forecastQuotaBeforeStart threw',
          error: err instanceof Error ? err.message : String(err),
        },
      }
    }
  },
})
