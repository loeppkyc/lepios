import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'
import type { Receipt } from '@/lib/types/receipts'

export const revalidate = 0

// ── GET /api/receipts?month=YYYY-MM ──────────────────────────────────────────
// Returns receipts where receipt_date falls in the given month.
// Falls back to upload_date when receipt_date is null.

export async function GET(request: Request) {
  const gate = await requireUser()
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month')

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month param required (YYYY-MM)' }, { status: 400 })
  }

  const [year, mo] = month.split('-').map(Number)
  const lastDay = new Date(year, mo, 0).getDate()
  const from = `${month}-01`
  const to = `${month}-${String(lastDay).padStart(2, '0')}`

  const { supabase } = gate

  // Fetch receipts whose receipt_date falls in the month (primary),
  // OR whose upload_date falls in the month when receipt_date is null.
  const { data, error } = await supabase
    .from('receipts')
    .select('*')
    .or(
      `receipt_date.gte.${from},receipt_date.lte.${to},and(receipt_date.is.null,upload_date.gte.${from},upload_date.lte.${to})`
    )
    .order('receipt_date', { ascending: false, nullsFirst: false })
    .order('upload_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ receipts: (data ?? []) as Receipt[] })
}

// ── POST /api/receipts ────────────────────────────────────────────────────────

interface CreateBody {
  receiptDate?: unknown
  vendor?: unknown
  pretax?: unknown
  taxAmount?: unknown
  total?: unknown
  category?: unknown
  notes?: unknown
  matchStatus?: unknown
  ocrSource?: unknown
  // base64-encoded file sent separately from the scan step
  fileBase64?: unknown
  fileName?: unknown
  fileType?: unknown
}

export async function POST(request: Request) {
  const gate = await requireUser()
  if (!gate.ok) return gate.response

  let body: CreateBody
  try {
    body = (await request.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const {
    receiptDate,
    vendor,
    pretax,
    taxAmount,
    total,
    category,
    notes,
    matchStatus,
    ocrSource,
    fileBase64,
    fileName,
    fileType,
  } = body

  if (typeof vendor !== 'string' || !vendor.trim()) {
    return NextResponse.json({ error: 'vendor required' }, { status: 400 })
  }
  if (receiptDate !== null && receiptDate !== undefined) {
    if (typeof receiptDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(receiptDate)) {
      return NextResponse.json({ error: 'receiptDate must be YYYY-MM-DD' }, { status: 400 })
    }
  }

  const { supabase } = gate

  let storagePath: string | null = null

  // Upload image to storage if provided
  if (
    typeof fileBase64 === 'string' &&
    typeof fileName === 'string' &&
    typeof fileType === 'string'
  ) {
    const receiptId = crypto.randomUUID()
    const ext = (fileName.split('.').pop() ?? 'jpg').toLowerCase()
    const datePrefix =
      typeof receiptDate === 'string'
        ? receiptDate.slice(0, 7)
        : new Date().toISOString().slice(0, 7)
    storagePath = `${datePrefix}/${receiptId}.${ext}`

    const fileBuffer = Buffer.from(fileBase64, 'base64')
    const { error: uploadError } = await supabase.storage
      .from('receipts')
      .upload(storagePath, fileBuffer, { contentType: fileType, upsert: false })

    if (uploadError) {
      return NextResponse.json(
        { error: `Storage upload failed: ${uploadError.message}` },
        { status: 500 }
      )
    }
  }

  const vendorStr = (vendor as string).trim()
  // Normalize vendor key: lowercase alphanumeric only
  const vendorKey = vendorStr.toLowerCase().replace(/[^a-z0-9]/g, '')
  const pretaxNum = typeof pretax === 'number' ? pretax : null
  const taxNum = typeof taxAmount === 'number' ? taxAmount : 0
  const totalNum =
    typeof total === 'number' ? total : pretaxNum !== null ? pretaxNum + taxNum : null
  const categoryStr = typeof category === 'string' ? category.trim() : ''
  const notesStr = typeof notes === 'string' ? notes.trim() : ''
  const ocrSourceStr =
    typeof ocrSource === 'string' && ['claude_vision', 'email_import', 'manual'].includes(ocrSource)
      ? (ocrSource as 'claude_vision' | 'email_import' | 'manual')
      : 'manual'

  // Create the business_expenses row first (if we have enough data)
  let expenseId: string | null = null
  if (pretaxNum !== null && typeof receiptDate === 'string' && receiptDate) {
    const { data: expData } = await supabase
      .from('business_expenses')
      .insert({
        date: receiptDate,
        vendor: vendorStr,
        category: categoryStr || 'Uncategorized',
        pretax: pretaxNum,
        tax_amount: taxNum,
        payment_method: 'Receipt Scan',
        hubdoc: true,
        notes: notesStr,
        business_use_pct: 100,
      })
      .select('id')
      .single()
    expenseId = expData?.id ?? null
  }

  const insert = {
    receipt_date: receiptDate ?? null,
    vendor: vendorStr,
    vendor_key: vendorKey,
    pretax: pretaxNum,
    tax_amount: taxNum,
    total: totalNum,
    category: categoryStr,
    storage_path: storagePath,
    match_status: expenseId ? 'matched' : matchStatus === 'review' ? 'review' : 'unmatched',
    notes: notesStr,
    ocr_source: ocrSourceStr,
    ...(expenseId ? { matched_expense_id: expenseId } : {}),
  }

  const { data, error } = await supabase.from('receipts').insert(insert).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(
    { receipt: data as Receipt, expenseCreated: expenseId !== null },
    { status: 201 }
  )
}
