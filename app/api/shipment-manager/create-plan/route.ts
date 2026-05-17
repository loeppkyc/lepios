import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { spFetch, spApiConfigured } from '@/lib/amazon/client'

// ── SP-API response types for FBA Inbound v0 ─────────────────────────────────

interface SpInboundPlan {
  ShipmentId: string
  DestinationFulfillmentCenterId: string
  LabelPrepType?: string
}

interface SpCreateInboundShipmentPlanResponse {
  payload?: {
    InboundShipmentPlans?: SpInboundPlan[]
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // F-N5: user-facing routes must use supabase.auth.getUser()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!spApiConfigured()) {
    return NextResponse.json({ error: 'SP-API credentials not configured' }, { status: 503 })
  }

  let body: { batch_id?: string }
  try {
    body = (await request.json()) as { batch_id?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { batch_id } = body
  if (!batch_id) {
    return NextResponse.json({ error: 'batch_id is required' }, { status: 400 })
  }

  // Load batch and items
  const { data: batch, error: batchErr } = await supabase
    .from('fba_batches')
    .select('id, name, shipment_plan_id, shipment_status')
    .eq('id', batch_id)
    .eq('person_handle', 'colin') // SPRINT5-GATE
    .single()

  if (batchErr || !batch) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  }

  if ((batch.shipment_status as string) === 'planned') {
    return NextResponse.json(
      { error: 'Batch already has a shipment plan', shipment_plan_id: batch.shipment_plan_id },
      { status: 409 }
    )
  }

  const { data: items, error: itemsErr } = await supabase
    .from('fba_batch_items')
    .select('asin, sku, title, condition_code, list_price_cad')
    .eq('batch_id', batch_id)
    .neq('status', 'shipped')

  if (itemsErr || !items || items.length === 0) {
    return NextResponse.json({ error: 'Batch has no eligible items' }, { status: 422 })
  }

  // Build SP-API request body for POST /fba/inbound/v0/plans
  // Uses SellerSKU + ASIN + Quantity per item.
  // ShipFromAddress uses a placeholder — Colin's Edmonton address.
  // TODO: move ship-from address to harness_config for tunability.
  const ShipFromAddress = {
    Name: 'Colin Loeppky',
    AddressLine1: process.env.FBA_SHIP_FROM_ADDRESS_LINE1 ?? '1234 Placeholder St',
    City: process.env.FBA_SHIP_FROM_CITY ?? 'Edmonton',
    StateOrProvinceCode: 'AB',
    CountryCode: 'CA',
    PostalCode: process.env.FBA_SHIP_FROM_POSTAL_CODE ?? 'T5A 0A1',
  }

  // Aggregate by ASIN+SKU to get per-item quantity
  const itemMap = new Map<string, { asin: string; sku: string; quantity: number }>()
  for (const item of items) {
    const key = `${item.asin ?? ''}:${item.sku ?? item.asin ?? ''}`
    const existing = itemMap.get(key)
    if (existing) {
      existing.quantity += 1
    } else {
      itemMap.set(key, {
        asin: (item.asin as string) ?? '',
        sku: (item.sku as string) ?? (item.asin as string) ?? '',
        quantity: 1,
      })
    }
  }

  const InboundShipmentPlanRequestItems = Array.from(itemMap.values()).map((i) => ({
    SellerSKU: i.sku,
    ASIN: i.asin,
    Condition: 'UsedGood', // TODO: map condition_code → SP-API condition enum
    Quantity: i.quantity,
  }))

  let planResponse: SpCreateInboundShipmentPlanResponse
  try {
    planResponse = await spFetch<SpCreateInboundShipmentPlanResponse>('/fba/inbound/v0/plans', {
      method: 'POST',
      body: {
        ShipFromAddress,
        ShipToCountryCode: 'CA',
        LabelPrepPreference: 'SELLER_LABEL',
        InboundShipmentPlanRequestItems,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `SP-API create plan failed: ${message}` }, { status: 502 })
  }

  const plans = planResponse?.payload?.InboundShipmentPlans
  if (!plans || plans.length === 0) {
    return NextResponse.json(
      { error: 'SP-API returned no shipment plans', raw: planResponse },
      { status: 502 }
    )
  }

  // Use the first plan (most common: single destination FC)
  const plan = plans[0]
  const shipmentId = plan.ShipmentId
  const destinationFc = plan.DestinationFulfillmentCenterId

  // Persist plan to fba_batches
  const { error: updateErr } = await supabase
    .from('fba_batches')
    .update({
      shipment_plan_id: shipmentId,
      shipment_status: 'planned',
      updated_at: new Date().toISOString(),
    })
    .eq('id', batch_id)

  if (updateErr) {
    return NextResponse.json(
      { error: `Plan created but DB update failed: ${updateErr.message}`, shipmentId },
      { status: 500 }
    )
  }

  return NextResponse.json({
    shipmentId,
    destinationFulfillmentCenterId: destinationFc,
    labelPrepType: plan.LabelPrepType ?? 'SELLER_LABEL',
    itemCount: items.length,
  })
}
