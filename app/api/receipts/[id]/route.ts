import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ── DELETE /api/receipts/[id] ─────────────────────────────────────────────────

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  const { error } = await supabase.from('receipts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ deleted: id })
}
