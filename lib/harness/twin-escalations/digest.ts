import { createServiceClient } from '@/lib/supabase/service'

interface OpenEscalationRow {
  id: string
}

export async function buildOpenEscalationsLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()

    const { data, error } = await db
      .from('twin_escalations')
      .select('id')
      .eq('status', 'open')
      .gte('created_at', since)
      .limit(500)

    if (error) return 'Twin escalations: stats unavailable'

    const open24h = ((data ?? []) as OpenEscalationRow[]).length

    if (open24h === 0) return 'Twin escalations (24h): 0 open'
    return `Twin escalations (24h): ${open24h} open — teach via /api/twin/teach with escalation_id`
  } catch {
    return 'Twin escalations: stats unavailable'
  }
}
