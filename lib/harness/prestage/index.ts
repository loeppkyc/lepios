/**
 * lib/harness/prestage/index.ts
 *
 * Pre-stager runner. Calls each enabled source, dedupes proposals against
 * existing pending/promoted rows in task_proposals, inserts new ones, and
 * auto-promotes those that meet the thresholds (confidence ≥ 0.8 AND
 * risk_score within tier ceiling).
 *
 * Spec: docs/sprint-5/overnight-autonomy-acceptance.md §4
 *
 * Module B v1 ships with one source enabled (from_failures). The rest are
 * stubbed in this registry and gated by harness_config flags so they can be
 * turned on one at a time per §6 Rollout step 5.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { riskScoreToTier, tierPermits, type RiskTier } from '@/lib/harness/risk-classifier'
import { fromFailures } from '@/lib/harness/prestage/sources/from_failures'
import type {
  ProposalDraft,
  ProposalSource,
  ProposalSourceFn,
  RunSummary,
  SourceRegistration,
} from '@/lib/harness/prestage/types'

// ---- harness_config helpers (local; same pattern as self-repair-tick) ------

type DB = ReturnType<typeof createServiceClient>

async function readConfig(db: DB, key: string): Promise<string | null> {
  try {
    const { data } = await db.from('harness_config').select('value').eq('key', key).maybeSingle()
    return (data as { value?: string } | null)?.value?.trim() ?? null
  } catch {
    return null
  }
}

const VALID_TIERS: ReadonlyArray<RiskTier> = ['off', 'low', 'medium', 'migration-allow']
async function readRiskTier(db: DB): Promise<RiskTier> {
  const raw = await readConfig(db, 'DEPLOY_GATE_RISK_TIER')
  return raw && (VALID_TIERS as readonly string[]).includes(raw) ? (raw as RiskTier) : 'low'
}

// Per-source enable flag — defaults to false unless explicitly enabled.
async function isSourceEnabled(db: DB, source: ProposalSource): Promise<boolean> {
  const raw = await readConfig(db, `PRESTAGE_SOURCE_${source.toUpperCase()}_ENABLED`)
  return raw === 'true'
}

// ---- source registry --------------------------------------------------------

async function buildRegistry(db: DB): Promise<SourceRegistration[]> {
  // isSourceEnabled is awaited up-front for each source so the harness_config
  // reads are sequential (matches the test mock ordering and avoids a thundering
  // herd of concurrent reads in production).
  const failuresEnabled = await isSourceEnabled(db, 'failures_md')
  const envEnabled = await isSourceEnabled(db, 'env_audit')
  const gpuEnabled = await isSourceEnabled(db, 'gpu_day_gap')
  const dlqEnabled = await isSourceEnabled(db, 'self_repair_dlq')
  const digestEnabled = await isSourceEnabled(db, 'morning_digest')

  const openTaskTexts = await fetchOpenTaskTexts(db)

  // Each source's enabled flag lives in harness_config. To enable a source,
  // INSERT/UPDATE row PRESTAGE_SOURCE_FAILURES_MD_ENABLED='true'.
  const registry: SourceRegistration[] = [
    {
      source: 'failures_md',
      enabled: failuresEnabled,
      run: () => fromFailures({ openTaskTexts }),
    },
    { source: 'env_audit', enabled: envEnabled, run: stubSource('env_audit') },
    { source: 'gpu_day_gap', enabled: gpuEnabled, run: stubSource('gpu_day_gap') },
    { source: 'self_repair_dlq', enabled: dlqEnabled, run: stubSource('self_repair_dlq') },
    { source: 'morning_digest', enabled: digestEnabled, run: stubSource('morning_digest') },
  ]
  return registry
}

function stubSource(_name: ProposalSource): ProposalSourceFn {
  return async () => []
}

async function fetchOpenTaskTexts(db: DB): Promise<string[]> {
  try {
    const { data } = await db
      .from('task_queue')
      .select('task')
      .in('status', ['queued', 'claimed', 'running'])
    return ((data as Array<{ task: string }> | null) ?? []).map((r) => r.task)
  } catch {
    return []
  }
}

// ---- runner -----------------------------------------------------------------

const CONFIDENCE_FLOOR = 0.8

const TIER_CEILING_FOR_AUTO_PROMOTE: Record<RiskTier, number> = {
  off: -1, // never auto-promotes from proposals
  low: 20,
  medium: 50,
  'migration-allow': 70,
}

export type PreStageRunOptions = {
  /** When true, skip all DB writes — used in tests and for `?dry=1` query param. */
  dryRun?: boolean
}

export async function runPreStage(opts: PreStageRunOptions = {}): Promise<RunSummary> {
  const db = createServiceClient()
  const tier = await readRiskTier(db)
  const ceiling = TIER_CEILING_FOR_AUTO_PROMOTE[tier]

  const registry = await buildRegistry(db)
  const summary: RunSummary = {
    ok: true,
    total_proposals_seen: 0,
    new_proposals: 0,
    auto_promoted: 0,
    per_source: {
      failures_md: { seen: 0, inserted: 0, promoted: 0 },
      env_audit: { seen: 0, inserted: 0, promoted: 0 },
      gpu_day_gap: { seen: 0, inserted: 0, promoted: 0 },
      self_repair_dlq: { seen: 0, inserted: 0, promoted: 0 },
      morning_digest: { seen: 0, inserted: 0, promoted: 0 },
      manual: { seen: 0, inserted: 0, promoted: 0 },
    },
  }

  for (const reg of registry) {
    if (!reg.enabled) continue
    const slot = summary.per_source[reg.source]

    let drafts: ProposalDraft[] = []
    try {
      drafts = await reg.run()
    } catch (err) {
      slot.error = err instanceof Error ? err.message : 'unknown'
      continue
    }
    slot.seen = drafts.length
    summary.total_proposals_seen += drafts.length

    if (drafts.length === 0) continue

    const refs = drafts.map((d) => d.source_ref).filter(Boolean) as string[]
    const existingRefs = await fetchExistingRefs(db, reg.source, refs)

    const newDrafts = drafts.filter((d) => d.source_ref && !existingRefs.has(d.source_ref))
    if (opts.dryRun) {
      // Tally as inserted/promoted without DB mutations
      slot.inserted = newDrafts.length
      summary.new_proposals += newDrafts.length
      for (const d of newDrafts) {
        if (d.confidence >= CONFIDENCE_FLOOR && d.risk_score <= ceiling) slot.promoted++
      }
      summary.auto_promoted += slot.promoted
      continue
    }

    for (const draft of newDrafts) {
      const inserted = await insertProposal(db, reg.source, draft)
      if (!inserted) continue
      slot.inserted++
      summary.new_proposals++

      const requiredTier = riskScoreToTier(draft.risk_score)
      if (draft.confidence >= CONFIDENCE_FLOOR && tierPermits(tier, requiredTier)) {
        const promoted = await promoteProposal(db, inserted.id, draft)
        if (promoted) {
          slot.promoted++
          summary.auto_promoted++
        }
      }
    }
  }

  // Single agent_events heartbeat row regardless of source counts.
  if (!opts.dryRun) {
    try {
      await db.from('agent_events').insert({
        domain: 'orchestrator',
        action: 'queue_prestage',
        actor: 'queue_prestage',
        status: 'success',
        task_type: 'queue_prestage',
        output_summary: `seen=${summary.total_proposals_seen} new=${summary.new_proposals} promoted=${summary.auto_promoted}`,
        meta: {
          configured_tier: tier,
          confidence_floor: CONFIDENCE_FLOOR,
          per_source: summary.per_source,
        },
        tags: ['prestage', 'harness', 'module_b'],
      })
    } catch {
      // swallow — heartbeat must not crash the cron
    }
  }

  return summary
}

async function fetchExistingRefs(
  db: DB,
  source: ProposalSource,
  refs: string[]
): Promise<Set<string>> {
  if (refs.length === 0) return new Set()
  try {
    const { data } = await db
      .from('task_proposals')
      .select('source_ref')
      .eq('source', source)
      .in('source_ref', refs)
      .in('status', ['pending', 'promoted'])
    return new Set(((data as Array<{ source_ref: string }> | null) ?? []).map((r) => r.source_ref))
  } catch {
    return new Set()
  }
}

async function insertProposal(
  db: DB,
  source: ProposalSource,
  draft: ProposalDraft
): Promise<{ id: string } | null> {
  try {
    const { data, error } = await db
      .from('task_proposals')
      .insert({
        task: draft.task,
        description: draft.description,
        source,
        source_ref: draft.source_ref,
        confidence: draft.confidence,
        risk_score: draft.risk_score,
        proposed_priority: draft.proposed_priority ?? 5,
        metadata: draft.metadata ?? {},
      })
      .select('id')
      .single()
    if (error || !data) return null
    return data as { id: string }
  } catch {
    return null
  }
}

async function promoteProposal(db: DB, proposalId: string, draft: ProposalDraft): Promise<boolean> {
  try {
    const { data: queued, error: insertErr } = await db
      .from('task_queue')
      .insert({
        task: draft.task,
        description: draft.description,
        priority: draft.proposed_priority ?? 5,
        status: 'queued',
        source: 'cron',
        metadata: {
          ...draft.metadata,
          prestage_proposal_id: proposalId,
          prestage_source_ref: draft.source_ref,
        },
      })
      .select('id')
      .single()
    if (insertErr || !queued) return false

    const queuedRow = queued as { id: string }

    await db
      .from('task_proposals')
      .update({
        status: 'promoted',
        promoted_task_id: queuedRow.id,
        decided_at: new Date().toISOString(),
      })
      .eq('id', proposalId)
    return true
  } catch {
    return false
  }
}
