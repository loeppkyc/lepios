import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sellerConfigured, createAmazonListing } from '@/lib/amazon/listings'
import type { ConditionCode } from '@/lib/amazon/listings'

const ListBody = z.object({
  condition_code: z.enum(['like_new', 'very_good', 'used_good', 'acceptable']),
  list_price_cad: z.number().positive().max(9999.99),
  condition_note: z.string().max(1000).optional().default(''),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: scanResultId } = await params

  // 1. Auth check
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Check sellerConfigured
  if (!sellerConfigured()) {
    return NextResponse.json({ error: 'AMAZON_SELLER_ID not configured' }, { status: 503 })
  }

  // 3. Parse body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = ListBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 }
    )
  }

  const { condition_code, list_price_cad, condition_note } = parsed.data
  const service = createServiceClient()

  // 4. Fetch scan result — person_handle check (SPRINT5-GATE)
  const { data: scanRow, error: fetchError } = await service
    .from('scan_results')
    .select('id, asin, isbn, title, person_handle')
    .eq('id', scanResultId)
    .eq('person_handle', 'colin') // SPRINT5-GATE
    .single()

  if (fetchError || !scanRow) {
    return NextResponse.json({ error: 'Scan result not found' }, { status: 404 })
  }

  // 5. Call SP-API to create the listing
  const listingResult = await createAmazonListing(
    scanRow.asin,
    condition_code as ConditionCode,
    condition_note,
    list_price_cad
  )

  // 6. Insert into amazon_listings (always record what happened)
  const { data: insertedRow, error: insertError } = await service
    .from('amazon_listings')
    .insert({
      person_handle: 'colin', // SPRINT5-GATE
      scan_result_id: scanResultId,
      sku: listingResult.sku,
      asin: scanRow.asin,
      isbn: scanRow.isbn ?? null,
      title: scanRow.title ?? null,
      condition_code,
      condition_note: condition_note || null,
      list_price_cad,
      sp_api_status: listingResult.status,
      sp_api_issues: listingResult.issues.length > 0 ? listingResult.issues : null,
    })
    .select('id')
    .single()

  if (insertError) {
    // Log but don't fail — the SP-API call already happened
    void service.from('agent_events').insert({
      domain: 'pageprofit',
      action: 'amazon_listing.db_write_failed',
      actor: 'user',
      status: 'error',
      meta: {
        scan_result_id: scanResultId,
        sku: listingResult.sku,
        sp_api_status: listingResult.status,
        error: insertError.message,
      },
    })
  }

  // Log success/failure event
  void service.from('agent_events').insert({
    domain: 'pageprofit',
    action: 'amazon_listing.created',
    actor: 'user',
    status: listingResult.status === 'ERROR' ? 'error' : 'success',
    meta: {
      scan_result_id: scanResultId,
      sku: listingResult.sku,
      asin: scanRow.asin,
      sp_api_status: listingResult.status,
    },
  })

  // 7. Return response
  const responsePayload = {
    sku: listingResult.sku,
    sp_api_status: listingResult.status,
    sp_api_issues: listingResult.issues,
    listingId: insertedRow?.id ?? null,
  }

  // 8. HTTP status based on sp_api_status
  if (listingResult.status === 'ACCEPTED' || listingResult.status === 'VALID') {
    return NextResponse.json(responsePayload, { status: 201 })
  } else if (listingResult.status === 'INVALID') {
    return NextResponse.json(responsePayload, { status: 422 })
  } else {
    return NextResponse.json(responsePayload, { status: 500 })
  }
}
