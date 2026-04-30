/**
 * POST /api/metrics/start -- open a build_metrics row.
 *
 * Bearer CRON_SECRET protected (same pattern as /api/metrics/digest).
 * Returns 409 on task_id collision -- estimates are not silently overwritten.
 *
 * Body: { task_id, week, day_label, description?, estimate_claude_days?,
 *         estimate_source?, task_type? }
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const CRON_SECRET = process.env.CRON_SECRET
const TASK_TYPES = ['port', 'new_build', 'migration', 'fix'] as const
const ESTIMATE_SOURCES = ['claude_chat', 'self', 'revised'] as const

export async function POST(request: Request) {
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    task_id,
    week,
    day_label,
    description,
    estimate_claude_days,
    estimate_source,
    task_type,
  } = body as Record<string, unknown>

  if (typeof task_id !== 'string' || !task_id) {
    return NextResponse.json({ error: 'task_id required (string)' }, { status: 400 })
  }
  if (typeof week !== 'number' || !Number.isInteger(week)) {
    return NextResponse.json({ error: 'week required (int)' }, { status: 400 })
  }
  if (typeof day_label !== 'string' || !day_label) {
    return NextResponse.json({ error: 'day_label required (string)' }, { status: 400 })
  }
  if (estimate_source !== undefined && !ESTIMATE_SOURCES.includes(estimate_source as never)) {
    return NextResponse.json(
      { error: `estimate_source must be one of: ${ESTIMATE_SOURCES.join(', ')}` },
      { status: 400 }
    )
  }
  if (task_type !== undefined && !TASK_TYPES.includes(task_type as never)) {
    return NextResponse.json(
      { error: `task_type must be one of: ${TASK_TYPES.join(', ')}` },
      { status: 400 }
    )
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase
    .from('build_metrics')
    .insert({
      task_id,
      week,
      day_label,
      description: description ?? null,
      estimate_claude_days: estimate_claude_days ?? null,
      estimate_source: estimate_source ?? null,
      task_type: task_type ?? null,
      started_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    const status = error.code === '23505' ? 409 : 500
    return NextResponse.json({ error: error.message, code: error.code }, { status })
  }

  return NextResponse.json({ ok: true, row: data })
}
