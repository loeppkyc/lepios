import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export type TokenStatsPeriod = {
  label: string
  claude_tokens: number
  claude_cost_usd: number
  ollama_tokens: number
  ollama_saved_usd: number
}

export type TokenDayPoint = {
  date: string // YYYY-MM-DD
  claude_tokens: number
  ollama_tokens: number
}

export type TokenStatsResponse = {
  this_week: TokenStatsPeriod
  this_month: TokenStatsPeriod
  all_time: TokenStatsPeriod
  by_feature: { domain: string; claude_tokens: number; claude_cost_usd: number }[]
  daily: TokenDayPoint[]
}

async function aggregate(
  supabase: ReturnType<typeof createServiceClient>,
  since: string
): Promise<{
  claude_tokens: number
  claude_cost_usd: number
  ollama_tokens: number
  ollama_saved_usd: number
}> {
  const { data } = await supabase
    .from('agent_events')
    .select('domain, action, tokens_used, cost_usd, meta')
    .gte('occurred_at', since)
    .not('tokens_used', 'is', null)

  let claude_tokens = 0
  let claude_cost_usd = 0
  let ollama_tokens = 0
  let ollama_saved_usd = 0

  for (const row of data ?? []) {
    if (row.action === 'claude.usage') {
      claude_tokens += row.tokens_used ?? 0
      claude_cost_usd += Number(row.cost_usd ?? 0)
    } else if (row.domain === 'ollama' && row.tokens_used) {
      ollama_tokens += row.tokens_used ?? 0
      const equiv = (row.meta as Record<string, unknown> | null)?.claude_equivalent_usd
      ollama_saved_usd += typeof equiv === 'number' ? equiv : 0
    }
  }

  return { claude_tokens, claude_cost_usd, ollama_tokens, ollama_saved_usd }
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const svc = createServiceClient()
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const epoch = '2024-01-01T00:00:00Z'

  const [week, month, allTime, dailyRows, featureRows] = await Promise.all([
    aggregate(svc, weekAgo),
    aggregate(svc, monthAgo),
    aggregate(svc, epoch),
    svc
      .from('agent_events')
      .select('domain, action, tokens_used, occurred_at')
      .gte('occurred_at', fourteenDaysAgo)
      .not('tokens_used', 'is', null),
    svc
      .from('agent_events')
      .select('domain, tokens_used, cost_usd')
      .eq('action', 'claude.usage')
      .not('tokens_used', 'is', null),
  ])

  // Per-feature Claude breakdown (all time)
  const featureMap: Record<string, { claude_tokens: number; claude_cost_usd: number }> = {}
  for (const row of featureRows.data ?? []) {
    const d = row.domain as string
    if (!featureMap[d]) featureMap[d] = { claude_tokens: 0, claude_cost_usd: 0 }
    featureMap[d].claude_tokens += row.tokens_used ?? 0
    featureMap[d].claude_cost_usd += Number(row.cost_usd ?? 0)
  }
  const by_feature = Object.entries(featureMap)
    .map(([domain, v]) => ({ domain, ...v }))
    .sort((a, b) => b.claude_tokens - a.claude_tokens)

  // Daily buckets — group by date in Edmonton time (UTC-6/7)
  const dailyMap: Record<string, { claude_tokens: number; ollama_tokens: number }> = {}
  for (const row of dailyRows.data ?? []) {
    const date = new Date(row.occurred_at as string).toLocaleDateString('en-CA', {
      timeZone: 'America/Edmonton',
    })
    if (!dailyMap[date]) dailyMap[date] = { claude_tokens: 0, ollama_tokens: 0 }
    if (row.action === 'claude.usage') {
      dailyMap[date].claude_tokens += row.tokens_used ?? 0
    } else if (row.domain === 'ollama') {
      dailyMap[date].ollama_tokens += row.tokens_used ?? 0
    }
  }

  // Fill all 14 days (oldest → newest), zero if no data
  const daily: TokenDayPoint[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
    const date = d.toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' })
    daily.push({ date, ...(dailyMap[date] ?? { claude_tokens: 0, ollama_tokens: 0 }) })
  }

  return NextResponse.json({
    this_week: { label: 'This week', ...week },
    this_month: { label: 'This month', ...month },
    all_time: { label: 'All time', ...allTime },
    by_feature,
    daily,
  } satisfies TokenStatsResponse)
}
