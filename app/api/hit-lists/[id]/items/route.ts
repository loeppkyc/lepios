import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { AddItemsSchema } from '@/lib/hit-lists/schemas'
import { logEvent, logError } from '@/lib/knowledge/client'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: list } = await supabase
    .from('hit_lists')
    .select('id')
    .eq('id', id)
    .eq('person_handle', 'colin') // SPRINT5-GATE
    .single()

  if (!list) return NextResponse.json({ error: 'List not found' }, { status: 404 })

  // Step 1 — fetch items with all fields needed for enrichment
  const { data: items, error } = await supabase
    .from('hit_list_items')
    .select('id, isbn, cost_paid_cad, status, scan_result_id, added_at, scanned_at')
    .eq('hit_list_id', id)
    .order('added_at', { ascending: true })

  if (error) return NextResponse.json({ error: 'Failed to fetch items' }, { status: 500 })

  // Step 2 — fetch latest scan_result for items that have one
  const resultIds = (items ?? [])
    .filter((i) => i.scan_result_id)
    .map((i) => i.scan_result_id!)

  const { data: scanResults } =
    resultIds.length > 0
      ? await supabase
          .from('scan_results')
          .select('id, title, bsr, profit_cad, roi_pct, decision, tier')
          .in('id', resultIds)
      : { data: [] }

  // Step 3 — BSR history per scanned ISBN (last 7 readings each)
  const scannedIsbns = [
    ...new Set((items ?? []).filter((i) => i.scan_result_id).map((i) => i.isbn)),
  ]

  const { data: bsrHistory } =
    scannedIsbns.length > 0
      ? await supabase
          .from('scan_results')
          .select('isbn, bsr, recorded_at')
          .in('isbn', scannedIsbns)
          .not('bsr', 'is', null)
          .order('recorded_at', { ascending: true })
          .limit(7 * scannedIsbns.length)
      : { data: [] }

  // Assemble enriched rows
  const resultMap = new Map((scanResults ?? []).map((r) => [r.id, r]))
  const historyMap = new Map<string, { bsr: number; recorded_at: string }[]>()
  for (const h of bsrHistory ?? []) {
    const arr = historyMap.get(h.isbn) ?? []
    arr.push({ bsr: h.bsr!, recorded_at: h.recorded_at })
    historyMap.set(h.isbn, arr)
  }

  return NextResponse.json(
    (items ?? []).map((item) => {
      const sr = item.scan_result_id ? resultMap.get(item.scan_result_id) : null
      return {
        id: item.id,
        isbn: item.isbn,
        cost_paid_cad: item.cost_paid_cad ? Number(item.cost_paid_cad) : null,
        status: item.status as 'pending' | 'scanned' | 'skipped',
        added_at: item.added_at,
        scanned_at: item.scanned_at ?? null,
        title: sr?.title ?? null,
        bsr: sr?.bsr ?? null,
        profit_cad: sr?.profit_cad ? Number(sr.profit_cad) : null,
        roi_pct: sr?.roi_pct ? Number(sr.roi_pct) : null,
        decision: sr?.decision ?? null,
        tier: sr?.tier ?? null,
        bsr_history: historyMap.get(item.isbn) ?? [],
      }
    })
  )
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = AddItemsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Validation failed' },
      { status: 400 }
    )
  }

  const { id } = await params

  const { data: list, error: listError } = await supabase
    .from('hit_lists')
    .select('id')
    .eq('id', id)
    .eq('person_handle', 'colin')
    .single()

  if (listError || !list) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 })
  }

  const isbns = parsed.data.isbns.map((s) => s.trim()).filter(Boolean)

  if (isbns.length === 0) {
    return NextResponse.json({ added: 0, skipped: 0 })
  }

  const rows = isbns.map((isbn) => ({
    hit_list_id: id,
    isbn,
    status: 'pending' as const,
  }))

  const { data: inserted, error } = await supabase
    .from('hit_list_items')
    .upsert(rows, { onConflict: 'hit_list_id,isbn', ignoreDuplicates: true })
    .select('id')

  if (error) {
    void logError('pageprofit', 'hit-list.add-items', new Error(error.message), {
      actor: 'user',
      entity: id,
      meta: { isbn_count: isbns.length },
    })
    return NextResponse.json({ error: 'Failed to add ISBNs' }, { status: 500 })
  }

  const added = inserted?.length ?? 0
  const skipped = isbns.length - added

  void logEvent('pageprofit', 'hit-list.add-items', {
    actor: 'user',
    status: 'success',
    entity: id,
    outputSummary: `Added ${added} ISBNs, skipped ${skipped} duplicates`,
    meta: { added, skipped, list_id: id },
  })

  return NextResponse.json({ added, skipped })
}
