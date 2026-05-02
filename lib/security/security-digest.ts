import { createServiceClient } from '@/lib/supabase/service'

// F18: Security layer observability — morning_digest summary line.
// Queries agent_actions for last 24h: total count + denied count + top denied caps.
// Never throws — returns "Security: stats unavailable" on any error.

export async function buildSecurityDigestLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()

    const [totalResult, deniedResult] = await Promise.all([
      db
        .from('agent_actions')
        .select('capability', { count: 'exact', head: true })
        .gte('occurred_at', since),
      db
        .from('agent_actions')
        .select('capability')
        .eq('result', 'denied')
        .gte('occurred_at', since)
        .limit(20),
    ])

    if (totalResult.error) return 'Security: stats unavailable'

    const total = totalResult.count ?? 0
    const deniedRows = deniedResult.data ?? []
    const deniedCount = deniedRows.length

    if (deniedCount === 0) {
      return `Security (24h): ${total} actions, 0 denied ✅`
    }

    const topCaps = [...new Set(deniedRows.map((r) => r.capability as string))].slice(0, 3)
    const capList = topCaps.join(', ')
    return `Security (24h): ${total} actions, ${deniedCount} denied 🚨 — [${capList}]`
  } catch {
    return 'Security: stats unavailable'
  }
}
