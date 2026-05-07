import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export type MilestoneCategory =
  | 'housing'
  | 'vehicle'
  | 'debt'
  | 'family'
  | 'business'
  | 'health'
  | 'other'

const VALID_CATEGORIES: ReadonlySet<MilestoneCategory> = new Set([
  'housing',
  'vehicle',
  'debt',
  'family',
  'business',
  'health',
  'other',
])

const MAX_TITLE_LENGTH = 200
const MAX_DESCRIPTION_LENGTH = 2000

export interface LifeMilestone {
  id: string
  milestone_date: string
  category: MilestoneCategory
  title: string
  description: string | null
  money_impact: number | null
  created_at: string
  updated_at: string
}

function isYmd(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function isValidCategory(s: unknown): s is MilestoneCategory {
  return typeof s === 'string' && VALID_CATEGORIES.has(s as MilestoneCategory)
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('life_milestones')
    .select(
      'id, milestone_date, category, title, description, money_impact, created_at, updated_at'
    )
    .order('milestone_date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const milestones: LifeMilestone[] = (data ?? []).map((m) => ({
    ...m,
    money_impact: m.money_impact == null ? null : Number(m.money_impact),
  }))

  return NextResponse.json({ milestones })
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try {
    const text = await request.text()
    if (text) body = JSON.parse(text) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (!isYmd(body.milestone_date)) {
    return NextResponse.json({ error: 'milestone_date required (YYYY-MM-DD)' }, { status: 400 })
  }
  if (!isValidCategory(body.category)) {
    return NextResponse.json(
      { error: `category must be one of: ${[...VALID_CATEGORIES].join(', ')}` },
      { status: 400 }
    )
  }
  if (typeof body.title !== 'string' || body.title.trim().length === 0) {
    return NextResponse.json({ error: 'title required' }, { status: 400 })
  }
  const title = body.title.trim()
  if (title.length > MAX_TITLE_LENGTH) {
    return NextResponse.json(
      { error: `title exceeds ${MAX_TITLE_LENGTH} char limit` },
      { status: 400 }
    )
  }

  let description: string | null = null
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string') {
      return NextResponse.json({ error: 'description must be string or null' }, { status: 400 })
    }
    const trimmed = body.description.trim()
    if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
      return NextResponse.json(
        { error: `description exceeds ${MAX_DESCRIPTION_LENGTH} char limit` },
        { status: 400 }
      )
    }
    description = trimmed.length > 0 ? trimmed : null
  }

  let moneyImpact: number | null = null
  if (body.money_impact !== undefined && body.money_impact !== null && body.money_impact !== '') {
    const v = Number(body.money_impact)
    if (!Number.isFinite(v)) {
      return NextResponse.json(
        { error: 'money_impact must be a finite number or null' },
        { status: 400 }
      )
    }
    moneyImpact = v
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('life_milestones')
    .insert({
      milestone_date: body.milestone_date as string,
      category: body.category as string,
      title,
      description,
      money_impact: moneyImpact,
    })
    .select(
      'id, milestone_date, category, title, description, money_impact, created_at, updated_at'
    )
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ milestone: data })
}

export async function PATCH(request: Request) {
  let body: Record<string, unknown> = {}
  try {
    const text = await request.text()
    if (text) body = JSON.parse(text) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (typeof body.id !== 'string' || !body.id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}

  if (body.milestone_date !== undefined) {
    if (!isYmd(body.milestone_date)) {
      return NextResponse.json({ error: 'milestone_date must be YYYY-MM-DD' }, { status: 400 })
    }
    updates.milestone_date = body.milestone_date
  }

  if (body.category !== undefined) {
    if (!isValidCategory(body.category)) {
      return NextResponse.json({ error: 'invalid category' }, { status: 400 })
    }
    updates.category = body.category
  }

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      return NextResponse.json({ error: 'title required' }, { status: 400 })
    }
    const t = body.title.trim()
    if (t.length > MAX_TITLE_LENGTH) {
      return NextResponse.json(
        { error: `title exceeds ${MAX_TITLE_LENGTH} char limit` },
        { status: 400 }
      )
    }
    updates.title = t
  }

  if (body.description !== undefined) {
    if (body.description === null) {
      updates.description = null
    } else if (typeof body.description !== 'string') {
      return NextResponse.json({ error: 'description must be string or null' }, { status: 400 })
    } else {
      const t = body.description.trim()
      if (t.length > MAX_DESCRIPTION_LENGTH) {
        return NextResponse.json(
          { error: `description exceeds ${MAX_DESCRIPTION_LENGTH} char limit` },
          { status: 400 }
        )
      }
      updates.description = t.length > 0 ? t : null
    }
  }

  if (body.money_impact !== undefined) {
    if (body.money_impact === null || body.money_impact === '') {
      updates.money_impact = null
    } else {
      const v = Number(body.money_impact)
      if (!Number.isFinite(v)) {
        return NextResponse.json(
          { error: 'money_impact must be a finite number or null' },
          { status: 400 }
        )
      }
      updates.money_impact = v
    }
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
    .from('life_milestones')
    .update(updates)
    .eq('id', body.id)
    .select(
      'id, milestone_date, category, title, description, money_impact, created_at, updated_at'
    )
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'milestone not found' }, { status: 404 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ milestone: data })
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

  const { error } = await supabase.from('life_milestones').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
