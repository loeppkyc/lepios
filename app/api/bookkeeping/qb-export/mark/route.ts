import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

interface MarkBody {
  je_ids: string[]
  batch?: string | null
  unmark?: boolean
}

export async function POST(request: Request) {
  const ssr = await createClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: MarkBody
  try {
    body = (await request.json()) as MarkBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (!Array.isArray(body.je_ids) || body.je_ids.length === 0) {
    return NextResponse.json({ error: 'je_ids array required' }, { status: 400 })
  }
  if (body.je_ids.length > 5000) {
    return NextResponse.json({ error: 'too many ids (max 5000)' }, { status: 400 })
  }

  const supabase = createServiceClient()

  if (body.unmark) {
    const { error } = await supabase
      .from('journal_entries')
      .update({ exported_to_qb_at: null, exported_to_qb_batch: null })
      .in('id', body.je_ids)
      .eq('source', 'lepios_auto')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, marked: 0, unmarked: body.je_ids.length })
  }

  const ts = new Date().toISOString()
  const batch = body.batch?.trim() || `manual-${ts.replace(/[:.]/g, '-').slice(0, 19)}`

  const { data, error } = await supabase
    .from('journal_entries')
    .update({ exported_to_qb_at: ts, exported_to_qb_batch: batch })
    .in('id', body.je_ids)
    .eq('source', 'lepios_auto')
    .is('exported_to_qb_at', null)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    marked: data?.length ?? 0,
    requested: body.je_ids.length,
    skipped: body.je_ids.length - (data?.length ?? 0),
    batch,
    exported_at: ts,
  })
}
