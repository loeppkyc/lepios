import { createServiceClient } from '@/lib/supabase/service'

export async function buildQuotaCliffLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const twoHoursAgo = new Date(Date.now() - 7_200_000).toISOString()

    const [errResult, stuckResult] = await Promise.all([
      db
        .from('agent_events')
        .select('id')
        .eq('action', 'invoke_coordinator')
        .eq('status', 'error')
        .filter('meta->>upstream_status', 'eq', '429')
        .gte('occurred_at', since)
        .limit(100),
      db.from('task_queue').select('id').eq('status', 'claimed').lt('claimed_at', twoHoursAgo).limit(50),
    ])

    const errorCount = (errResult.data ?? []).length
    const stuckCount = (stuckResult.data ?? []).length

    if (stuckCount > 0) {
      const taskWord = stuckCount === 1 ? 'task' : 'tasks'
      return `Routines quota: ${errorCount}×429 events, ${stuckCount} ${taskWord} stuck-claimed (24h) ❌ | 💡 Predictive quota check needed`
    }

    if (errorCount > 0) {
      return `Routines quota: ${errorCount}×429 events (24h) ⚠️ no tasks bricked yet`
    }

    return 'Routines quota: clean (24h) ✅'
  } catch {
    return 'Routines quota: stats unavailable'
  }
}
