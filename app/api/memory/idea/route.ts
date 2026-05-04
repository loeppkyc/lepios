import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/service'
import { requireCronSecret } from '@/lib/auth/cron-secret'

export const dynamic = 'force-dynamic'

const IdeaSchema = z.object({
  title: z.string().min(1).max(500),
  body: z.string().max(10000).optional(),
  summary: z.string().max(200).optional(),
  source: z.enum([
    'manual_telegram',
    'manual_api',
    'manual_cli_backlog',
    'scout_agent',
    'session_decision_overflow',
  ]),
  source_ref: z.string().optional(),
  tags: z.array(z.string()).optional(),
  score: z.number().min(0).max(1).optional(),
  status: z.enum(['parked', 'active']).optional(),
})

export async function POST(request: Request): Promise<NextResponse> {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = IdeaSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const d = parsed.data
  const db = createServiceClient()

  const { data, error } = await db
    .from('idea_inbox')
    .insert({
      title: d.title,
      body: d.body ?? null,
      summary: d.summary ?? null,
      source: d.source,
      source_ref: d.source_ref ?? null,
      tags: d.tags ?? [],
      score: d.score ?? 0.5,
      status: d.status ?? 'parked',
    })
    .select('id, status')
    .single()

  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Insert failed' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, id: data.id, status: data.status }, { status: 201 })
}
