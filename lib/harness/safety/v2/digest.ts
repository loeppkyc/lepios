/**
 * lib/harness/safety/v2/digest.ts
 *
 * F18 morning-digest line for Safety Agent v2.
 * Counts decisions in the last 24h by routing action.
 *
 * Format: "Safety: 4 auto | 1 twin-cleared | 0 escalated | 0 E2E fail"
 */

import { createServiceClient } from '@/lib/supabase/service'

export async function buildSafetyAgentDigestLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()

    const { data, error } = await db
      .from('safety_decisions')
      .select('action, e2e_pass')
      .gte('decided_at', since)

    if (error || !data || data.length === 0) {
      return 'Safety agent: no decisions in last 24h'
    }

    const rows = data as Array<{ action: string; e2e_pass: boolean | null }>

    const auto = rows.filter((r) => r.action === 'auto_merge').length
    const twinCleared = rows.filter(
      (r) => r.action === 'twin_proceed' || r.action === 'twin_unavailable'
    ).length
    const escalated = rows.filter(
      (r) =>
        r.action === 'colin_escalate' || r.action === 'twin_hold' || r.action === 'twin_escalate'
    ).length
    const e2eFailed = rows.filter((r) => r.e2e_pass === false).length

    return `Safety: ${auto} auto | ${twinCleared} twin-cleared | ${escalated} escalated | ${e2eFailed} E2E fail`
  } catch {
    return 'Safety: stats unavailable'
  }
}
