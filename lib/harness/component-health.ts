import { createServiceClient } from '@/lib/supabase/service'

// ── Types ─────────────────────────────────────────────────────────────────────

export type HealthStatus = 'green' | 'amber' | 'red'

export interface ComponentEvent {
  occurred_at: string
  status: 'success' | 'error' | 'warning'
  error_message: string | null
  action: string
}

export interface ComponentHealthInput {
  id: string
  display_name: string
  weight_pct: number
  completion_pct: number
}

export interface ComponentHealth extends ComponentHealthInput {
  health: HealthStatus
  last_success: string | null
  last_failure: string | null
  last_error: string | null
}

// ── deriveComponentHealth — pure ──────────────────────────────────────────────
//
// Status semantics (Colin, 2026-05-06):
//   red   = error or not working (last event is an unrecovered failure)
//   amber = something in the middle (still being built — completion_pct < 100)
//   green = good and working (built, not currently broken)
//
// A component that failed earlier but has since recovered is green; the Last
// Failure column carries the history. Absence of events does not flip a
// fully-built component to red — silence is treated as "fine until proven
// otherwise."

const H72 = 72 * 3_600_000

export function deriveComponentHealth(
  component: ComponentHealthInput,
  events: ComponentEvent[],
  _now: Date = new Date()
): ComponentHealth {
  const successes = events
    .filter((e) => e.status === 'success')
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())

  const failures = events
    .filter((e) => e.status === 'error')
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())

  const lastSuccess = successes[0] ?? null
  const lastFailure = failures[0] ?? null

  const lastSuccessMs = lastSuccess ? new Date(lastSuccess.occurred_at).getTime() : null
  const lastFailureMs = lastFailure ? new Date(lastFailure.occurred_at).getTime() : null

  const mostRecentIsFailure =
    lastFailureMs !== null && (lastSuccessMs === null || lastFailureMs > lastSuccessMs)

  let health: HealthStatus
  if (mostRecentIsFailure) {
    health = 'red'
  } else if (component.completion_pct < 100) {
    health = 'amber'
  } else {
    health = 'green'
  }

  return {
    ...component,
    health,
    last_success: lastSuccess?.occurred_at ?? null,
    last_failure: lastFailure?.occurred_at ?? null,
    last_error: lastFailure?.error_message ?? null,
  }
}

// ── getComponentsWithHealth — DB ──────────────────────────────────────────────

export async function getComponentsWithHealth(): Promise<ComponentHealth[]> {
  const db = createServiceClient()

  const { data: components, error: compErr } = await db
    .from('harness_components')
    .select('id, display_name, weight_pct, completion_pct')
    .order('weight_pct', { ascending: false })

  if (compErr || !components || components.length === 0) return []

  const since72h = new Date(Date.now() - H72).toISOString()

  // Fetch harness domain events from the last 72h.
  // Events emitted by harness tools use meta.id = component slug.
  const { data: rawEvents } = await db
    .from('agent_events')
    .select('occurred_at, status, error_message, action, meta')
    .eq('domain', 'harness')
    .gte('occurred_at', since72h)
    .order('occurred_at', { ascending: false })
    .limit(500)

  const slugSet = new Set(components.map((c) => c.id))
  const eventsBySlug = new Map<string, ComponentEvent[]>()
  for (const slug of slugSet) eventsBySlug.set(slug, [])

  for (const ev of rawEvents ?? []) {
    const slug = (ev.meta as Record<string, unknown> | null)?.id as string | undefined
    if (slug && eventsBySlug.has(slug)) {
      eventsBySlug.get(slug)!.push({
        occurred_at: ev.occurred_at as string,
        status: ev.status as 'success' | 'error' | 'warning',
        error_message: ev.error_message as string | null,
        action: ev.action as string,
      })
    }
  }

  return components.map((c) =>
    deriveComponentHealth(c as ComponentHealthInput, eventsBySlug.get(c.id) ?? [])
  )
}
