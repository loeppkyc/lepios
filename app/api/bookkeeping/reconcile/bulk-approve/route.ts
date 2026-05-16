import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'
import { createServiceClient } from '@/lib/supabase/service'

// Default threshold matches acceptance doc §Phase 1b
const DEFAULT_CONFIDENCE_THRESHOLD = 85

interface BulkApproveBody {
  confidence_threshold?: number
}

interface JeLine {
  journal_entry_id: string
  line_no: number
  account_full_name: string
  description: string | null
  debit: number
  credit: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function buildJeLines(args: {
  je_id: string
  description: string
  amount_signed: number
  source_account: string
  expense_account: string
  gst_rate: number
}): { lines: JeLine[]; total: number } {
  const { je_id, description, amount_signed, source_account, expense_account, gst_rate } = args
  const gross = Math.abs(amount_signed)
  const denom = 1 + gst_rate
  const pretaxRaw = denom > 1 ? gross / denom : gross
  const gst_amount = gst_rate > 0 ? round2(gross - round2(pretaxRaw)) : 0
  const pretax = round2(gross - gst_amount)

  const lines: JeLine[] = []
  if (amount_signed < 0) {
    // Money out: DR expense + DR GST, CR source
    lines.push({
      journal_entry_id: je_id,
      line_no: 1,
      account_full_name: expense_account,
      description,
      debit: pretax,
      credit: 0,
    })
    if (gst_amount > 0) {
      lines.push({
        journal_entry_id: je_id,
        line_no: 2,
        account_full_name: 'GST/HST Payable',
        description: null,
        debit: gst_amount,
        credit: 0,
      })
    }
    lines.push({
      journal_entry_id: je_id,
      line_no: lines.length + 1,
      account_full_name: source_account,
      description,
      debit: 0,
      credit: gross,
    })
  } else {
    // Money in: DR source, CR expense (+ CR GST)
    lines.push({
      journal_entry_id: je_id,
      line_no: 1,
      account_full_name: source_account,
      description,
      debit: gross,
      credit: 0,
    })
    lines.push({
      journal_entry_id: je_id,
      line_no: 2,
      account_full_name: expense_account,
      description,
      debit: 0,
      credit: pretax,
    })
    if (gst_amount > 0) {
      lines.push({
        journal_entry_id: je_id,
        line_no: 3,
        account_full_name: 'GST/HST Payable',
        description: null,
        debit: 0,
        credit: gst_amount,
      })
    }
  }
  return { lines, total: round2(pretax + gst_amount) }
}

export async function POST(request: Request) {
  const gate = await requireUser()
  if (!gate.ok) return gate.response

  let body: BulkApproveBody = {}
  try {
    body = (await request.json()) as BulkApproveBody
  } catch {
    // empty body is fine — use defaults
  }

  const threshold =
    typeof body.confidence_threshold === 'number'
      ? body.confidence_threshold
      : DEFAULT_CONFIDENCE_THRESHOLD

  if (threshold < 0 || threshold > 100) {
    return NextResponse.json({ error: 'confidence_threshold must be 0–100' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Fetch all eligible transactions:
  // status='needs_review', confidence >= threshold, suggested_expense_account IS NOT NULL
  const { data: eligible, error: fetchErr } = await supabase
    .from('pending_transactions')
    .select(
      'id, txn_date, source_account, description, amount_signed, suggested_expense_account, suggested_gst_rate, suggested_business_use_pct'
    )
    .eq('status', 'needs_review')
    .gte('confidence', threshold)
    .not('suggested_expense_account', 'is', null)

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }

  if (!eligible || eligible.length === 0) {
    return NextResponse.json({ approved: 0, jes_created: 0, errors: [] })
  }

  const errors: string[] = []
  let approved = 0
  let jes_created = 0

  for (const txn of eligible) {
    const txn_id = txn.id as string
    const txn_date = txn.txn_date as string
    const description = txn.description as string
    const amount_signed = Number(txn.amount_signed)
    const source_account = txn.source_account as string
    const expense_account = txn.suggested_expense_account as string
    const gst_rate = txn.suggested_gst_rate != null ? Number(txn.suggested_gst_rate) : 0
    const business_use_pct =
      txn.suggested_business_use_pct != null ? Number(txn.suggested_business_use_pct) : 100

    const je_id = crypto.randomUUID()
    const je_number = `BULK-${txn_date.replace(/-/g, '')}-${txn_id.slice(0, 6)}`

    const { lines, total } = buildJeLines({
      je_id,
      description,
      amount_signed,
      source_account,
      expense_account,
      gst_rate,
    })

    const { error: jeErr } = await supabase.from('journal_entries').insert({
      id: je_id,
      je_number,
      je_date: txn_date,
      transaction_type: 'Expense',
      name: description.slice(0, 50),
      description,
      total_debit: total,
      total_credit: total,
      source: 'lepios_auto',
      source_ref: `pending_transactions:${txn_id}`,
      notes: `Bulk-approved via /bookkeeping/reconcile/bulk-approve (threshold=${threshold})`,
    })

    if (jeErr) {
      errors.push(`txn ${txn_id}: journal_entries insert failed — ${jeErr.message}`)
      continue
    }

    const { error: lineErr } = await supabase.from('journal_entry_lines').insert(lines)
    if (lineErr) {
      // Roll back JE on line failure
      await supabase.from('journal_entries').delete().eq('id', je_id)
      errors.push(`txn ${txn_id}: journal_entry_lines insert failed — ${lineErr.message}`)
      continue
    }

    // status='manual_je' — the only valid post-approval status per the CHECK constraint.
    // Same convention as the single-approve route (approve/route.ts).
    const { error: uErr } = await supabase
      .from('pending_transactions')
      .update({
        status: 'manual_je',
        je_id,
        reviewed_at: new Date().toISOString(),
        review_notes: `Bulk-approved at confidence threshold ${threshold}`,
        suggested_expense_account: expense_account,
        suggested_gst_rate: gst_rate,
        suggested_business_use_pct: business_use_pct,
      })
      .eq('id', txn_id)

    if (uErr) {
      errors.push(`txn ${txn_id}: pending_transactions update failed — ${uErr.message}`)
      continue
    }

    approved++
    jes_created++
  }

  // F18 / AC-5: log bulk_approve event to agent_events
  await supabase.from('agent_events').insert({
    domain: 'bookkeeping',
    action: 'bulk_approve',
    actor: 'user',
    status: errors.length === 0 ? 'success' : 'partial',
    meta: {
      count: approved,
      threshold,
      jes_created,
      errors_count: errors.length,
    },
  })

  return NextResponse.json({ approved, jes_created, errors })
}
