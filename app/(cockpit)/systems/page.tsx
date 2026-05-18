// F18-EXEMPT: monitoring hub — surfaces metrics from task_queue, harness_config, memory_stats, ideas; produces no new operational signal of its own
import { requireUser } from '@/lib/auth/require-user'
import { redirect } from 'next/navigation'
import { SystemsShell } from './_components/SystemsShell'
import type { SystemsMetricsResponse } from '@/app/api/systems/metrics/route'
import type { Idea } from '@/app/api/systems/ideas/route'
import type { ExternalBenchmark } from '@/app/api/benchmarks/route'
import type { CompetitiveIntelItem } from './_components/CompetitiveIntelWidget'

export const revalidate = 0

export default async function SystemsPage() {
  const gate = await requireUser({ minRole: 'business' })
  if (!gate.ok) redirect('/login')

  const supabase = gate.supabase

  const [configResult, tasksResult, ramResult, ideasResult, benchmarksResult, intelResult] = await Promise.all([
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
    supabase
      .from('ideas')
      .select('id, title, description, status, source, created_at, updated_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('external_benchmarks')
      .select('id, benchmark_name, vs_system, parity_score, notes, measured_at')
      .order('measured_at', { ascending: false })
      .limit(100),
    supabase
      .from('competitive_intel')
      .select('id, source, url, title, relevance_score, scraped_at')
      .eq('flagged', true)
      .order('scraped_at', { ascending: false })
      .limit(20),
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

  const initialMetrics: SystemsMetricsResponse = {
    harness: {
      pct: harnessP,
      label: 'Harness',
      note: openTasks > 0 ? `${openTasks} task${openTasks === 1 ? '' : 's'} queued` : 'Queue clear',
    },
    gpuDay: { pct: config.gpu_day_score ?? null, label: 'GPU Day' },
    orbDay: { pct: config.orb_day_score ?? null, label: 'Orb Day' },
    businessReview: { pct: config.business_review_pct ?? null, label: 'Business Review' },
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

  const initialBenchmarks = (benchmarksResult.data ?? []).map((row) => ({
    id: row.id as string,
    benchmark_name: row.benchmark_name as string,
    vs_system: row.vs_system as string,
    parity_score: Number(row.parity_score),
    notes: (row.notes as string | null) ?? null,
    measured_at: row.measured_at as string,
  })) satisfies ExternalBenchmark[]

  return (
    <SystemsShell
      initialMetrics={initialMetrics}
      initialIdeas={(ideasResult.data ?? []) as Idea[]}
      initialBenchmarks={initialBenchmarks}
      initialIntelItems={(intelResult.data ?? []) as CompetitiveIntelItem[]}
    />
  )
}
