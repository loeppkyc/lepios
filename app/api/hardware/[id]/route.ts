import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const VALID_CATEGORIES = ['CPU', 'GPU', 'RAM', 'Storage', 'Cooling', 'Chassis', 'PSU', 'Motherboard', 'Peripherals', 'Other'] as const
const VALID_STATUSES = ['planned', 'ordered', 'received', 'installed'] as const

interface RouteCtx {
  params: Promise<{ id: string }>
}

// ── PATCH /api/hardware/[id] ───────────────────────────────────────────────────
// Update one or more fields on a hardware component.

export async function PATCH(request: Request, ctx: RouteCtx) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}

  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    update.name = name
  }
  if ('category' in body) {
    const category = typeof body.category === 'string' ? body.category : ''
    if (!(VALID_CATEGORIES as readonly string[]).includes(category)) {
      return NextResponse.json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` }, { status: 400 })
    }
    update.category = category
  }
  if ('status' in body) {
    const status = typeof body.status === 'string' ? body.status : ''
    if (!(VALID_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 })
    }
    update.status = status
  }
  if ('budget_cad' in body) {
    update.budget_cad = body.budget_cad != null ? Number(body.budget_cad) : null
  }
  if ('actual_cad' in body) {
    update.actual_cad = body.actual_cad != null ? Number(body.actual_cad) : null
  }
  if ('product_url' in body) {
    update.product_url = typeof body.product_url === 'string' && body.product_url.trim() ? body.product_url.trim() : null
  }
  if ('notes' in body) {
    update.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  update.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('hardware_components')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ component: data })
}

// ── DELETE /api/hardware/[id] ──────────────────────────────────────────────────
// Delete a hardware component by id.

export async function DELETE(_request: Request, ctx: RouteCtx) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params

  const { error } = await supabase
    .from('hardware_components')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
