import type { RollupReport } from './types'

// Returns a single digest line for inclusion in morning_digest.
// Wiring into lib/orchestrator/digest.ts is done separately (that file is in
// another window's scope). Import this from the digest module when that window closes.
export function buildRollupDigestLine(report: RollupReport): string {
  const { strategic_pct, delta_vs_prev, tracks, errors_per_track } = report

  const deltaStr =
    delta_vs_prev !== null
      ? delta_vs_prev >= 0
        ? ` (+${delta_vs_prev.toFixed(1)})`
        : ` (${delta_vs_prev.toFixed(1)})`
      : ''

  const t = (id: string) => tracks.find((tr) => tr.track === id)

  const trackSummary = ['t1', 't1b', 't2', 't4', 't5']
    .map((id) => {
      const tr = t(id)
      if (!tr) return null
      const flag = tr.error ? '⚠' : tr.known_undercount || tr.source_stale ? '~' : ''
      return `${tr.track.toUpperCase()}:${tr.rollup_pct.toFixed(0)}%${flag}`
    })
    .filter(Boolean)
    .join(' ')

  const errNote = errors_per_track > 0 ? ` ⚠ ${errors_per_track} track error(s)` : ''

  return `Rollup: ${strategic_pct.toFixed(1)}% strategic${deltaStr} · ${trackSummary}${errNote}`
}
