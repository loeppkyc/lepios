import { createServiceClient } from '@/lib/supabase/service'

/**
 * F-L10 — Autonomy rollup for morning_digest.
 *
 * Computes the share of completed task_queue rows that ran without Colin's
 * keystroke over the last 7 days. The "actor" mapping uses the existing
 * `source` column (migration 0015 enum: manual, handoff-file, colin-telegram, cron):
 *   - autonomous: 'handoff-file' | 'cron'   (claimed by harness, no Colin)
 *   - human:      'manual' | 'colin-telegram' (Colin originated)
 *
 * 7-day window: 24h is too noisy on quiet days; 7d matches CLAUDE.md §9
 * reflection cadence and is what Colin asks for in W1 audits.
 *
 * Same try/catch fallback shape as buildProcessEfficiencyLines — a query
 * failure must never break the digest cron.
 */

const AUTONOMOUS_SOURCES = new Set(['handoff-file', 'cron'])
const SEVEN_DAYS_MS = 7 * 86_400_000

export async function buildAutonomyRollupLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString()

    const { data } = await db
      .from('task_queue')
      .select('source')
      .eq('status', 'completed')
      .gte('completed_at', since)
      .limit(500)

    const total = data?.length ?? 0
    if (total === 0) {
      return 'Autonomy (7d): no tasks completed'
    }

    const autonomous = (data ?? []).filter((r) =>
      AUTONOMOUS_SOURCES.has(r.source as string)
    ).length
    const pct = Math.round((autonomous / total) * 100)
    const icon = pct >= 60 ? '✅' : pct >= 30 ? '⚠️' : '❌'
    const suggestion =
      pct < 30
        ? ' | 💡 Most completions Colin-initiated — review pickup cron + pre-staged tasks'
        : ''

    return `Autonomy (7d): ${pct}% (${autonomous} autonomous / ${total} total) ${icon}${suggestion}`
  } catch {
    return 'Autonomy: stats unavailable'
  }
}
