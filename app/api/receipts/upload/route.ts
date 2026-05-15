import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'
import { createServiceClient } from '@/lib/supabase/service'
import { ocrReceipt } from '@/lib/receipts/ocr'
import { matchReceipt, AUTO_CONFIRM_THRESHOLD } from '@/lib/receipts/match'
import type { BankTransaction } from '@/lib/receipts/match'

// ── POST /api/receipts/upload ─────────────────────────────────────────────────
// Accepts multipart/form-data with a single file (JPEG, PNG, WebP, or PDF).
// Runs OCR pipeline → inserts into receipt_lines → runs match pipeline.
// Returns { receipt_id, vendor, total, match_confidence? }

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
])

const MAX_BYTES = 20 * 1024 * 1024 // 20 MB

export async function POST(request: Request) {
  const gate = await requireUser()
  if (!gate.ok) return gate.response

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'multipart/form-data required' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field required' }, { status: 400 })
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type ${file.type}. Accepted: JPEG, PNG, WebP, PDF.` },
      { status: 400 },
    )
  }

  const bytes = await file.arrayBuffer()
  if (bytes.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large — max 20 MB' }, { status: 400 })
  }

  const buffer = Buffer.from(bytes)

  // ── Run OCR ────────────────────────────────────────────────────────────────
  let ocr
  try {
    ocr = await ocrReceipt(buffer, file.type)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `OCR failed: ${msg}` }, { status: 502 })
  }

  const supabase = createServiceClient()

  // ── Insert receipt_lines row ──────────────────────────────────────────────
  const receiptDate = ocr.date ?? new Date().toISOString().slice(0, 10)
  const { data: inserted, error: insertErr } = await supabase
    .from('receipt_lines')
    .insert({
      receipt_date: receiptDate,
      vendor: ocr.vendor,
      pre_tax: ocr.pre_tax ?? null,
      tax: ocr.tax ?? null,
      total: ocr.total,
      category: ocr.category ?? null,
      line_items: ocr.line_items,
      source: 'upload',
      source_email_id: null,
      ocr_model: ocr.ocr_model,
      ocr_raw: null,
      reconciled: false,
    })
    .select('id')
    .single()

  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'Insert failed' },
      { status: 500 },
    )
  }

  const receiptId = inserted.id as string

  // ── Run match pipeline ─────────────────────────────────────────────────────
  let matchConfidence: number | undefined

  try {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const { data: txnData } = await supabase
      .from('bank_transactions')
      .select('id, date, description, amount')
      .gte('date', thirtyDaysAgo.toISOString().slice(0, 10))
      .limit(500)

    const transactions = (txnData ?? []) as BankTransaction[]

    if (transactions.length > 0) {
      const candidates = matchReceipt(
        { id: receiptId, receipt_date: receiptDate, vendor: ocr.vendor, total: ocr.total },
        transactions,
      )
      const best = candidates[0]

      if (best) {
        matchConfidence = best.match_confidence

        if (best.auto_confirmed) {
          await supabase.from('receipt_matches').insert({
            receipt_id: receiptId,
            transaction_id: best.transaction_id,
            match_confidence: best.match_confidence,
            auto_confirmed: true,
            confirmed_at: new Date().toISOString(),
            confirmed_by: 'system',
          })
          await supabase
            .from('receipt_lines')
            .update({ reconciled: true })
            .eq('id', receiptId)
        }
      }
    }
  } catch {
    // bank_transactions not available — skip match silently
  }

  return NextResponse.json({
    receipt_id: receiptId,
    vendor: ocr.vendor,
    total: ocr.total,
    ...(matchConfidence !== undefined ? { match_confidence: matchConfidence } : {}),
  })
}
