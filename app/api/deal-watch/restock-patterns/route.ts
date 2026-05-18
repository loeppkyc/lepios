import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // PostgREST doesn't support GROUP BY — aggregate in JS after fetching all rows.
  // lego_restock_events is expected to stay small (<10k rows for foreseeable future).
  const { data: rows, error } = await supabase
    .from('lego_restock_events')
    .select('set_number, status_to, occurred_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type PatternAccumulator = {
    set_number: string
    restock_count: number
    last_restock_at: string | null
    last_event_at: string | null
  }

  const bySet = new Map<string, PatternAccumulator>()

  for (const row of rows ?? []) {
    const existing: PatternAccumulator = bySet.get(row.set_number) ?? {
      set_number: row.set_number,
      restock_count: 0,
      last_restock_at: null,
      last_event_at: null,
    }

    if (row.status_to === 'E_AVAILABLE') {
      existing.restock_count += 1
      if (existing.last_restock_at === null || row.occurred_at > existing.last_restock_at) {
        existing.last_restock_at = row.occurred_at
      }
    }

    if (existing.last_event_at === null || row.occurred_at > existing.last_event_at) {
      existing.last_event_at = row.occurred_at
    }

    bySet.set(row.set_number, existing)
  }

  const patterns = Array.from(bySet.values()).sort((a, b) => {
    if (!a.last_event_at) return 1
    if (!b.last_event_at) return -1
    return b.last_event_at.localeCompare(a.last_event_at)
  })

  return NextResponse.json({ patterns })
}
