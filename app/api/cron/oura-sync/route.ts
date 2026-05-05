import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const OURA_BASE = 'https://api.ouraring.com/v2/usercollection'

interface OuraDailySleep {
  day: string
  score?: number
  contributors?: { hrv_balance?: number }
}

interface OuraDailyReadiness {
  day: string
  score?: number
  contributors?: { resting_heart_rate?: number }
}

interface OuraDailyActivity {
  day: string
  score?: number
  steps?: number
}

interface OuraSleep {
  day: string
  total_sleep_duration?: number
  deep_sleep_duration?: number
  rem_sleep_duration?: number
  light_sleep_duration?: number
  average_hrv?: number
  lowest_heart_rate?: number
}

async function fetchOura<T>(endpoint: string, token: string, startDate: string, endDate: string): Promise<T[]> {
  const url = `${OURA_BASE}/${endpoint}?start_date=${startDate}&end_date=${endDate}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Oura ${endpoint} returned ${res.status}`)
  const body = (await res.json()) as { data: T[] }
  return body.data ?? []
}

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const db = createServiceClient()
  const started = Date.now()

  // Read token from harness_config
  const { data: cfg } = await db
    .from('harness_config')
    .select('value')
    .eq('key', 'OURA_TOKEN')
    .single()

  if (!cfg?.value) {
    return NextResponse.json({ ok: false, error: 'OURA_TOKEN not set in harness_config' }, { status: 503 })
  }

  const token = cfg.value as string

  // Sync trailing 30 days (catch missed days; upsert is idempotent)
  const endDate = new Date().toISOString().slice(0, 10)
  const startDate = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)

  try {
    const [sleepDaily, readiness, activity, sleepDetail] = await Promise.all([
      fetchOura<OuraDailySleep>('daily_sleep', token, startDate, endDate),
      fetchOura<OuraDailyReadiness>('daily_readiness', token, startDate, endDate),
      fetchOura<OuraDailyActivity>('daily_activity', token, startDate, endDate),
      fetchOura<OuraSleep>('sleep', token, startDate, endDate),
    ])

    // Index by date for merge
    const byDate = new Map<string, Record<string, unknown>>()

    for (const r of sleepDaily) {
      byDate.set(r.day, { date: r.day, sleep_score: r.score ?? null })
    }
    for (const r of readiness) {
      const row = byDate.get(r.day) ?? { date: r.day }
      row.readiness_score = r.score ?? null
      byDate.set(r.day, row)
    }
    for (const r of activity) {
      const row = byDate.get(r.day) ?? { date: r.day }
      row.activity_score = r.score ?? null
      row.steps = r.steps ?? null
      byDate.set(r.day, row)
    }
    // Use longest sleep session per day for detail fields
    for (const r of sleepDetail) {
      const row = byDate.get(r.day) ?? { date: r.day }
      const prevTotal = (row.total_sleep_hours as number | null) ?? 0
      const thisTotal = r.total_sleep_duration != null ? r.total_sleep_duration / 3600 : 0
      if (thisTotal > prevTotal) {
        row.total_sleep_hours = Math.round(thisTotal * 10) / 10
        row.deep_sleep_min = r.deep_sleep_duration != null ? Math.round(r.deep_sleep_duration / 60) : null
        row.rem_sleep_min = r.rem_sleep_duration != null ? Math.round(r.rem_sleep_duration / 60) : null
        row.light_sleep_min = r.light_sleep_duration != null ? Math.round(r.light_sleep_duration / 60) : null
        row.hrv = r.average_hrv ?? null
        row.resting_hr = r.lowest_heart_rate ?? null
      }
      byDate.set(r.day, row)
    }

    const rows = Array.from(byDate.values()).map((r) => ({ ...r, synced_at: new Date().toISOString() }))

    if (rows.length > 0) {
      const { error } = await db.from('oura_daily').upsert(rows, { onConflict: 'date' })
      if (error) throw new Error(`upsert: ${error.message}`)
    }

    await db.from('agent_events').insert({
      domain: 'health',
      action: 'oura.sync',
      actor: 'cron_oura_sync',
      status: 'success',
      duration_ms: Date.now() - started,
      output_summary: `upserted ${rows.length} days (${startDate} to ${endDate})`,
      meta: { days: rows.length, start_date: startDate, end_date: endDate },
    })

    return NextResponse.json({ ok: true, days: rows.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    try {
      await db.from('agent_events').insert({
        domain: 'health',
        action: 'oura.sync',
        actor: 'cron_oura_sync',
        status: 'error',
        duration_ms: Date.now() - started,
        error_message: msg,
      })
    } catch {
      // best-effort log
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}
