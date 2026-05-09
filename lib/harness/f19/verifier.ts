/**
 * lib/harness/f19/verifier.ts
 *
 * F19' Slice 1 — Verifier interface + real implementation.
 *
 * The Verifier runs independently of the Optimizer (AD2). It NEVER reads
 * candidate.expected_gain_pct — it always re-fetches metrics from agent_events
 * to compute measured_gain_pct independently.
 *
 * Key behaviors:
 * - Does NOT short-circuit on first veto — collects ALL vetoes before returning
 * - Writes a decisions_log row on every call, regardless of ship verdict
 * - Maintains N=3 consecutive measurement-window persistence check before 'accepted'
 * - Sibling metric tolerance: ±5% (instrumentation heuristic — Q8, calibrate in slice 2)
 * - Any veto (including sibling_metric_regression) causes 'vetoed' status
 */

import type { CandidatePath } from './optimizer'
import { createServiceClient } from '@/lib/supabase/service'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Types ─────────────────────────────────────────────────────────────────────

export type VetoReason =
  | { kind: 'acceptance_test_failed'; test_name: string; detail: string }
  | {
      kind: 'metric_regression'
      metric_key: string
      baseline: number
      candidate: number
      tolerance_pct: number
    }
  | { kind: 'benchmark_regression'; benchmark_name: string; direction: 'up' | 'down'; pct: number }
  | { kind: 'sibling_metric_regression'; metric_key: string; baseline: number; candidate: number }
  | { kind: 'deploy_gate_blocked'; reason: string }
  | { kind: 'capability_denied'; capability: string }
  | { kind: 'unknown_target'; target: string }

export interface VerifierResult {
  ship: boolean
  vetoes: VetoReason[]
  /** Verifier's own measurements — independent re-fetch from agent_events, NOT optimizer-quoted. */
  measured_gain_pct: number | null
  /** decisions_log row id for the audit trail. */
  decision_id: string
}

export interface Verifier {
  /**
   * Runs F18 metric re-fetch + sibling metric regression checks.
   * Returns ship verdict + all vetoes (does not short-circuit on first veto).
   * Writes to decisions_log regardless of outcome.
   * Persistence: N=3 consecutive measurement windows before 'accepted'.
   */
  gate(candidate: CandidatePath): Promise<VerifierResult>
}

// ── Metric definitions for process-efficiency target ─────────────────────────
// Benchmarks from process-efficiency.ts (inline comments, lines 56-103).
// Slice 1 hardcodes these; slice 2+ reads from harness_components.metadata (Q2).

interface MetricDefinition {
  key: string
  /** Higher is better (true) or lower is better (false). */
  higherIsBetter: boolean
  /** Benchmark threshold — what the metric should be at or beyond. */
  benchmarkValue: number
}

// Known sibling metrics for process-efficiency target.
// When optimizing one metric, these must not regress beyond ±5% tolerance.
const PROCESS_EFFICIENCY_METRICS: MetricDefinition[] = [
  { key: 'queue_throughput', higherIsBetter: true, benchmarkValue: 70 }, // ≥70%
  { key: 'pickup_latency', higherIsBetter: false, benchmarkValue: 5 }, // <5 min
  { key: 'queue_depth', higherIsBetter: false, benchmarkValue: 1 }, // >1 = opportunity
  { key: 'friction_index', higherIsBetter: false, benchmarkValue: 0 }, // 0 per day
]

// Sibling tolerance: ±5% — instrumentation heuristic (Q8 resolution).
// Calibration deferred to slice 2 against ≥14 days of variance data.
const SIBLING_TOLERANCE_PCT = 5

// Persistence window requirement: N=3 consecutive windows before 'accepted'.
// Calibration deferred to slice 2.
const REQUIRED_WINDOWS = 3

// ── DB metadata types ─────────────────────────────────────────────────────────

interface F19Metadata {
  f19_status: 'proposed' | 'accepted' | 'vetoed' | 'pending'
  f19_window_count: number
  f19_veto_history?: VetoReason[][] // one entry per window
  f19_gain_history?: (number | null)[] // measured gains per window
}

// ── Metric measurement helpers ────────────────────────────────────────────────

async function measureGain(
  db: SupabaseClient,
  candidate: CandidatePath,
  windowIndex: number
): Promise<number | null> {
  const { data, error } = await db
    .from('agent_events')
    .select('context')
    .eq('action', 'f19_metric_sample')
    .limit(200)

  if (error || !data || data.length === 0) return null

  const candidateRows = data.filter((row) => {
    const ctx = row.context as Record<string, unknown> | null
    return (
      ctx &&
      ctx['candidate_id'] === candidate.id &&
      ctx['window_index'] === windowIndex &&
      ctx['metric_key'] === candidate.metric_key
    )
  })

  if (candidateRows.length > 0) {
    const gainRows = candidateRows.filter((r) => {
      const ctx = r.context as Record<string, unknown>
      return typeof ctx['gain_pct'] === 'number'
    })
    if (gainRows.length > 0) {
      const gains = gainRows.map(
        (r) => (r.context as Record<string, unknown>)['gain_pct'] as number
      )
      return median(gains)
    }

    const baselineVals = candidateRows
      .filter((r) => (r.context as Record<string, unknown>)['phase'] === 'baseline')
      .map((r) => (r.context as Record<string, unknown>)['value'] as number)
      .filter((v) => typeof v === 'number')

    const candidateVals = candidateRows
      .filter((r) => (r.context as Record<string, unknown>)['phase'] === 'candidate')
      .map((r) => (r.context as Record<string, unknown>)['value'] as number)
      .filter((v) => typeof v === 'number')

    if (baselineVals.length > 0 && candidateVals.length > 0) {
      return computeGainPct(median(baselineVals), median(candidateVals), candidate.metric_key)
    }
  }

  const allMetricRows = data.filter((row) => {
    const ctx = row.context as Record<string, unknown> | null
    return ctx && ctx['metric_key'] === candidate.metric_key
  })

  if (allMetricRows.length === 0) return null

  const allGainRows = allMetricRows.filter((r) => {
    const ctx = r.context as Record<string, unknown>
    return typeof ctx['gain_pct'] === 'number'
  })
  if (allGainRows.length > 0) {
    const gains = allGainRows.map(
      (r) => (r.context as Record<string, unknown>)['gain_pct'] as number
    )
    return median(gains)
  }

  const baselineVals = allMetricRows
    .filter((r) => (r.context as Record<string, unknown>)['phase'] === 'baseline')
    .map((r) => (r.context as Record<string, unknown>)['value'] as number)
    .filter((v) => typeof v === 'number')

  const candidateVals = allMetricRows
    .filter((r) => (r.context as Record<string, unknown>)['phase'] === 'candidate')
    .map((r) => (r.context as Record<string, unknown>)['value'] as number)
    .filter((v) => typeof v === 'number')

  if (baselineVals.length > 0 && candidateVals.length > 0) {
    return computeGainPct(median(baselineVals), median(candidateVals), candidate.metric_key)
  }

  return null
}

function computeGainPct(baseline: number, candidateVal: number, metricKey: string): number | null {
  if (baseline === 0) return null
  const metricDef = PROCESS_EFFICIENCY_METRICS.find((m) => m.key === metricKey)
  const higherIsBetter = metricDef?.higherIsBetter ?? true

  if (higherIsBetter) {
    return ((candidateVal - baseline) / Math.abs(baseline)) * 100
  } else {
    return ((baseline - candidateVal) / Math.abs(baseline)) * 100
  }
}

async function checkSiblingMetrics(
  db: SupabaseClient,
  candidate: CandidatePath,
  windowIndex: number
): Promise<VetoReason[]> {
  const vetoes: VetoReason[] = []

  if (!candidate.target.startsWith('harness:process_efficiency')) {
    return vetoes
  }

  const siblings = PROCESS_EFFICIENCY_METRICS.filter((m) => m.key !== candidate.metric_key)

  const { data, error } = await db
    .from('agent_events')
    .select('context')
    .eq('action', 'f19_metric_sample')
    .limit(200)

  if (error || !data) return vetoes

  for (const sibling of siblings) {
    const windowRows = data.filter((row) => {
      const ctx = row.context as Record<string, unknown> | null
      return (
        ctx &&
        ctx['candidate_id'] === candidate.id &&
        ctx['window_index'] === windowIndex &&
        ctx['metric_key'] === sibling.key
      )
    })

    const siblingRows =
      windowRows.length > 0
        ? windowRows
        : data.filter((row) => {
            const ctx = row.context as Record<string, unknown> | null
            return ctx && ctx['metric_key'] === sibling.key
          })

    if (siblingRows.length === 0) continue

    const baselineVals = siblingRows
      .filter((r) => (r.context as Record<string, unknown>)['phase'] === 'baseline')
      .map((r) => (r.context as Record<string, unknown>)['value'] as number)
      .filter((v) => typeof v === 'number')

    const candidateVals = siblingRows
      .filter((r) => (r.context as Record<string, unknown>)['phase'] === 'candidate')
      .map((r) => (r.context as Record<string, unknown>)['value'] as number)
      .filter((v) => typeof v === 'number')

    if (baselineVals.length === 0 || candidateVals.length === 0) continue

    const baselineMed = median(baselineVals)
    const candidateMed = median(candidateVals)

    if (baselineMed === 0) continue

    const changePct = ((candidateMed - baselineMed) / Math.abs(baselineMed)) * 100

    let isRegression: boolean
    if (sibling.higherIsBetter) {
      isRegression = changePct < -SIBLING_TOLERANCE_PCT
    } else {
      isRegression = changePct > SIBLING_TOLERANCE_PCT
    }

    if (isRegression) {
      vetoes.push({
        kind: 'sibling_metric_regression',
        metric_key: sibling.key,
        baseline: baselineMed,
        candidate: candidateMed,
      })
    }
  }

  return vetoes
}

// ── decisions_log helpers ─────────────────────────────────────────────────────

async function findExistingDecisionRow(
  db: SupabaseClient,
  candidateId: string
): Promise<{ id: string; metadata: F19Metadata } | null> {
  const { data, error } = await db
    .from('decisions_log')
    .select('id, metadata')
    .eq('source', 'f19_loop')
    .eq('category', 'process')
    .like('options_considered::text', `%${candidateId}%`)
    .order('decided_at', { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0) return null

  const row = data[0]
  const meta = (row.metadata as F19Metadata | null) ?? {
    f19_status: 'proposed',
    f19_window_count: 0,
  }

  return { id: row.id, metadata: meta }
}

async function insertDecisionRow(
  db: SupabaseClient,
  candidate: CandidatePath,
  metadata: F19Metadata,
  vetoes: VetoReason[],
  measuredGain: number | null,
  chosenPath: string
): Promise<string> {
  const { data, error } = await db
    .from('decisions_log')
    .insert({
      topic: `F19' optimization: ${candidate.target} — ${candidate.metric_key}`,
      chosen_path: chosenPath,
      category: 'process',
      source: 'f19_loop',
      decided_by: 'agent',
      options_considered: [
        {
          candidate_id: candidate.id,
          summary: candidate.summary,
          optimizer_expected_gain_pct: candidate.expected_gain_pct,
          measured_gain_pct: measuredGain,
          vetoes,
        },
      ],
      reason:
        vetoes.length > 0
          ? `vetoed: ${vetoes.map((v) => v.kind).join(', ')}`
          : `gain measured: ${measuredGain !== null ? `${measuredGain.toFixed(1)}%` : 'null'}`,
      related_files: candidate.proposed_change.related_files ?? [],
      metadata,
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`decisions_log INSERT failed: ${error?.message ?? 'no data'}`)
  }

  return data.id
}

async function updateDecisionRow(
  db: SupabaseClient,
  rowId: string,
  candidate: CandidatePath,
  metadata: F19Metadata,
  vetoes: VetoReason[],
  measuredGain: number | null,
  chosenPath: string
): Promise<void> {
  const { error } = await db
    .from('decisions_log')
    .update({
      chosen_path: chosenPath,
      metadata,
      reason:
        vetoes.length > 0
          ? `vetoed: ${vetoes.map((v) => v.kind).join(', ')}`
          : `gain measured: ${measuredGain !== null ? `${measuredGain.toFixed(1)}%` : 'null'} (window ${metadata.f19_window_count})`,
      options_considered: [
        {
          candidate_id: candidate.id,
          summary: candidate.summary,
          optimizer_expected_gain_pct: candidate.expected_gain_pct,
          measured_gain_pct: measuredGain,
          window_count: metadata.f19_window_count,
          vetoes,
        },
      ],
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId)

  if (error) {
    throw new Error(`decisions_log UPDATE failed: ${error.message}`)
  }
}

// ── Math helpers ──────────────────────────────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

// ── Status determination ──────────────────────────────────────────────────────

function determineStatus(
  vetoes: VetoReason[],
  gainHistory: (number | null)[],
  windowCount: number
): F19Metadata['f19_status'] {
  if (vetoes.length > 0) {
    return 'vetoed'
  }

  if (windowCount >= REQUIRED_WINDOWS) {
    const allWindowsGained = gainHistory.every((g) => g !== null && g > 0)
    if (allWindowsGained) {
      return 'accepted'
    }
    return 'pending'
  }

  return 'pending'
}

// ── RealVerifier implementation ───────────────────────────────────────────────

export class RealVerifier implements Verifier {
  private db: SupabaseClient

  constructor(db?: SupabaseClient) {
    this.db = db ?? createServiceClient()
  }

  async gate(candidate: CandidatePath): Promise<VerifierResult> {
    const vetoes: VetoReason[] = []

    const isKnownTarget =
      candidate.target === 'harness:process_efficiency' ||
      candidate.target.startsWith('harness:process_efficiency/')

    if (!isKnownTarget) {
      vetoes.push({ kind: 'unknown_target', target: candidate.target })
    }

    const existing = await findExistingDecisionRow(this.db, candidate.id)
    const windowCount = existing ? existing.metadata.f19_window_count + 1 : 1
    const gainHistory = existing?.metadata.f19_gain_history ?? []
    const vetoHistory = existing?.metadata.f19_veto_history ?? []

    let measuredGain: number | null = null
    if (isKnownTarget) {
      measuredGain = await measureGain(this.db, candidate, windowCount - 1)
    }

    if (isKnownTarget) {
      const siblingVetoes = await checkSiblingMetrics(this.db, candidate, windowCount - 1)
      vetoes.push(...siblingVetoes)
    }

    if (measuredGain !== null && measuredGain < -SIBLING_TOLERANCE_PCT) {
      const normalizedBaseline = 100
      const normalizedCandidate = 100 + measuredGain
      vetoes.push({
        kind: 'metric_regression',
        metric_key: candidate.metric_key,
        baseline: normalizedBaseline,
        candidate: normalizedCandidate,
        tolerance_pct: SIBLING_TOLERANCE_PCT,
      })
    }

    gainHistory.push(measuredGain)
    vetoHistory.push([...vetoes])

    const f19Status = determineStatus(vetoes, gainHistory, windowCount)

    const metadata: F19Metadata = {
      f19_status: f19Status,
      f19_window_count: windowCount,
      f19_veto_history: vetoHistory,
      f19_gain_history: gainHistory,
    }

    const ship = f19Status === 'accepted'
    let chosenPath: string
    if (ship) {
      chosenPath = candidate.summary
    } else if (f19Status === 'vetoed') {
      const vetoSummary = vetoes.map((v) => v.kind).join(', ')
      chosenPath = `rejected: ${vetoSummary || 'regression detected'}`
    } else {
      chosenPath = `pending: window ${windowCount}/${REQUIRED_WINDOWS} — ${candidate.summary}`
    }

    let decisionId: string
    if (!existing) {
      decisionId = await insertDecisionRow(
        this.db,
        candidate,
        metadata,
        vetoes,
        measuredGain,
        chosenPath
      )
    } else {
      decisionId = existing.id
      await updateDecisionRow(
        this.db,
        decisionId,
        candidate,
        metadata,
        vetoes,
        measuredGain,
        chosenPath
      )
    }

    return {
      ship,
      vetoes,
      measured_gain_pct: measuredGain,
      decision_id: decisionId,
    }
  }
}
