import crypto from 'crypto'
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { logClaudeTokens } from '@/lib/ai/log-tokens'
import { logStatementImport } from '@/app/(cockpit)/statement-lines/loaders'

const MAX_CSV_CHARS = 80_000

interface ParsedLine {
  txn_date: string
  posted_date?: string | null
  description: string
  vendor_extracted?: string | null
  amount_signed: number
  is_debit: boolean
  raw_row?: Record<string, string>
}

function buildPrompt(account: string, csv: string): string {
  return `You are parsing a bank or credit card statement CSV for a Canadian small business.
Account: ${account}

Extract ALL transactions. For each row return a JSON object:
{
  "txn_date": "YYYY-MM-DD",
  "posted_date": "YYYY-MM-DD or null",
  "description": "raw description exactly as in the CSV",
  "vendor_extracted": "clean merchant name if identifiable, else null",
  "amount_signed": number (NEGATIVE = money leaving account / credit card purchase, POSITIVE = credit/refund/payment received),
  "is_debit": true if money left the account or it is a credit card purchase,
  "raw_row": { original CSV column names as keys, original values as strings }
}

Rules:
- Include ALL rows: payments, refunds, transfers, fees
- Credit cards: purchases = negative amount_signed (is_debit=true), payments back to bank = positive (is_debit=false)
- Bank accounts: withdrawals = negative (is_debit=true), deposits = positive (is_debit=false)
- Preserve description exactly as written in CSV
- Return ONLY a JSON array. No markdown, no explanation.

CSV:
${csv}`
}

export async function POST(request: Request) {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'multipart/form-data required' }, { status: 400 })
  }

  const file = formData.get('file')
  const account = formData.get('account')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field required' }, { status: 400 })
  }
  if (typeof account !== 'string' || !account.trim()) {
    return NextResponse.json({ error: 'account field required' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const fullText = await file.text()
  const csvText = fullText.slice(0, MAX_CSV_CHARS)
  const truncated = fullText.length > MAX_CSV_CHARS

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 })
  }
  const claude = new Anthropic({ apiKey })

  let raw: string
  try {
    const msg = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8096,
      messages: [{ role: 'user', content: buildPrompt(account.trim(), csvText) }],
    })
    logClaudeTokens(msg, 'statement-import')
    const block = msg.content[0]
    raw = block.type === 'text' ? block.text : ''
  } catch (e) {
    return NextResponse.json(
      { error: `AI parsing failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    )
  }

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let lines: ParsedLine[]
  try {
    const parsed: unknown = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) throw new Error('expected array')
    lines = parsed as ParsedLine[]
  } catch {
    return NextResponse.json({ error: 'AI returned unparseable response', raw }, { status: 502 })
  }

  const db = createServiceClient()

  const { data: importRow, error: importErr } = await db
    .from('bank_imports')
    .insert({
      source_file: file.name,
      source_account: account.trim(),
      total_rows: lines.length,
      status: 'completed',
    })
    .select('id')
    .single()

  if (importErr || !importRow) {
    return NextResponse.json(
      { error: importErr?.message ?? 'Failed to create import record' },
      { status: 500 }
    )
  }

  const rows = lines
    .filter((line) => line.txn_date && typeof line.amount_signed === 'number')
    .map((line) => {
      const dedup_hash = crypto
        .createHash('sha256')
        .update(`${line.txn_date}|${line.description}|${line.amount_signed}`)
        .digest('hex')
        .slice(0, 32)

      return {
        bank_import_id: importRow.id,
        source_account: account.trim(),
        txn_date: line.txn_date,
        posted_date: line.posted_date ?? null,
        description: line.description,
        vendor_extracted: line.vendor_extracted ?? null,
        amount_signed: line.amount_signed,
        amount_abs: Math.abs(line.amount_signed),
        is_debit: line.is_debit,
        raw_row: line.raw_row ?? {},
        dedup_hash,
        status: 'pending',
      }
    })

  const { error: upsertErr } = await db
    .from('pending_transactions')
    .upsert(rows, { onConflict: 'source_account,dedup_hash', ignoreDuplicates: true })

  if (upsertErr) {
    await db
      .from('bank_imports')
      .update({ status: 'error', error_message: upsertErr.message })
      .eq('id', importRow.id)
    return NextResponse.json({ error: upsertErr.message }, { status: 500 })
  }

  void logStatementImport({
    account: account.trim(),
    source_file: file.name,
    rows_total: rows.length,
    import_id: importRow.id,
  })

  return NextResponse.json({
    import_id: importRow.id,
    account: account.trim(),
    rows_total: rows.length,
    truncated,
    source_file: file.name,
  })
}
