/**
 * POST /api/metrics/finish -- close a build_metrics row.
 *
 * Bearer CRON_SECRET protected.
 * Returns 404 if task_id not found.
 *
 * Body: { task_id, active_minutes?, parallel_windows?, clear_resets?,
 *         reviewer_rejections?, first_try_pass?, notes? }
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireCronSecret } from '@/lib/auth/cron-secret'

export async function POST(request: Request) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    task_id,
    active_minutes,
    parallel_windows,
    clear_resets,
    reviewer_rejections,
    first_try_pass,
    notes,
  } = body as Record<string, unknown>

  if (typeof task_id !== 'string' || !task_id) {
    return NextResponse.json({ error: 'task_id required (string)' }, { status: 400 })
  }

  const update: Record<string, unknown> = {
    completed_at: new Date().toISOString(),
  }
  if (active_minutes !== undefined) update.active_minutes = active_minutes
  if (parallel_windows !== undefined) update.parallel_windows = parallel_windows
  if (clear_resets !== undefined) update.clear_resets = clear_resets
  if (reviewer_rejections !== undefined) update.reviewer_rejections = reviewer_rejections
  if (first_try_pass !== undefined) update.first_try_pass = first_try_pass
  if (notes !== undefined) update.notes = notes

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase
    .from('build_metrics')
    .update(update)
    .eq('task_id', task_id)
    .select()
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: `task_id not found: ${task_id}` }, { status: 404 })
  }

  return NextResponse.json({ ok: true, row: data })
}
