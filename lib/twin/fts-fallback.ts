import { createServiceClient } from '@/lib/supabase/service'

// F18: never throws — returns "status unavailable" on any error.
export async function buildFtsFallbackLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const { data, error } = await db
      .from('agent_events')
      .select('meta')
      .eq('action', 'twin.ask')
      .gte('occurred_at', since)
      .limit(500)

    if (error || !data) return 'Twin FTS fallback: status unavailable'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ftsCount = (data as any[]).filter((r) => r.meta?.retrieval_path === 'fts').length
    if (ftsCount === 0) return 'Twin FTS fallback (24h): 0 ✅'
    return `Twin FTS fallback (24h): ${ftsCount}`
  } catch {
    return 'Twin FTS fallback: status unavailable'
  }
}
