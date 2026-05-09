import { createServiceClient } from '@/lib/supabase/service'

// Updates LAST_HEARTBEAT_AT in harness_config so /api/health/lease shows "alive".
// Throws loud on failure — a silent heartbeat miss causes the DMS to read stale.
export async function upsertHeartbeat(): Promise<void> {
  const db = createServiceClient()
  const { error, count } = await db
    .from('harness_config')
    .update({ value: new Date().toISOString() }, { count: 'exact' })
    .eq('key', 'LAST_HEARTBEAT_AT')
  if (error) throw new Error(`heartbeat: write failed — ${error.message}`)
  if (count !== 1) throw new Error(`heartbeat: wrote ${count ?? 0} rows — LAST_HEARTBEAT_AT missing from harness_config`)
}
