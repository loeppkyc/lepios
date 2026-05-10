import { readFileSync } from 'fs'
import { join } from 'path'
import type { TrackResult } from '../types'

// Parses the markdown table in docs/lepios/amazon-pipeline-rollup.md.
// Looks for rows matching: | <num> | ... | <weight> | <pct>% | <contribution> | ... |
// The **Total** row is excluded. Weight denominator is fixed at 120.
const ROW_RE = /^\|\s*(\d+)\s*\|[^|]+\|\s*(\d+)\s*\|\s*(\d+)%\s*\|/

const DOC_PATH = join(process.cwd(), 'docs/lepios/amazon-pipeline-rollup.md')
const DENOMINATOR = 120

function parseLastUpdated(content: string): string | null {
  const m = content.match(/Last recomputed:\s*(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

export async function computeT2(): Promise<TrackResult> {
  const t0 = Date.now()
  try {
    const content = readFileSync(DOC_PATH, 'utf-8')
    const lastUpdated = parseLastUpdated(content)

    let totalPts = 0
    let rowsFound = 0
    for (const line of content.split('\n')) {
      const m = line.match(ROW_RE)
      if (!m) continue
      const weight = Number(m[2])
      const pct = Number(m[3])
      totalPts += (weight * pct) / 100
      rowsFound++
    }

    if (rowsFound === 0) throw new Error('No data rows found in amazon-pipeline-rollup.md')

    const rollup = (totalPts / DENOMINATOR) * 100

    // Stale if last-updated is more than 7 days ago
    const stale = lastUpdated
      ? Date.now() - new Date(lastUpdated).getTime() > 7 * 24 * 60 * 60 * 1000
      : true

    return {
      track: 't2',
      label: 'Amazon Pipeline',
      strategic_weight_pct: 36,
      source: 'doc_parse',
      rollup_pct: Math.round(rollup * 10) / 10,
      raw_pts: Math.round(totalPts * 100) / 100,
      denominator: DENOMINATOR,
      known_undercount: false,
      source_stale: stale,
      source_last_updated: lastUpdated,
      compute_ms: Date.now() - t0,
      error: null,
    }
  } catch (err) {
    return {
      track: 't2',
      label: 'Amazon Pipeline',
      strategic_weight_pct: 36,
      source: 'doc_parse',
      rollup_pct: 0,
      raw_pts: 0,
      denominator: DENOMINATOR,
      known_undercount: false,
      source_stale: true,
      source_last_updated: null,
      compute_ms: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
