// F18: bench=square_webhook_latency<500ms; surface=local_sales COUNT(*) per week
// module_metric: SELECT COUNT(*), DATE_TRUNC('week', square_created_at) FROM local_sales GROUP BY 2

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

// Square signature verification:
//   HMAC-SHA256(SQUARE_WEBHOOK_SIGNATURE_KEY, webhookUrl + rawBody), base64-encoded.
//   Compared timing-safely against the x-square-hmacsha256-signature header.
//   F15: .trim() the key to guard against Vercel CLI stdin trailing \r\n.
//   See: https://developer.squareup.com/docs/webhooks/validate-notifications

const WEBHOOK_URL =
  (process.env.NEXT_PUBLIC_APP_URL ?? 'https://lepios-one.vercel.app') + '/api/webhooks/square'

function verifySquareSignature(
  signatureKey: string,
  rawBody: string,
  signatureHeader: string
): boolean {
  const computed = crypto
    .createHmac('sha256', signatureKey.trim()) // F15: trim to guard against \r\n
    .update(WEBHOOK_URL + rawBody)
    .digest('base64')

  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signatureHeader))
  } catch {
    // Buffer length mismatch — different lengths means definite mismatch
    return false
  }
}

// Map Square tender type strings to our payment_method enum values
function toPaymentMethod(tenderType: string | undefined): string {
  if (!tenderType) return 'OTHER'
  const t = tenderType.toUpperCase()
  if (t.includes('CARD')) return 'CARD'
  if (t.includes('CASH')) return 'CASH'
  return 'OTHER'
}

export async function POST(request: Request): Promise<NextResponse> {
  // Step 1: check env var first — fail explicitly rather than with a 500
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY
  if (!signatureKey) {
    return NextResponse.json({ error: 'Square webhook not configured' }, { status: 503 })
  }

  // Step 2: read raw body as string BEFORE any parsing (critical for HMAC verification)
  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json({ error: 'Failed to read request body' }, { status: 400 })
  }

  // Step 3: verify Square HMAC-SHA256 signature
  const signatureHeader = request.headers.get('x-square-hmacsha256-signature') ?? ''
  if (!signatureHeader || !verifySquareSignature(signatureKey, rawBody, signatureHeader)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  // Step 4: parse the verified body
  let payload: {
    event_type?: string
    data?: {
      object?: {
        payment?: {
          id?: string
          amount_money?: { amount?: number; currency?: string }
          tender?: Array<{ type?: string }>
          location_id?: string
          created_at?: string
        }
      }
    }
  }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Step 5: route by event_type — only handle payment.completed
  if (payload.event_type !== 'payment.completed') {
    return NextResponse.json({ received: true, skipped: true }, { status: 200 })
  }

  // Step 6: extract payment fields
  const payment = payload.data?.object?.payment
  if (!payment?.id) {
    // Malformed payment.completed — return 200 to prevent Square retries for bad data
    return NextResponse.json({ received: true, warning: 'missing_payment_id' }, { status: 200 })
  }

  const squarePaymentId = payment.id
  // Square sends amount in smallest currency unit (cents for CAD)
  const amountCad = (payment.amount_money?.amount ?? 0) / 100
  const currency = payment.amount_money?.currency ?? 'CAD'
  // Tender type comes from the tenders array; use first entry's type
  const tenderType = payment.tender?.[0]?.type
  const paymentMethod = toPaymentMethod(tenderType)
  const locationId = payment.location_id ?? null
  const squareCreatedAt = payment.created_at ?? new Date().toISOString()

  // Step 7: insert with ON CONFLICT DO NOTHING — idempotent for Square retries
  const db = createServiceClient()
  const { error } = await db.from('local_sales').insert({
    person_handle: 'colin', // SPRINT5-GATE: replace with profiles lookup when multi-user
    square_payment_id: squarePaymentId,
    amount_cad: amountCad,
    currency,
    payment_method: paymentMethod,
    location_id: locationId,
    square_created_at: squareCreatedAt,
    raw_event: payload,
  })

  if (error) {
    // 23505 = unique_violation — duplicate payment_id, idempotent success
    if (error.code === '23505') {
      return NextResponse.json({ received: true, duplicate: true }, { status: 200 })
    }
    // Other DB errors: log and return 500 so Square retries
    console.error('[square-webhook] DB insert failed:', error.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  return NextResponse.json({ received: true, inserted: true }, { status: 200 })
}
