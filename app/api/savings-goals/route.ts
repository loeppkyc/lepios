import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export interface SavingsGoal {
  id: string
  name: string
  target_amount: number
  target_date: string
  linked_entry_name: string | null
  notes: string | null
  // Computed live
  currentBalance: number
  progressPct: number
  daysRemaining: number
  monthlyNeeded: number
  status: 'on_track' | 'behind' | 'achieved'
}

export interface SavingsGoalsResponse {
  goals: SavingsGoal[]
  totalTargets: number
  totalCurrent: number
  totalProgressPct: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

function isYmd(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

async function fetchBalances(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<Map<string, number>> {
  const { data } = await supabase
    .from('balance_sheet_entries')
    .select('name, balance')
    .eq('account_type', 'asset')
  const map = new Map<string, number>()
  for (const row of data ?? []) {
    map.set(row.name, Number(row.balance))
  }
  return map
}

function buildGoal(
  raw: {
    id: string
    name: string
    target_amount: string | number
    target_date: string
    linked_entry_name: string | null
    notes: string | null
  },
  balances: Map<string, number>
): SavingsGoal {
  const target = Number(raw.target_amount)
  const currentBalance = raw.linked_entry_name ? (balances.get(raw.linked_entry_name) ?? 0) : 0
  const progressPct = target > 0 ? Math.min(100, (currentBalance / target) * 100) : 0

  const today = new Date()
  const targetDate = new Date(raw.target_date + 'T00:00:00Z')
  const daysRemaining = Math.max(
    0,
    Math.ceil((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  )
  const monthsRemaining = Math.max(daysRemaining / 30, 0.0001)
  const remaining = Math.max(0, target - currentBalance)
  const monthlyNeeded = remaining > 0 ? r2(remaining / monthsRemaining) : 0

  const status: SavingsGoal['status'] =
    currentBalance >= target ? 'achieved' : daysRemaining === 0 ? 'behind' : 'on_track'

  return {
    id: raw.id,
    name: raw.name,
    target_amount: r2(target),
    target_date: raw.target_date,
    linked_entry_name: raw.linked_entry_name,
    notes: raw.notes,
    currentBalance: r2(currentBalance),
    progressPct: r2(progressPct),
    daysRemaining,
    monthlyNeeded,
    status,
  }
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: rawGoals, error } = await supabase
    .from('savings_goals')
    .select('id, name, target_amount, target_date, linked_entry_name, notes')
    .order('target_date', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const balances = await fetchBalances(supabase)
  const goals = (rawGoals ?? []).map((g) => buildGoal(g, balances))

  const totalTargets = r2(goals.reduce((s, g) => s + g.target_amount, 0))
  const totalCurrent = r2(goals.reduce((s, g) => s + g.currentBalance, 0))
  const totalProgressPct = totalTargets > 0 ? r2((totalCurrent / totalTargets) * 100) : 0

  return NextResponse.json({
    goals,
    totalTargets,
    totalCurrent,
    totalProgressPct,
  } satisfies SavingsGoalsResponse)
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try {
    const text = await request.text()
    if (text) body = JSON.parse(text) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }
  const target = Number(body.target_amount)
  if (!Number.isFinite(target) || target <= 0) {
    return NextResponse.json({ error: 'target_amount must be a positive number' }, { status: 400 })
  }
  if (!isYmd(body.target_date)) {
    return NextResponse.json({ error: 'target_date required (YYYY-MM-DD)' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const linked =
    typeof body.linked_entry_name === 'string' && body.linked_entry_name.trim().length > 0
      ? body.linked_entry_name.trim()
      : null
  const notes =
    typeof body.notes === 'string' && body.notes.trim().length > 0 ? body.notes.trim() : null

  const { data, error } = await supabase
    .from('savings_goals')
    .insert({
      name: body.name.trim(),
      target_amount: target,
      target_date: body.target_date as string,
      linked_entry_name: linked,
      notes,
    })
    .select('id, name, target_amount, target_date, linked_entry_name, notes')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const balances = await fetchBalances(supabase)
  return NextResponse.json({ goal: buildGoal(data, balances) })
}

export async function PATCH(request: Request) {
  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof body.id !== 'string' || !body.id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim().length > 0) updates.name = body.name.trim()
  if (body.target_amount !== undefined) {
    const v = Number(body.target_amount)
    if (!Number.isFinite(v) || v <= 0) {
      return NextResponse.json(
        { error: 'target_amount must be a positive number' },
        { status: 400 }
      )
    }
    updates.target_amount = v
  }
  if (body.target_date !== undefined) {
    if (!isYmd(body.target_date)) {
      return NextResponse.json({ error: 'target_date must be YYYY-MM-DD' }, { status: 400 })
    }
    updates.target_date = body.target_date
  }
  if (body.linked_entry_name !== undefined) {
    updates.linked_entry_name =
      typeof body.linked_entry_name === 'string' && body.linked_entry_name.trim().length > 0
        ? body.linked_entry_name.trim()
        : null
  }
  if (body.notes !== undefined) {
    updates.notes =
      typeof body.notes === 'string' && body.notes.trim().length > 0 ? body.notes.trim() : null
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
  }
  updates.updated_at = new Date().toISOString()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('savings_goals')
    .update(updates)
    .eq('id', body.id)
    .select('id, name, target_amount, target_date, linked_entry_name, notes')
    .single()
  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'goal not found' }, { status: 404 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const balances = await fetchBalances(supabase)
  return NextResponse.json({ goal: buildGoal(data, balances) })
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase.from('savings_goals').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
