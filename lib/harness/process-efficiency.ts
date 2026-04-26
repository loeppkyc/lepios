import { createServiceClient } from '@/lib/supabase/service'

interface PickupRow {
  created_at: string
  claimed_at: string
}

function medianMinutes(rows: PickupRow[]): number | null {
  if (rows.length === 0) return null
  const diffs = rows
    .map((r) => (new Date(r.claimed_at).getTime() - new Date(r.created_at).getTime()) / 60_000)
    .filter((d) => d >= 0)
    .sort((a, b) => a - b)
  if (diffs.length === 0) return null
  const mid = Math.floor(diffs.length / 2)
  return diffs.length % 2 === 0 ? (diffs[mid - 1] + diffs[mid]) / 2 : diffs[mid]
}

export async function buildProcessEfficiencyLines(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()

    const [queuedResult, completedResult, pickupResult, depthResult, frictionResult] =
      await Promise.all([
        db.from('task_queue').select('id').gte('created_at', since).limit(100),
        db
          .from('task_queue')
          .select('id')
          .eq('status', 'completed')
          .gte('completed_at', since)
          .limit(100),
        db
          .from('task_queue')
          .select('created_at, claimed_at')
          .not('claimed_at', 'is', null)
          .gte('claimed_at', since)
          .limit(50),
        db.from('task_queue').select('id').eq('status', 'queued').lte('priority', 3).limit(20),
        db
          .from('task_queue')
          .select('id')
          .or('status.eq.awaiting_grounding,retry_count.gt.0')
          .gte('created_at', since)
          .limit(50),
      ])

    const queued24h = (queuedResult.data ?? []).length
    const completed24h = (completedResult.data ?? []).length
    const latencyMinutes = medianMinutes((pickupResult.data ?? []) as PickupRow[])
    const queueDepth = (depthResult.data ?? []).length
    const frictionCount = (frictionResult.data ?? []).length

    const lines: string[] = ['Process efficiency (24h):']

    // Signal 1: Queue throughput — proxy for coordinator quota utilization
    // Benchmark: ≥70% of created tasks complete within 24h
    if (queued24h === 0) {
      lines.push('• Queue throughput: no tasks created')
    } else {
      const pct = Math.round((completed24h / queued24h) * 100)
      const icon = pct >= 70 ? '✅' : pct >= 40 ? '⚠️' : '❌'
      const suggestion = pct < 70 ? ' | 💡 Check for stuck T3/T4 tasks or blocked grounding' : ''
      lines.push(
        `• Queue throughput: ${completed24h}/${queued24h} completed (${pct}%) ${icon}${suggestion}`
      )
    }

    // Signal 2: Task pickup latency — median time from queued → claimed
    // Benchmark: p50 < 5 min
    if (latencyMinutes === null) {
      lines.push('• Pickup latency: no pickups in 24h | 💡 Check pickup cron is firing')
    } else {
      const mins = Math.round(latencyMinutes)
      const icon = mins < 5 ? '✅' : mins < 30 ? '⚠️' : '❌'
      const suggestion =
        mins >= 5 ? ' | 💡 Increase cron frequency or check pickup cron health' : ''
      lines.push(`• Pickup latency: p50 ${mins} min ${icon} (target <5)${suggestion}`)
    }

    // Signal 3: Queue depth — parallel opportunity detector
    // Tasks in 'queued' with priority ≤ 3 are actionable right now; >1 = serialization waste
    if (queueDepth === 0) {
      lines.push('• Queue depth: 0 tasks waiting ✅')
    } else {
      const suggestion =
        queueDepth > 1
          ? ` | 💡 ${queueDepth} tasks ready — consider spawning concurrent coordinators`
          : ' | 💡 1 task waiting — pick it up'
      lines.push(
        `• Queue depth: ${queueDepth} task${queueDepth === 1 ? '' : 's'} waiting${suggestion}`
      )
    }

    // Signal 4: Friction index — grounding blocks + retries signal spec-quality problems
    // Benchmark: 0 per day; >2 = elevated, review coordinator spec quality
    if (frictionCount === 0) {
      lines.push('• Friction: 0 grounding blocks / retries ✅')
    } else {
      const noun = frictionCount === 1 ? 'grounding block/retry' : 'grounding blocks/retries'
      lines.push(
        `• Friction: ${frictionCount} ${noun} ⚠️ | 💡 Review coordinator spec quality to cut Colin interrupts`
      )
    }

    return lines.join('\n')
  } catch {
    return 'Process efficiency: stats unavailable'
  }
}
