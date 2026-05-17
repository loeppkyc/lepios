/**
 * Morning digest line for the Edmonton Free Events module.
 *
 * Reads the most recent events_fetched event from agent_events and returns
 * a single Telegram line: "X free Edmonton events in the next 14 days"
 *
 * Usage in lib/orchestrator/digest.ts:
 *   import { buildEventsLine } from '@/lib/edmonton-open-data/digest'
 *   // Add to the digest composition function
 *
 * NOTE: The import in digest.ts must be added in a separate window that has
 * CockpitSidebar.tsx / digest.ts in scope. This helper is pre-built here
 * so that window only needs to add one import + one line.
 */

import { createServiceClient } from '@/lib/supabase/service'

/**
 * Build one Telegram message line summarising free Edmonton events.
 * Never throws — on any error returns a safe fallback string.
 */
export async function buildEventsLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString() // last 6h

    const { data } = await db
      .from('agent_events')
      .select('meta')
      .eq('action', 'events_fetched')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .single()

    if (!data?.meta) {
      return 'Events: no recent fetch data'
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = data.meta as Record<string, any>
    const total = Number(meta.total_count ?? 0)

    if (total === 0) {
      return 'Events: no upcoming free Edmonton events found'
    }

    return `Events: ${total} free Edmonton event${total !== 1 ? 's' : ''} in the next 14 days`
  } catch {
    return 'Events: stats unavailable'
  }
}
