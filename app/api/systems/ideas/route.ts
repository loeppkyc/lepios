import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'

export const revalidate = 0

export type IdeaStatus = 'idea' | 'active' | 'shipped' | 'parked'
export type IdeaSource = 'claude' | 'colin'

export interface Idea {
  id: string
  title: string
  description: string | null
  status: IdeaStatus
  source: IdeaSource
  created_at: string
  updated_at: string
}

export interface IdeasResponse {
  ideas: Idea[]
  fetchedAt: string
}

export async function GET() {
  const gate = await requireUser({ minRole: 'business' })
  if (!gate.ok) return gate.response

  const { data, error } = await gate.supabase
    .from('ideas')
    .select('id, title, description, status, source, created_at, updated_at')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ideas: data ?? [], fetchedAt: new Date().toISOString() })
}

export async function POST(request: NextRequest) {
  const gate = await requireUser({ minRole: 'business' })
  if (!gate.ok) return gate.response

  const body = (await request.json().catch(() => null)) as {
    title?: string
    description?: string
    status?: IdeaStatus
    source?: IdeaSource
  } | null

  if (!body?.title?.trim()) {
    return NextResponse.json({ error: 'title_required' }, { status: 400 })
  }

  const VALID_STATUSES: IdeaStatus[] = ['idea', 'active', 'shipped', 'parked']
  const VALID_SOURCES: IdeaSource[] = ['claude', 'colin']

  const status: IdeaStatus = VALID_STATUSES.includes(body.status as IdeaStatus)
    ? (body.status as IdeaStatus)
    : 'idea'
  const source: IdeaSource = VALID_SOURCES.includes(body.source as IdeaSource)
    ? (body.source as IdeaSource)
    : 'colin'

  const { data, error } = await gate.supabase
    .from('ideas')
    .insert({
      title: body.title.trim(),
      description: body.description?.trim() ?? null,
      status,
      source,
    })
    .select('id, title, description, status, source, created_at, updated_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  const gate = await requireUser({ minRole: 'business' })
  if (!gate.ok) return gate.response

  const body = (await request.json().catch(() => null)) as {
    id?: string
    status?: IdeaStatus
  } | null

  if (!body?.id || !body?.status) {
    return NextResponse.json({ error: 'id_and_status_required' }, { status: 400 })
  }

  const VALID_STATUSES: IdeaStatus[] = ['idea', 'active', 'shipped', 'parked']
  if (!VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
  }

  const { data, error } = await gate.supabase
    .from('ideas')
    .update({ status: body.status, updated_at: new Date().toISOString() })
    .eq('id', body.id)
    .select('id, title, description, status, source, created_at, updated_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
