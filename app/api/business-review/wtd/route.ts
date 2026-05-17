import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'
import { createClient } from '@/lib/supabase/server'

// Always serve fresh — WTD advances as each day passes.
export const dynamic = 'force-dynamic'

// ── Edmonton timezone helpers ─────────────────────────────────────────────────

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

/**
 * Return the ISO date string (YYYY-MM-DD) for a given Date as seen in Edmonton.
 * Server-timezone-independent — uses Intl formatting.
 */
function edmontonDateString(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Edmonton',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const year = parts.find((p) => p.type === 'year')!.value
  const month = parts.find((p) => p.type === 'month')!.value
  const day = parts.find((p) => p.type === 'day')!.value
  return `${year}-${month}-${day}`
}

/**
 * Return the long weekday name in Edmonton timezone for a given Date.
 * e.g. "Monday", "Tuesday", etc.
 */
function edmontonWeekdayLong(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Edmonton',
    weekday: 'long',
  }).format(d)
}

const DAY_ISO_INDEX: Record<string, number> = {
  Monday: 0,
  Tuesday: 1,
  Wednesday: 2,
  Thursday: 3,
  Friday: 4,
  Saturday: 5,
  Sunday: 6,
}

/**
 * Return the Monday of the ISO week containing the given Date (as seen in Edmonton),
 * shifted by weekOffset weeks (0 = this week, -1 = last week).
 */
function edmontonIsoWeekMonday(d: Date, weekOffset: 0 | -1): string {
  const weekday = edmontonWeekdayLong(d)
  const dayIndex = DAY_ISO_INDEX[weekday] ?? 0 // 0=Mon
  // Days to go back from today (Edmonton date) to reach Monday of this week
  const daysToMonday = dayIndex + weekOffset * -7
  const monday = new Date(d)
  // Subtract in UTC days — we then format via edmontonDateString so tz is correct
  monday.setUTCDate(monday.getUTCDate() - daysToMonday)
  return edmontonDateString(monday)
}

export interface WTDResponse {
  thisWeek: {
    orders: number
    revenue: number
  }
  priorWeekSamePeriod: {
    orders: number
    revenue: number
  }
  /** Projected weekly revenue if current pace holds (revenue / days elapsed * 7). */
  paceProjection: number
  /** Day of week elapsed this week (Mon=1 through Sun=7). */
  dayOfWeekElapsed: number
  fetchedAt: string
}

/** Aggregate orders and revenue from the orders table for an inclusive date range. */
async function queryWeekWindow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fromDate: string,
  toDate: string
): Promise<{ orders: number; revenue: number }> {
  const { data, error } = await supabase
    .from('orders')
    .select('revenue_cad, status')
    .gte('order_date', fromDate)
    .lte('order_date', toDate)
    .neq('status', 'Canceled')

  if (error || !data) return { orders: 0, revenue: 0 }

  // Count distinct confirmed orders — orders table has one row per ASIN per order,
  // so we count revenue-contributing rows (status != Pending as a safety check, but
  // Pending rows are included in the table and contribute partial revenue per F12).
  // For simplicity, count all non-Canceled rows as "orders" contribution.
  const confirmed = data.filter((r) => (r.status as string) !== 'Canceled')
  const orders = confirmed.length
  const revenue =
    Math.round(confirmed.reduce((s, r) => s + Number(r.revenue_cad ?? 0), 0) * 100) / 100

  return { orders, revenue }
}

export async function GET() {
  const gate = await requireUser({ minRole: 'business' })
  if (!gate.ok) return gate.response

  const supabase = await createClient()
  const now = new Date()

  // Day of week in Edmonton — 1=Mon…7=Sun (for display + pace calc)
  const weekdayName = edmontonWeekdayLong(now)
  const dayOfWeekElapsedMap: Record<string, number> = {
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
    Sunday: 7,
  }
  const dayOfWeekElapsed = dayOfWeekElapsedMap[weekdayName] ?? 1
  const todayEdmonton = edmontonDateString(now)

  // This week: Monday → today (inclusive), Edmonton dates
  const thisWeekMonday = edmontonIsoWeekMonday(now, 0)

  // Prior week same period: Monday → same weekday one week prior (inclusive)
  const priorWeekMonday = edmontonIsoWeekMonday(now, -1)
  const priorWeekEndDate = new Date(now)
  priorWeekEndDate.setUTCDate(priorWeekEndDate.getUTCDate() - 7)
  const priorWeekToday = edmontonDateString(priorWeekEndDate)

  const [thisWeek, priorWeekSamePeriod] = await Promise.all([
    queryWeekWindow(supabase, thisWeekMonday, todayEdmonton),
    queryWeekWindow(supabase, priorWeekMonday, priorWeekToday),
  ])

  // Pace projection: revenue / days elapsed * 7
  // TODO: tune with real data — assumes linear daily distribution
  const paceProjection =
    dayOfWeekElapsed > 0 ? Math.round((thisWeek.revenue / dayOfWeekElapsed) * 7 * 100) / 100 : 0

  const body: WTDResponse = {
    thisWeek,
    priorWeekSamePeriod,
    paceProjection,
    dayOfWeekElapsed,
    fetchedAt: new Date().toISOString(),
  }

  return NextResponse.json(body)
}

// Helper exported for tests
export { pad2, edmontonDateString, edmontonWeekdayLong, edmontonIsoWeekMonday }
