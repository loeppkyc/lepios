import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const OptionSchema = z.object({
  label: z.string().min(1),
  summary: z.string().optional(),
  rejected_reason: z.string().optional(),
})

const DecisionSchema = z.object({
  topic: z.string().min(1).max(500),
  chosen_path: z.string().min(1).max(2000),
  source: z.enum([
    'redline_session',
    'morning_digest_response',
    'incident_response',
    'post_mortem',
  ]),
  context: z.string().optional(),
  options_considered: z.array(OptionSchema).optional(),
  reason: z.string().optional(),
  category: z
    .enum(['architecture', 'scope', 'data-model', 'tooling', 'process', 'principle', 'correction'])
    .default('architecture'),
  decided_by: z.enum(['colin', 'coordinator', 'agent', 'consensus']).default('colin'),
  source_ref: z.string().optional(),
  related_files: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  supersedes_id: z.string().regex(UUID_RE, 'supersedes_id must be a valid UUID').optional(),
})

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // dev: no secret configured
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = DecisionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const d = parsed.data
  const db = createServiceClient()

  const { data, error } = await db
    .from('decisions_log')
    .insert({
      topic: d.topic,
      chosen_path: d.chosen_path,
      source: d.source,
      context: d.context ?? null,
      options_considered: d.options_considered ?? [],
      reason: d.reason ?? null,
      category: d.category,
      decided_by: d.decided_by,
      source_ref: d.source_ref ?? null,
      related_files: d.related_files ?? [],
      tags: d.tags ?? [],
      supersedes_id: d.supersedes_id ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Insert failed' },
      { status: 500 }
    )
  }

  // Supersession: stamp the prior row's superseded_at after the new row lands.
  // Failure here is reported as 500 — partial success would leave the chain
  // inconsistent (two "active" decisions on the same topic).
  if (d.supersedes_id) {
    const { error: supersedeErr } = await db
      .from('decisions_log')
      .update({ superseded_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', d.supersedes_id)

    if (supersedeErr) {
      return NextResponse.json(
        { ok: false, error: `supersede failed: ${supersedeErr.message}`, id: data.id },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({ ok: true, id: data.id }, { status: 201 })
}
