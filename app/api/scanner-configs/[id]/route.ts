import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { ScannerConfig } from '@/lib/retail/types'

export const dynamic = 'force-dynamic'

// PATCH /api/scanner-configs/[id] — update a scanner config
// Body: { min_discount_pct?, keywords?, enabled? }
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.min_discount_pct === 'number') patch.min_discount_pct = body.min_discount_pct
  if ('keywords' in body) patch.keywords = typeof body.keywords === 'string' ? body.keywords || null : null
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (body.last_scanned_at !== undefined) patch.last_scanned_at = body.last_scanned_at

  const db = createServiceClient()
  const { data, error } = await db
    .from('scanner_configs')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ config: data as ScannerConfig })
}

// DELETE /api/scanner-configs/[id] — delete a scanner config
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const db = createServiceClient()
  const { error } = await db.from('scanner_configs').delete().eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
