/**
 * GET /api/cron/queue-prestage
 *
 * Daily cron entry point for the queue pre-stager (Module B).
 * Schedule: 0 21 * * * (21:00 UTC = 14:00 MT) — see vercel.json (seam,
 * added separately under [seam-approved] commit).
 *
 * Module B ships with all sources DISABLED by default. Enable per source via
 * harness_config keys: PRESTAGE_SOURCE_FAILURES_MD_ENABLED='true', etc.
 *
 * Spec: docs/sprint-5/overnight-autonomy-acceptance.md §4
 * F22: uses requireCronSecret from lib/auth/cron-secret.ts
 */

import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { runPreStage } from '@/lib/harness/prestage'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request): Promise<NextResponse> {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const url = new URL(request.url)
  const dryRun = url.searchParams.get('dry') === '1'

  try {
    const summary = await runPreStage({ dryRun })
    return NextResponse.json({ ...summary, dry_run: dryRun })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 }
    )
  }
}
