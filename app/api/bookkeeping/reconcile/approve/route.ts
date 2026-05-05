import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

interface ApproveBody {
  id: string
  expense_account: string
  gst_rate: number
  business_use_pct: number
  learn_rule?: {
    rule_name: string
    match_pattern: string
    match_type: 'contains' | 'starts_with' | 'equals' | 'regex'
  } | null
  review_notes?: string | null
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
        line_no: lines.length + 1,
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
  const ssr = await createClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: ApproveBody
  try {
    body = (await request.json()) as ApproveBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (!body.id || !body.expense_account) {
    return NextResponse.json({ error: 'id and expense_account required' }, { status: 400 })
  }
  if (typeof body.gst_rate !== 'number' || body.gst_rate < 0 || body.gst_rate > 0.5) {
    return NextResponse.json({ error: 'gst_rate must be 0–0.5' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: txn, error: tErr } = await supabase
    .from('pending_transactions')
    .select(
      'id, txn_date, source_account, description, amount_signed, status, matched_rule_id, suggested_expense_account'
    )
    .eq('id', body.id)
    .single()

  if (tErr || !txn)
    return NextResponse.json({ error: tErr?.message ?? 'not found' }, { status: 404 })
  if (txn.status !== 'needs_review' && txn.status !== 'pending') {
    return NextResponse.json(
      { error: `cannot approve txn with status=${txn.status as string}` },
      { status: 409 }
    )
  }

  // Verify expense_account exists in COA
  const { data: acct, error: cErr } = await supabase
    .from('chart_of_accounts')
    .select('full_name')
    .eq('full_name', body.expense_account)
    .eq('is_active', true)
    .maybeSingle()
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
  if (!acct)
    return NextResponse.json(
      { error: `unknown expense_account: ${body.expense_account}` },
      { status: 400 }
    )

  // Build JE
  const je_id = crypto.randomUUID()
  const txn_date = txn.txn_date as string
  const description = txn.description as string
  const amount_signed = Number(txn.amount_signed)
  const source_account = txn.source_account as string

  const { lines, total } = buildJeLines({
    je_id,
    description,
    amount_signed,
    source_account,
    expense_account: body.expense_account,
    gst_rate: body.gst_rate,
  })

  const je_number = `MAN-${txn_date.replace(/-/g, '')}-${(txn.id as string).slice(0, 6)}`

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
    source_ref: `pending_transactions:${body.id}`,
    notes: `Approved via /bookkeeping/reconcile${body.review_notes ? ` — ${body.review_notes}` : ''}`,
  })
  if (jeErr)
    return NextResponse.json(
      { error: `journal_entries insert failed: ${jeErr.message}` },
      { status: 500 }
    )

  const { error: lineErr } = await supabase.from('journal_entry_lines').insert(lines)
  if (lineErr) {
    // Roll back JE on line failure
    await supabase.from('journal_entries').delete().eq('id', je_id)
    return NextResponse.json(
      { error: `journal_entry_lines insert failed: ${lineErr.message}` },
      { status: 500 }
    )
  }

  const { error: uErr } = await supabase
    .from('pending_transactions')
    .update({
      status: 'approved',
      je_id,
      reviewed_at: new Date().toISOString(),
      review_notes: body.review_notes ?? null,
      suggested_expense_account: body.expense_account,
      suggested_gst_rate: body.gst_rate,
      suggested_business_use_pct: body.business_use_pct,
    })
    .eq('id', body.id)
  if (uErr)
    return NextResponse.json(
      { error: `pending_transactions update failed: ${uErr.message}` },
      { status: 500 }
    )

  // Optional: learn a new vendor rule from the correction
  let ruleCreated: { id: string; rule_name: string } | null = null
  if (body.learn_rule) {
    const { rule_name, match_pattern, match_type } = body.learn_rule
    if (rule_name && match_pattern && match_type) {
      const { data: rule, error: rErr } = await supabase
        .from('vendor_rules')
        .insert({
          rule_name,
          match_pattern,
          match_type,
          source_account,
          expense_account: body.expense_account,
          gst_rate: body.gst_rate,
          business_use_pct: body.business_use_pct,
          vendor_display_name: rule_name,
          source: 'auto_learned',
          notes: `Learned from approval of pending_transactions:${body.id}`,
        })
        .select('id, rule_name')
        .single()
      if (!rErr && rule) {
        ruleCreated = { id: rule.id as string, rule_name: rule.rule_name as string }
      }
    }
  }

  return NextResponse.json({ ok: true, je_id, je_number, total, lines: lines.length, ruleCreated })
}
