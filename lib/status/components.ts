/**
 * lib/status/components.ts
 *
 * Component definitions and query logic for /cockpit/status.
 * All queries target existing `agent_events` and `harness_config` tables —
 * no migration required.
 *
 * F17: Status page is the F18 observability surface for behavioral engine reliability.
 * F18: bench per-component — see acceptance doc §F18 Metrics.
 * F20: No inline style={} — UI layer handles all CSS.
 */

import { createServiceClient } from '@/lib/supabase/service'

// ─── Types ──────────────────────────────────────────────────────────────────

export type ComponentStatus = 'green' | 'amber' | 'red' | 'unknown'

export interface DayBar {
  /** ISO date string YYYY-MM-DD */
  date: string
  status: ComponentStatus
}

export interface ComponentResult {
  id: string
  label: string
  description: string
  currentStatus: ComponentStatus
  uptimePercent: number
  /** 90 bars, oldest → newest (left → right) */
  bars: DayBar[]
}

// ─── Component definitions ──────────────────────────────────────────────────

/**
 * Hard-coded v1 component list (configurable v2).
 * Order matches the acceptance doc component list.
 */
export const STATUS_COMPONENTS = [
  {
    id: 'harness-cron',
    label: 'Harness Cron',
    description: 'Daily task-pickup cron — fires coordinator at 6:30 AM MDT',
  },
  {
    id: 'twin-endpoint',
    label: 'Twin Endpoint',
    description: 'Digital Twin Q&A — /api/twin/ask',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    description: 'Local AI inference — Qwen 2.5 32B / Phi-4 14B',
  },
  {
    id: 'supabase',
    label: 'Supabase',
    description: 'Database — if this page loaded, Supabase is up',
  },
  {
    id: 'vercel-deploy',
    label: 'Vercel Deploy',
    description: 'Last successful deploy to production',
  },
  {
    id: 'notifications-drain',
    label: 'Notifications Drain',
    description: 'Telegram outbound queue — drain cron flushes pending rows',
  },
  {
    id: 'sp-api',
    label: 'SP-API',
    description: 'Amazon Selling Partner API — orders, fees, catalog',
  },
] as const

export type ComponentId = (typeof STATUS_COMPONENTS)[number]['id']

// ─── Day range helpers ───────────────────────────────────────────────────────

function utcDayString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function buildDayRange(days: number): string[] {
  const result: string[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - i)
    result.push(utcDayString(d))
  }
  return result
}

// ─── Per-component current-status logic ────────────────────────────────────

async function getHarnessCronStatus(
  service: ReturnType<typeof createServiceClient>
): Promise<ComponentStatus> {
  const since26h = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString()
  const since50h = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString()

  const { data: recent } = await service
    .from('agent_events')
    .select('occurred_at')
    .in('action', ['session_summary', 'coordinator_startup'])
    .gte('occurred_at', since26h)
    .limit(1)

  if (recent && recent.length > 0) return 'green'

  const { data: older } = await service
    .from('agent_events')
    .select('occurred_at')
    .in('action', ['session_summary', 'coordinator_startup'])
    .gte('occurred_at', since50h)
    .limit(1)

  if (older && older.length > 0) return 'amber'
  return 'red'
}

async function getTwinEndpointStatus(
  service: ReturnType<typeof createServiceClient>
): Promise<ComponentStatus> {
  const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  // Green: success event in last 48h
  const { data: success } = await service
    .from('agent_events')
    .select('occurred_at, status')
    .eq('domain', 'twin')
    .eq('status', 'success')
    .gte('occurred_at', since48h)
    .limit(1)

  if (success && success.length > 0) return 'green'

  // Check if the last event is an error
  const { data: lastEvent } = await service
    .from('agent_events')
    .select('status')
    .eq('domain', 'twin')
    .order('occurred_at', { ascending: false })
    .limit(1)

  if (lastEvent && lastEvent.length > 0 && lastEvent[0].status === 'error') return 'red'
  return 'amber'
}

async function getOllamaStatus(
  service: ReturnType<typeof createServiceClient>
): Promise<ComponentStatus> {
  // Check harness_config for OLLAMA_LAST_SEEN timestamp
  const { data: config } = await service
    .from('harness_config')
    .select('value')
    .eq('key', 'OLLAMA_LAST_SEEN')
    .single()

  if (config?.value) {
    const lastSeen = new Date(config.value as string)
    const ageMs = Date.now() - lastSeen.getTime()
    if (ageMs < 24 * 60 * 60 * 1000) return 'green'
  }

  // Fallback: agent_events domain=local_ai
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: aiEvent } = await service
    .from('agent_events')
    .select('occurred_at')
    .eq('domain', 'local_ai')
    .eq('status', 'success')
    .gte('occurred_at', since24h)
    .limit(1)

  if (aiEvent && aiEvent.length > 0) return 'green'
  return 'red'
}

/** Supabase: always green if the page loaded (this query succeeds). Red only on DB error. */
function getSupabaseStatus(dbError: boolean): ComponentStatus {
  return dbError ? 'red' : 'green'
}

async function getVercelDeployStatus(
  service: ReturnType<typeof createServiceClient>
): Promise<ComponentStatus> {
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data } = await service
    .from('agent_events')
    .select('occurred_at')
    .eq('action', 'deploy_completed')
    .gte('occurred_at', since7d)
    .limit(1)

  return data && data.length > 0 ? 'green' : 'red'
}

async function getNotificationsDrainStatus(
  service: ReturnType<typeof createServiceClient>
): Promise<ComponentStatus> {
  const now = new Date()
  const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString()
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString()

  // Red: any pending row older than 30 min
  const { data: old30 } = await service
    .from('outbound_notifications')
    .select('id')
    .eq('status', 'pending')
    .lt('created_at', thirtyMinAgo)
    .limit(1)

  if (old30 && old30.length > 0) return 'red'

  // Amber: any pending row older than 10 min
  const { data: old10 } = await service
    .from('outbound_notifications')
    .select('id')
    .eq('status', 'pending')
    .lt('created_at', tenMinAgo)
    .limit(1)

  if (old10 && old10.length > 0) return 'amber'
  return 'green'
}

async function getSpApiStatus(
  service: ReturnType<typeof createServiceClient>
): Promise<ComponentStatus> {
  const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const { data } = await service
    .from('agent_events')
    .select('occurred_at')
    .eq('domain', 'amazon')
    .eq('status', 'success')
    .gte('occurred_at', since48h)
    .limit(1)

  return data && data.length > 0 ? 'green' : 'red'
}

// ─── 90-day uptime strip ─────────────────────────────────────────────────────

/**
 * For a given component id, query agent_events grouped by UTC day for the last 90 days.
 * Returns one DayBar per day, ordered oldest → newest.
 *
 * Day status rules (per acceptance doc §4):
 *   - green: any success event for that component exists
 *   - amber: only warning events (no success)
 *   - red:   only error events
 *   - grey:  no events (unknown)
 */
async function buildUptimeStrip(
  service: ReturnType<typeof createServiceClient>,
  componentId: ComponentId
): Promise<DayBar[]> {
  const since90d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const days = buildDayRange(90)

  // Map component id → query filter
  const filter = getComponentFilter(componentId)

  // Build the query with component-specific filters applied
  // Supabase builder is immutable-style: each method returns a new builder
  let q = service
    .from('agent_events')
    .select('occurred_at, status')
    .gte('occurred_at', since90d)
    .order('occurred_at', { ascending: true })

  if (filter.action && filter.action.length > 0) {
    q = q.in('action', filter.action)
  }
  if (filter.domain && filter.domain.length > 0) {
    q = q.in('domain', filter.domain)
  }

  const { data: events } = await q.limit(5000)

  // Group by UTC day
  const byDay: Record<string, { hasSuccess: boolean; hasWarning: boolean; hasError: boolean }> = {}

  for (const e of events ?? []) {
    const day = utcDayString(new Date(e.occurred_at))
    if (!byDay[day]) byDay[day] = { hasSuccess: false, hasWarning: false, hasError: false }
    if (e.status === 'success') byDay[day].hasSuccess = true
    else if (e.status === 'warning') byDay[day].hasWarning = true
    else if (e.status === 'error') byDay[day].hasError = true
  }

  return days.map((date) => {
    const d = byDay[date]
    let status: ComponentStatus = 'unknown'
    if (!d) {
      status = 'unknown'
    } else if (d.hasSuccess) {
      status = 'green'
    } else if (d.hasWarning) {
      status = 'amber'
    } else if (d.hasError) {
      status = 'red'
    }
    return { date, status }
  })
}

/**
 * Maps component id to the agent_events filter criteria for the uptime strip.
 * `action` and `domain` are OR-matched within the field (IN query).
 */
function getComponentFilter(componentId: ComponentId): {
  action?: string[]
  domain?: string[]
} {
  switch (componentId) {
    case 'harness-cron':
      return { action: ['session_summary', 'coordinator_startup', 'task_pickup'] }
    case 'twin-endpoint':
      return { domain: ['twin'] }
    case 'ollama':
      return { domain: ['local_ai'] }
    case 'supabase':
      // Supabase: any event means DB was up; greenness is implicit
      return {}
    case 'vercel-deploy':
      return { action: ['deploy_completed'] }
    case 'notifications-drain':
      return { action: ['notifications_drain', 'drain_complete'] }
    case 'sp-api':
      return { domain: ['amazon'] }
    default:
      return {}
  }
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Fetch all component statuses and uptime strips in parallel.
 * Called from the server component page.tsx — runs at request time (force-dynamic).
 */
export async function fetchAllComponentStatuses(): Promise<ComponentResult[]> {
  const service = createServiceClient()

  // Fetch uptime strips for all components in parallel
  const stripPromises = STATUS_COMPONENTS.map((c) => buildUptimeStrip(service, c.id as ComponentId))

  // Fetch current statuses in parallel
  // Supabase is always green if this function is running (page loaded = DB is up)
  const statusPromises: Promise<ComponentStatus>[] = STATUS_COMPONENTS.map((c) => {
    switch (c.id as ComponentId) {
      case 'harness-cron':
        return getHarnessCronStatus(service)
      case 'twin-endpoint':
        return getTwinEndpointStatus(service)
      case 'ollama':
        return getOllamaStatus(service)
      case 'supabase':
        return Promise.resolve(getSupabaseStatus(false))
      case 'vercel-deploy':
        return getVercelDeployStatus(service)
      case 'notifications-drain':
        return getNotificationsDrainStatus(service)
      case 'sp-api':
        return getSpApiStatus(service)
      default:
        return Promise.resolve('unknown' as ComponentStatus)
    }
  })

  const [strips, statuses] = await Promise.all([
    Promise.all(stripPromises),
    Promise.all(statusPromises),
  ])

  return STATUS_COMPONENTS.map((c, i) => {
    const bars = strips[i]
    const greenDays = bars.filter((b) => b.status === 'green').length
    const uptimePercent = Math.round((greenDays / 90) * 100)

    return {
      id: c.id,
      label: c.label,
      description: c.description,
      currentStatus: statuses[i],
      uptimePercent,
      bars,
    }
  })
}
