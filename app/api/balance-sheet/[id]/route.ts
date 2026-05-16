import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/balance-sheet/[id]
 *
 * Deletes a balance_sheet_entries row.
 * - Auth: user session (same as GET/PATCH on the parent route)
 * - Returns 204 on success
 * - Returns 404 if the row does not exist
 * - Returns 403 if the row has source='auto_sync' (managed by the daily cron)
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Check row exists and get source
  const { data: row, error: fetchErr } = await supabase
    .from('balance_sheet_entries')
    .select('id, source')
    .eq('id', id)
    .single()

  if (fetchErr || !row) {
    return NextResponse.json({ error: 'Row not found' }, { status: 404 })
  }

  // Protect auto-sync rows
  if (row.source === 'auto_sync') {
    return NextResponse.json(
      {
        error: 'This row is managed automatically. Remove the auto_sync cron to stop updating it.',
      },
      { status: 403 }
    )
  }

  const { error: deleteErr } = await supabase.from('balance_sheet_entries').delete().eq('id', id)

  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 })

  return new NextResponse(null, { status: 204 })
}
