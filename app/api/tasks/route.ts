import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export interface TaskRow {
  id: string
  date_added: string
  priority: 1 | 2 | 3
  task: string
  assigned_to: string | null
  status: 'pending' | 'in_progress' | 'done' | 'cancelled'
  date_done: string | null
  notes: string | null
  created_at: string
}

export interface TasksResponse {
  tasks: TaskRow[]
  counts: { pending: number; in_progress: number; done: number; cancelled: number }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') // filter by status

  let query = supabase
    .from('personal_tasks')
    .select('id, date_added, priority, task, assigned_to, status, date_done, notes, created_at')
    .order('status') // pending first
    .order('priority') // priority 1 first
    .order('date_added', { ascending: false })

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const tasks = (data ?? []) as TaskRow[]
  const counts = {
    pending:     tasks.filter((t) => t.status === 'pending').length,
    in_progress: tasks.filter((t) => t.status === 'in_progress').length,
    done:        tasks.filter((t) => t.status === 'done').length,
    cancelled:   tasks.filter((t) => t.status === 'cancelled').length,
  }

  return NextResponse.json({ tasks, counts } satisfies TasksResponse)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const body = await req.json() as Partial<TaskRow>

  if (!body.task?.trim()) return NextResponse.json({ error: 'task required' }, { status: 400 })

  const { data, error } = await supabase
    .from('personal_tasks')
    .insert({
      task: body.task.trim(),
      priority: body.priority ?? 2,
      assigned_to: body.assigned_to?.trim() || null,
      notes: body.notes?.trim() || null,
      status: 'pending',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ task: data }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const body = await req.json() as Partial<TaskRow> & { id: string }

  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.task !== undefined)        updates.task        = body.task?.trim()
  if (body.priority !== undefined)    updates.priority    = body.priority
  if (body.assigned_to !== undefined) updates.assigned_to = body.assigned_to?.trim() || null
  if (body.notes !== undefined)       updates.notes       = body.notes?.trim() || null
  if (body.status !== undefined) {
    updates.status = body.status
    if (body.status === 'done') updates.date_done = new Date().toISOString().split('T')[0]
  }

  const { error } = await supabase.from('personal_tasks').update(updates).eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase.from('personal_tasks').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
