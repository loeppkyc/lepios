// F18: bench=latency_ms<3000; surface=agent_events WHERE action='events_fetched'
// module_metric: open_data_count, eventbrite_count per fetch
//
// Refresh strategy: 6h Next.js ISR revalidation — no cron added (Vercel Hobby 1-cron limit).
// F22 does not apply — this is not a cron-auth route.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchEdmontonOpenDataEvents } from '@/lib/edmonton-open-data/events'
import { fetchEventbriteEvents } from '@/lib/eventbrite/events'
import type { OpenDataEvent } from '@/lib/edmonton-open-data/events'
import type { EventbriteEvent } from '@/lib/eventbrite/events'

export const revalidate = 21600 // 6 hours — Next.js ISR cache

const WINDOW_DAYS = 14

export type FreeEvent = (OpenDataEvent | EventbriteEvent) & {
  source: 'edmonton-open-data' | 'eventbrite'
}

export interface EventsResponse {
  events: FreeEvent[]
  open_data_count: number
  eventbrite_count: number
  eventbrite_enabled: boolean
  fetched_at: string
  error: string | null
}

export async function GET(): Promise<NextResponse> {
  const start = Date.now()

  // Auth guard — cockpit endpoints require an authenticated user
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const eventbriteEnabled = Boolean(process.env.EVENTBRITE_API_KEY?.trim())

  // Fetch from both sources concurrently — each handles its own errors gracefully
  const [openDataEvents, eventbriteEvents] = await Promise.all([
    fetchEdmontonOpenDataEvents(WINDOW_DAYS),
    fetchEventbriteEvents(WINDOW_DAYS),
  ])

  // Merge and de-duplicate by title+date (both sources may list the same event)
  const seen = new Set<string>()
  const merged: FreeEvent[] = []

  for (const ev of [...openDataEvents, ...eventbriteEvents]) {
    const key = `${ev.title.toLowerCase().trim()}|${ev.startDate.slice(0, 10)}`
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(ev as FreeEvent)
    }
  }

  // Sort merged list by start date ascending
  merged.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())

  const latencyMs = Date.now() - start
  const fetched_at = new Date().toISOString()

  // F18 + F17: log to agent_events (non-blocking)
  // action='events_fetched' = F18 data quality signal
  // action='events_viewed' is logged client-side on page load (F17 exemption signal)
  const serviceClient = createServiceClient()
  void serviceClient.from('agent_events').insert({
    domain: 'cockpit',
    action: 'events_fetched',
    actor: 'server',
    status: 'success',
    duration_ms: latencyMs,
    meta: {
      open_data_count: openDataEvents.length,
      eventbrite_count: eventbriteEvents.length,
      total_count: merged.length,
      window_days: WINDOW_DAYS,
      eventbrite_enabled: eventbriteEnabled,
    },
  })

  const body: EventsResponse = {
    events: merged,
    open_data_count: openDataEvents.length,
    eventbrite_count: eventbriteEvents.length,
    eventbrite_enabled: eventbriteEnabled,
    fetched_at,
    error: null,
  }

  return NextResponse.json(body)
}
