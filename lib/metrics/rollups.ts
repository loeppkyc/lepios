/**
 * LepiOS Metrics Rollups — aggregate queries over agent_events + knowledge tables.
 *
 * All functions use createServiceClient() (service role, bypasses RLS).
 * Supabase JS does not expose GROUP BY, so grouping is done client-side.
 * Acceptable for a single-user system with <10k events in the rolling window.
 *
 * SPRINT5-GATE: Replace client-side aggregation with Postgres views or RPCs
 * once event volume makes JS grouping slow.
 */

import { createServiceClient } from '@/lib/supabase/service'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DailySuccessRate {
  day: string     // YYYY-MM-DD
  total: number
  successes: number
  rate: number    // 0–100
}

export interface DailyFlagCount {
  day: string
  critical: number
  high: number
  medium: number
  low: number
  total: number
}

export interface ErrorTypeSummary {
  error_type: string
  count: number
  example_message: string | null
}

export interface KnowledgeHealth {
  total: number
  avgConfidence: number
  usedLast7Days: number
  decayedCount: number  // confidence < 0.2
  byCategory: Record<string, number>
}

export interface AutonomousSummary {
  successRate: number         // 0–100
  totalEvents: number
  errorRate: number           // 0–100
  avgDurationMs: number | null
  totalTokensUsed: number
  safetyFlagsTotal: number    // total checks fired across all safety runs
  blockingSafetyRuns: number  // safety runs where blocking=true
  knowledgeAvgConfidence: number
  period: { days: number; from: string; to: string }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cutoffISO(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function dayKey(iso: string): string {
  return iso.slice(0, 10)
}

// ── 1. getDailySuccessRate ────────────────────────────────────────────────────

/**
 * Success rate per day for the last N days.
 * success = status='success'; failure = 'failure' | 'error'.
 * 'warning' events count toward total but not toward failures.
 */
export async function getDailySuccessRate(days: number): Promise<DailySuccessRate[]> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('agent_events')
      .select('occurred_at, status')
      .gte('occurred_at', cutoffISO(days))

    if (error || !data) return []

    const byDay = new Map<string, { total: number; successes: number }>()
    for (const row of data) {
      const day = dayKey(row.occurred_at)
      const existing = byDay.get(day) ?? { total: 0, successes: 0 }
      existing.total++
      if (row.status === 'success') existing.successes++
      byDay.set(day, existing)
    }

    return Array.from(byDay.entries())
      .map(([day, c]) => ({
        day,
        total: c.total,
        successes: c.successes,
        rate: c.total > 0 ? Math.round((c.successes / c.total) * 100) : 0,
      }))
      .sort((a, b) => a.day.localeCompare(b.day))
  } catch {
    return []
  }
}

// ── 2. getSafetyFlagTrend ─────────────────────────────────────────────────────

/**
 * Per-day count of safety checks fired, broken down by severity.
 * Severity counts extracted from agent_events.meta.severity_breakdown.
 */
export async function getSafetyFlagTrend(days: number): Promise<DailyFlagCount[]> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('agent_events')
      .select('occurred_at, meta')
      .eq('domain', 'safety')
      .eq('action', 'safety.check')
      .gte('occurred_at', cutoffISO(days))

    if (error || !data) return []

    const byDay = new Map<string, { critical: number; high: number; medium: number; low: number }>()
    for (const row of data) {
      const day = dayKey(row.occurred_at)
      const existing = byDay.get(day) ?? { critical: 0, high: 0, medium: 0, low: 0 }
      const breakdown = (row.meta as Record<string, unknown> | null)?.severity_breakdown as
        Record<string, number> | undefined ?? {}
      existing.critical += breakdown.critical ?? 0
      existing.high += breakdown.high ?? 0
      existing.medium += breakdown.medium ?? 0
      existing.low += breakdown.low ?? 0
      byDay.set(day, existing)
    }

    return Array.from(byDay.entries())
      .map(([day, c]) => ({
        day, ...c,
        total: c.critical + c.high + c.medium + c.low,
      }))
      .sort((a, b) => a.day.localeCompare(b.day))
  } catch {
    return []
  }
}

// ── 3. getTopErrorTypes ───────────────────────────────────────────────────────

/**
 * Most frequent error_type values in the last N days, with an example message.
 */
export async function getTopErrorTypes(
  days: number,
  limit: number = 5,
): Promise<ErrorTypeSummary[]> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('agent_events')
      .select('error_type, error_message')
      .not('error_type', 'is', null)
      .gte('occurred_at', cutoffISO(days))

    if (error || !data) return []

    const byType = new Map<string, { count: number; example: string | null }>()
    for (const row of data) {
      if (!row.error_type) continue
      const existing = byType.get(row.error_type) ?? { count: 0, example: null }
      existing.count++
      if (!existing.example && row.error_message) existing.example = row.error_message
      byType.set(row.error_type, existing)
    }

    return Array.from(byType.entries())
      .map(([error_type, { count, example }]) => ({
        error_type,
        count,
        example_message: example,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
  } catch {
    return []
  }
}

// ── 4. getKnowledgeHealth ─────────────────────────────────────────────────────

/**
 * Overview of the knowledge base: size, confidence distribution, recency.
 */
export async function getKnowledgeHealth(): Promise<KnowledgeHealth> {
  const empty: KnowledgeHealth = { total: 0, avgConfidence: 0, usedLast7Days: 0, decayedCount: 0, byCategory: {} }
  try {
    const supabase = createServiceClient()
    const week = cutoffISO(7)

    const { data, error } = await supabase
      .from('knowledge')
      .select('category, confidence, last_used_at')

    if (error || !data) return empty

    const byCategory: Record<string, number> = {}
    let confSum = 0
    let usedLast7Days = 0
    let decayedCount = 0

    for (const row of data) {
      byCategory[row.category] = (byCategory[row.category] ?? 0) + 1
      confSum += row.confidence
      if (row.last_used_at && row.last_used_at >= week) usedLast7Days++
      if (row.confidence < 0.2) decayedCount++
    }

    return {
      total: data.length,
      avgConfidence: data.length > 0 ? Math.round((confSum / data.length) * 100) / 100 : 0,
      usedLast7Days,
      decayedCount,
      byCategory,
    }
  } catch {
    return empty
  }
}

// ── 5. getAutonomousRunSummary ────────────────────────────────────────────────

/**
 * Aggregate scorecard for the last N days:
 * success rate, error rate, avg duration, tokens, safety flags, knowledge confidence.
 */
export async function getAutonomousRunSummary(days: number): Promise<AutonomousSummary> {
  const from = cutoffISO(days)
  const to = new Date().toISOString()
  const empty: AutonomousSummary = {
    successRate: 0, totalEvents: 0, errorRate: 0, avgDurationMs: null,
    totalTokensUsed: 0, safetyFlagsTotal: 0, blockingSafetyRuns: 0,
    knowledgeAvgConfidence: 0,
    period: { days, from, to },
  }

  try {
    const supabase = createServiceClient()
    const [{ data: events, error: evErr }, health] = await Promise.all([
      supabase
        .from('agent_events')
        .select('status, duration_ms, tokens_used, domain, action, meta')
        .gte('occurred_at', from),
      getKnowledgeHealth(),
    ])

    if (evErr || !events) return empty

    const total = events.length
    const successes = events.filter((e) => e.status === 'success').length
    const failures = events.filter((e) => e.status === 'failure' || e.status === 'error').length

    const durations = events
      .map((e) => e.duration_ms as number | null)
      .filter((d): d is number => d != null)
    const avgDurationMs = durations.length > 0
      ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
      : null

    const totalTokensUsed = events.reduce((s, e) => s + ((e.tokens_used as number | null) ?? 0), 0)

    const safetyEvents = events.filter(
      (e) => e.domain === 'safety' && e.action === 'safety.check',
    )
    const safetyFlagsTotal = safetyEvents.reduce((s, e) => {
      const m = e.meta as Record<string, unknown> | null
      return s + ((m?.check_count as number | undefined) ?? 0)
    }, 0)
    const blockingSafetyRuns = safetyEvents.filter((e) => {
      const m = e.meta as Record<string, unknown> | null
      return m?.blocking === true
    }).length

    return {
      successRate: total > 0 ? Math.round((successes / total) * 100) : 0,
      totalEvents: total,
      errorRate: total > 0 ? Math.round((failures / total) * 100) : 0,
      avgDurationMs,
      totalTokensUsed,
      safetyFlagsTotal,
      blockingSafetyRuns,
      knowledgeAvgConfidence: health.avgConfidence,
      period: { days, from, to },
    }
  } catch {
    return empty
  }
}
