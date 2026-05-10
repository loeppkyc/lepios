// POST /api/admin/rollup/refresh
//
// Recomputes the LepiOS portfolio rollup from live sources:
//   T1/T1b — harness_components + product_components (DB)
//   T2      — docs/lepios/amazon-pipeline-rollup.md (parse)
//   T3      — task_queue local-sales check (hardcoded fallback)
//   T4      — streamlit_modules (DB, known undercount until port_status sync)
//   T5      — docs/gpu-day-readiness.md (parse)
//
// Patches docs/standing/master-rollup.md between AUTO-ROLLUP fences.
// Logs rollup_computed to agent_events for delta tracking.
//
// Auth: Bearer $CRON_SECRET (required — this writes to a canonical doc).

import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { computeRollup } from '@/scripts/rollup/compute'
import { patchMasterRollup } from '@/scripts/rollup/render-master-rollup'
import { buildRollupDigestLine } from '@/scripts/rollup/digest-line'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const report = await computeRollup()
  const { patched, error: patchError } = patchMasterRollup(report)
  const digestLine = buildRollupDigestLine(report)

  return NextResponse.json({
    ok: true,
    strategic_pct: report.strategic_pct,
    delta_vs_prev: report.delta_vs_prev,
    sources_polled: report.sources_polled,
    errors_per_track: report.errors_per_track,
    total_compute_ms: report.total_compute_ms,
    doc_patched: patched,
    doc_patch_error: patchError,
    digest_line: digestLine,
    tracks: report.tracks.map((t) => ({
      track: t.track,
      label: t.label,
      rollup_pct: t.rollup_pct,
      known_undercount: t.known_undercount,
      source_stale: t.source_stale,
      error: t.error,
    })),
  })
}
