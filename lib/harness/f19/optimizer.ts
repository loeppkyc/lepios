/**
 * lib/harness/f19/optimizer.ts
 *
 * F19' Slice 1 — Optimizer interface + stub implementation.
 *
 * The Optimizer proposes candidate improvement paths for a given target component.
 * CRITICAL: Optimizer MUST NOT call Verifier on its own output (AD2 violation).
 * The Verifier runs independently in a separate session, with decisions_log as the seam.
 *
 * Slice 1 ships a stub implementation that always returns one hardcoded candidate.
 * Smart optimizer (pattern recognition, ML) is deferred to slice 4+.
 */

// ComponentSlug type: matches a row slug in harness_components.
// TODO: move to lib/harness/types.ts once that file is created.
type ComponentSlug = string

export type { ComponentSlug }

export interface CandidatePath {
  /** Stable identifier for the proposed change. */
  id: string
  /** Component being optimized (must match a row in harness_components). */
  target: ComponentSlug
  /** Human-readable summary — used in decisions_log.chosen_path. */
  summary: string
  /**
   * Expected gain percentage on the optimized metric, optimizer's estimate.
   * VERIFIER MUST NEVER TRUST THIS — it always re-fetches from agent_events.
   */
  expected_gain_pct: number
  /** The metric the candidate aims to improve. */
  metric_key: string
  /** Concrete change description. May reference files, queries, config. */
  proposed_change: {
    kind: 'code' | 'config' | 'process' | 'schema'
    diff_summary: string
    related_files?: string[]
  }
  /** Optimizer's reasoning trail. Goes to decisions_log.options_considered. */
  rationale: string
}

export interface OptimizerInput {
  target: ComponentSlug
  /** Floor — paths under this expected_gain_pct are not surfaced. Default 20. */
  min_gain_pct?: number
  /** Optional: bias toward speed | cost | quality. Default 'speed'. */
  axis?: 'speed' | 'cost' | 'quality'
}

export interface Optimizer {
  /**
   * Reads recent agent_events + F18 metrics for the target.
   * Returns up to N candidate paths, ranked by expected_gain_pct desc.
   * MUST NOT call Verifier on its own output (AD2).
   */
  propose(input: OptimizerInput): Promise<CandidatePath[]>
}

// ── Stub implementation (Slice 1) ─────────────────────────────────────────────
//
// Always returns one hardcoded candidate targeting the process-efficiency
// friction signal. The candidate proposes spawning a coordinator at queue depth
// >= 2 instead of waiting for the next nightly digest.
//
// expected_gain_pct = 50 (exceeds any min_gain_pct <= 50).
// Slice 4+ replaces this with a real optimizer that reads agent_events patterns.

const STUB_CANDIDATE: CandidatePath = {
  id: 'proc-eff-queue-depth-spawn-v1',
  target: 'harness:process_efficiency',
  summary: 'spawn coordinator at queue depth >= 2 instead of waiting for digest',
  expected_gain_pct: 50,
  metric_key: 'queue_depth',
  proposed_change: {
    kind: 'process',
    diff_summary:
      'Update task pickup cron: when queue depth >= 2 unblocked tasks, spawn a second coordinator ' +
      'immediately rather than waiting for morning_digest to surface the parallelism opportunity. ' +
      'Eliminates F-L15-class serialization waste during multi-task windows.',
    related_files: ['lib/harness/task-pickup.ts', 'lib/harness/process-efficiency.ts'],
  },
  rationale:
    'F-L15 (2026-04-27): single-window under-utilization while concurrency is felt out. ' +
    'S-L10 (2026-04-26): 3 active + 1 buffer is optimal; delay starts at queue depth >= 2. ' +
    'Estimated 50% reduction in queue_depth metric (tasks waiting → tasks running). ' +
    'No code changes required — process-layer change only.',
}

export class StubOptimizer implements Optimizer {
  async propose(input: OptimizerInput): Promise<CandidatePath[]> {
    const minGain = input.min_gain_pct ?? 20

    // Filter: only surface candidates whose expected gain meets the floor.
    if (STUB_CANDIDATE.expected_gain_pct < minGain) {
      return []
    }

    return [STUB_CANDIDATE]
  }
}
