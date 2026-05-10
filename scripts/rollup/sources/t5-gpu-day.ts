import { readFileSync } from 'fs'
import { join } from 'path'
import { createServiceClient } from '@/lib/supabase/service'
import type { TrackResult } from '../types'

const DOC_PATH = join(process.cwd(), 'docs/gpu-day-readiness.md')
// Machine-readable anchor: "## Total Readiness: XX.X / 100"
const HEADER_RE = /##\s+Total Readiness:\s*([\d.]+)\s*\/\s*100/

async function lastKnownFromEvents(): Promise<number | null> {
  try {
    const db = createServiceClient()
    const { data } = await db
      .from('agent_events')
      .select('meta')
      .eq('action', 'rollup_computed')
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const meta = (
      data as { meta?: { tracks?: Array<{ track: string; rollup_pct: number }> } } | null
    )?.meta
    const t5 = meta?.tracks?.find((t) => t.track === 't5')
    return t5?.rollup_pct ?? null
  } catch {
    return null
  }
}

export async function computeT5(): Promise<TrackResult> {
  const t0 = Date.now()
  try {
    const content = readFileSync(DOC_PATH, 'utf-8')
    const m = content.match(HEADER_RE)
    if (!m)
      throw new Error('Could not parse "## Total Readiness: X / 100" from gpu-day-readiness.md')

    const rollup_pct = Number(m[1])
    if (isNaN(rollup_pct)) throw new Error(`Parsed NaN from gpu-day-readiness.md header`)

    return {
      track: 't5',
      label: 'GPU Day Readiness',
      strategic_weight_pct: 15,
      source: 'doc_parse',
      rollup_pct,
      raw_pts: rollup_pct,
      denominator: 100,
      known_undercount: false,
      source_stale: false,
      source_last_updated: null,
      compute_ms: Date.now() - t0,
      error: null,
    }
  } catch (err) {
    // Fail-safe: fall back to last known value from agent_events
    const lastKnown = await lastKnownFromEvents()
    return {
      track: 't5',
      label: 'GPU Day Readiness',
      strategic_weight_pct: 15,
      source: 'doc_parse',
      rollup_pct: lastKnown ?? 0,
      raw_pts: lastKnown ?? 0,
      denominator: 100,
      known_undercount: false,
      source_stale: true,
      source_last_updated: null,
      compute_ms: Date.now() - t0,
      error: `parse-error: ${err instanceof Error ? err.message : String(err)}${lastKnown !== null ? ` (using last known ${lastKnown}%)` : ''}`,
    }
  }
}
