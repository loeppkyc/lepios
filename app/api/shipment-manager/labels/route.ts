import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { spFetch, spApiConfigured } from '@/lib/amazon/client'

// ── SP-API types for FBA Inbound v0 labels ───────────────────────────────────

interface SpLabelPayload {
  DownloadURL?: string
  // Amazon may also return label data as base64 in some scenarios
  LabelData?: string
  LabelFormat?: string
}

interface SpGetLabelsResponse {
  payload?: SpLabelPayload
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  // F-N5: user-facing routes must use supabase.auth.getUser()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!spApiConfigured()) {
    return NextResponse.json({ error: 'SP-API credentials not configured' }, { status: 503 })
  }

  const { searchParams } = new URL(request.url)
  const batch_id = searchParams.get('batch_id')
  if (!batch_id) {
    return NextResponse.json({ error: 'batch_id query param is required' }, { status: 400 })
  }

  // Load batch to get ShipmentId
  const { data: batch, error: batchErr } = await supabase
    .from('fba_batches')
    .select('id, shipment_plan_id, shipment_status')
    .eq('id', batch_id)
    .eq('person_handle', 'colin') // SPRINT5-GATE
    .single()

  if (batchErr || !batch) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  }

  const shipmentId = batch.shipment_plan_id as string | null
  if (!shipmentId) {
    return NextResponse.json(
      { error: 'Batch has no shipment plan yet. Create a plan first.' },
      { status: 422 }
    )
  }

  // Call SP-API GET /fba/inbound/v0/shipments/{shipmentId}/labels
  // PageType: PackageLabel_Letter_4 is the standard 4-per-page label format.
  // NumberOfPackages: 1 — override per-batch if multi-box shipment support is added.
  let labelResponse: SpGetLabelsResponse
  try {
    labelResponse = await spFetch<SpGetLabelsResponse>(
      `/fba/inbound/v0/shipments/${shipmentId}/labels`,
      {
        method: 'GET',
        params: {
          PageType: 'PackageLabel_Letter_4',
          LabelType: 'BARCODE_2D',
          NumberOfPackages: '1',
        },
      }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `SP-API labels fetch failed: ${message}` }, { status: 502 })
  }

  const payload = labelResponse?.payload
  if (!payload) {
    return NextResponse.json(
      { error: 'SP-API returned no label payload', raw: labelResponse },
      { status: 502 }
    )
  }

  return NextResponse.json({
    shipmentId,
    downloadUrl: payload.DownloadURL ?? null,
    labelData: payload.LabelData ?? null,
    labelFormat: payload.LabelFormat ?? null,
  })
}
