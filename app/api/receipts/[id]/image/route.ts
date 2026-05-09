import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'

// Signed URLs expire after 30 minutes — long enough for the browser session,
// short enough to limit exposure if a link leaks.
const SIGNED_URL_EXPIRY_S = 30 * 60

// ── GET /api/receipts/[id]/image ──────────────────────────────────────────────
// Returns a browser redirect to a short-lived Supabase Storage signed URL.
// Used by BookkeeperView to link receipt images stored in the 'receipts' bucket.
// 404 if the receipt has no attached image.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser()
  if (!gate.ok) return gate.response

  const { id } = await params
  const { supabase } = gate

  const { data: receipt, error: fetchError } = await supabase
    .from('receipts')
    .select('storage_path')
    .eq('id', id)
    .single()

  if (fetchError || !receipt) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
  }

  if (!receipt.storage_path) {
    return NextResponse.json({ error: 'No image attached to this receipt' }, { status: 404 })
  }

  const { data: signed, error: signError } = await supabase.storage
    .from('receipts')
    .createSignedUrl(receipt.storage_path, SIGNED_URL_EXPIRY_S)

  if (signError || !signed?.signedUrl) {
    return NextResponse.json({ error: 'Could not generate image URL' }, { status: 500 })
  }

  return NextResponse.redirect(signed.signedUrl)
}
