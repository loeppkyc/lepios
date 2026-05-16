import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'

export const revalidate = 0

export interface SystemMetric {
  pct: number | null
  label: string
  sublabel?: string
  note?: string
  inverted?: boolean
}

export interface SystemsMetricsResponse {
  harness: SystemMetric
  gpuDay: SystemMetric
  orbDay: SystemMetric
  businessReview: SystemMetric
  ram: SystemMetric
  fetchedAt: string
}

export async function GET() {
  const gate = await requireUser({ minRole: 'business' })
  if (!gate.ok) return gate.response

  const supabase = gate.supabase

  const [configResult, tasksResult, ramResult] = await Promise.all([
    supabase
      .from('harness_config')
      .select('key, value')
      .in('key', ['gpu_day_score', 'orb_day_score', 'business_review_pct']),
    supabase
      .from('task_queue')
      .select('status')
      .in('status', ['completed', 'queued', 'awaiting_grounding']),
    supabase
      .from('memory_stats')
      .select('ram_pct, ram_used_gb, ram_total_gb, top_process, recorded_at')
      .order('recorded_at', { ascending: false })
      .limit(1),
  ])

  const config = Object.fromEntries(
    (configResult.data ?? []).map((r) => [r.key, parseFloat(r.value)])
  )

  const tasks = tasksResult.data ?? []
  const completed = tasks.filter((t) => t.status === 'completed').length
  const queued = tasks.filter((t) => t.status === 'queued').length
  const awaiting = tasks.filter((t) => t.status === 'awaiting_grounding').length
  const taskTotal = completed + queued + awaiting
  const harnessP = taskTotal > 0 ? Math.round((completed / taskTotal) * 10) / 10 : null
  const openTasks = queued + awaiting

  const latestRam = ramResult.data?.[0] ?? null

  const body: SystemsMetricsResponse = {
    harness: {
      pct: harnessP,
      label: 'Harness',
      note: openTasks > 0 ? `${openTasks} task${openTasks === 1 ? '' : 's'} queued` : 'Queue clear',
    },
    gpuDay: {
      pct: config.gpu_day_score ?? null,
      label: 'GPU Day',
    },
    orbDay: {
      pct: config.orb_day_score ?? null,
      label: 'Orb Day',
    },
    businessReview: {
      pct: config.business_review_pct ?? null,
      label: 'Business Review',
    },
    ram: {
      pct: latestRam?.ram_pct != null ? Number(latestRam.ram_pct) : null,
      label: 'System RAM',
      sublabel:
        latestRam?.ram_used_gb != null && latestRam?.ram_total_gb != null
          ? `${Number(latestRam.ram_used_gb).toFixed(1)} / ${Number(latestRam.ram_total_gb).toFixed(1)} GB`
          : undefined,
      note: latestRam?.top_process ? `Top: ${latestRam.top_process}` : 'No data yet',
      inverted: true,
    },
    fetchedAt: new Date().toISOString(),
  }

  return NextResponse.json(body)
}
