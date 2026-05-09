import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'

// ── DELETE /api/receipts/[id] ─────────────────────────────────────────────────

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser()
  if (!gate.ok) return gate.response

  const { id } = await params
  const { supabase } = gate

  // Fetch storage_path before deleting the record
  const { data: receipt, error: fetchError } = await supabase
    .from('receipts')
    .select('storage_path, matched_expense_id')
    .eq('id', id)
    .single()

  if (fetchError || !receipt) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
  }

  // Delete storage file if present
  if (receipt.storage_path) {
    await supabase.storage.from('receipts').remove([receipt.storage_path])
  }

  // If receipt was matched, clear hubdoc flag on the linked expense
  if (receipt.matched_expense_id) {
    await supabase
      .from('business_expenses')
      .update({ hubdoc: false })
      .eq('id', receipt.matched_expense_id)
  }

  const { error } = await supabase.from('receipts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ deleted: id })
}
