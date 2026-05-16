import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// ── GET /api/hardware ──────────────────────────────────────────────────────────
// List all hardware components ordered by added_at DESC.

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('hardware_components')
    .select('id, name, category, status, budget_cad, actual_cad, product_url, notes, added_at, updated_at')
    .order('added_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ components: data ?? [] })
}

// ── POST /api/hardware ─────────────────────────────────────────────────────────
// Create a new hardware component.

const VALID_CATEGORIES = ['CPU', 'GPU', 'RAM', 'Storage', 'Cooling', 'Chassis', 'PSU', 'Motherboard', 'Peripherals', 'Other'] as const
const VALID_STATUSES = ['planned', 'ordered', 'received', 'installed'] as const

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const category = typeof body.category === 'string' ? body.category : ''
  const status = typeof body.status === 'string' ? body.status : 'planned'

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!(VALID_CATEGORIES as readonly string[]).includes(category)) {
    return NextResponse.json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` }, { status: 400 })
  }
  if (!(VALID_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 })
  }

  const budget_cad = body.budget_cad != null ? Number(body.budget_cad) : null
  const actual_cad = body.actual_cad != null ? Number(body.actual_cad) : null

  if (budget_cad !== null && !Number.isFinite(budget_cad)) {
    return NextResponse.json({ error: 'budget_cad must be a number' }, { status: 400 })
  }
  if (actual_cad !== null && !Number.isFinite(actual_cad)) {
    return NextResponse.json({ error: 'actual_cad must be a number' }, { status: 400 })
  }

  const product_url = typeof body.product_url === 'string' && body.product_url.trim() ? body.product_url.trim() : null
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null

  const { data, error } = await supabase
    .from('hardware_components')
    .insert({
      // SPRINT5-GATE: replace with profiles table lookup before adding any second auth user
      person_handle: 'colin',
      name,
      category,
      status,
      budget_cad,
      actual_cad,
      product_url,
      notes,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ component: data }, { status: 201 })
}
