import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_RECORDS = 50

interface AttributionRecord {
  id: string
  action: string
  actor_type: string
  actor_id: string | null
  run_id: string | null
  coordinator_session_id: string | null
  source_task_id: string | null
  occurred_at: string
  details: Record<string, unknown> | null
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ entity_type: string; entity_id: string }> }
): Promise<NextResponse> {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const { entity_type, entity_id } = await params

  if (!UUID_RE.test(entity_id)) {
    return NextResponse.json({ error: 'entity_id must be a valid UUID' }, { status: 400 })
  }

  try {
    const db = createServiceClient()

    const { data, error } = await db
      .from('entity_attribution')
      .select(
        'id, action, actor_type, actor_id, run_id, coordinator_session_id, source_task_id, occurred_at, details'
      )
      .eq('entity_type', entity_type)
      .eq('entity_id', entity_id)
      .order('occurred_at', { ascending: false })
      .limit(MAX_RECORDS)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const records: AttributionRecord[] = (data ?? []) as AttributionRecord[]

    return NextResponse.json({ records, count: records.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
