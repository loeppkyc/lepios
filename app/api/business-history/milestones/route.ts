import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('business_milestones')
    .select('*')
    .order('milestone_date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ milestones: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { title, description, milestone_date, category } = body as Record<string, unknown>

  if (
    !title ||
    typeof title !== 'string' ||
    !milestone_date ||
    typeof milestone_date !== 'string'
  ) {
    return NextResponse.json({ error: 'title and milestone_date are required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('business_milestones')
    .insert({
      user_id: user.id,
      title: title.trim(),
      description: typeof description === 'string' ? description.trim() || null : null,
      milestone_date,
      category: typeof category === 'string' ? category : 'general',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ milestone: data }, { status: 201 })
}
