/**
 * lib/harness/auto-pick.ts — self-prioritization for continuous coordinator mode.
 *
 * Reads docs/system-inventory.md, parses the "Top leverage gaps" table, ranks
 * modules by weight × (1 − completion%), picks the top eligible module.
 *
 * Skip criteria:
 *   - completion_pct >= 95
 *   - "Why it matters" field contains the word "blocked"
 *   - module ID is in the excludeIds list (already shipped this run)
 *
 * Logs pick reasoning to decisions_log. Never throws — returns {ok:false} on error.
 */

import fs from 'fs'
import path from 'path'
import { createServiceClient } from '@/lib/supabase/service'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CandidateModule {
  id: string
  name: string
  completion_pct: number
  weight: number
  leverage_score: number
  has_done_state: boolean
  skip_reason?: string
}

export type AutoPickResult =
  | {
      ok: true
      module_id: string
      module_name: string
      completion_pct: number
      weight: number
      leverage_score: number
      reason: string
      has_done_state: boolean
      candidates_ranked: CandidateModule[]
    }
  | { ok: false; reason: string }

// ── Inventory parsing ─────────────────────────────────────────────────────────

const INVENTORY_PATH = path.join(process.cwd(), 'docs', 'system-inventory.md')

interface RawRow {
  rank: string
  id: string
  name: string
  pct: string
  weight: string
  doneStateSpec: string
  whyItMatters: string
}

function parseTopLeverageTable(content: string): RawRow[] {
  // Find the table under "## Top leverage gaps"
  const sectionMatch = content.match(/## Top leverage gaps[\s\S]*?(?=\n## |\n---\n## |$)/)
  if (!sectionMatch) return []

  const section = sectionMatch[0]
  const rows: RawRow[] = []

  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue
    // Skip header and separator rows
    if (line.includes('Rank') || line.includes('---')) continue

    const cols = line
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c !== '')

    if (cols.length < 7) continue

    rows.push({
      rank: cols[0],
      id: cols[1].replace(/`/g, ''),
      name: cols[2],
      pct: cols[3],
      weight: cols[4],
      doneStateSpec: cols[6],
      whyItMatters: cols[7] ?? '',
    })
  }

  return rows
}

function toCandidate(row: RawRow): CandidateModule | null {
  const completion_pct = parseInt(row.pct, 10)
  const weight = parseInt(row.weight, 10)

  if (isNaN(completion_pct) || isNaN(weight) || !row.id) return null

  const leverage_score = weight * (1 - completion_pct / 100)
  const has_done_state = !row.doneStateSpec.includes('no spec yet')

  return { id: row.id, name: row.name, completion_pct, weight, leverage_score, has_done_state }
}

// ── Main pick function ────────────────────────────────────────────────────────

export async function autoPickModule(excludeIds: string[] = []): Promise<AutoPickResult> {
  let content: string
  try {
    content = fs.readFileSync(INVENTORY_PATH, 'utf-8')
  } catch (err) {
    return { ok: false, reason: `cannot read system-inventory.md: ${String(err)}` }
  }

  const rawRows = parseTopLeverageTable(content)
  if (rawRows.length === 0) {
    return { ok: false, reason: 'no rows found in "Top leverage gaps" table' }
  }

  const eligible: CandidateModule[] = []
  const skipped: CandidateModule[] = []

  for (const row of rawRows) {
    const candidate = toCandidate(row)
    if (!candidate) continue

    if (excludeIds.includes(candidate.id)) {
      skipped.push({ ...candidate, skip_reason: 'shipped this run' })
      continue
    }
    if (candidate.completion_pct >= 95) {
      skipped.push({ ...candidate, skip_reason: `completion ${candidate.completion_pct}% ≥ 95%` })
      continue
    }
    if (/\bblocked\b/i.test(row.whyItMatters)) {
      skipped.push({ ...candidate, skip_reason: 'explicitly blocked' })
      continue
    }

    eligible.push(candidate)
  }

  eligible.sort((a, b) => b.leverage_score - a.leverage_score)

  if (eligible.length === 0) {
    return {
      ok: false,
      reason: `no eligible modules — all ${rawRows.length} candidates are blocked or ≥95% complete`,
    }
  }

  const top = eligible[0]
  const reason = `weight=${top.weight} × (1 − ${top.completion_pct}%) = ${top.leverage_score.toFixed(1)}; rank 1 of ${eligible.length} eligible; ${skipped.length} skipped`

  return {
    ok: true,
    module_id: top.id,
    module_name: top.name,
    completion_pct: top.completion_pct,
    weight: top.weight,
    leverage_score: top.leverage_score,
    reason,
    has_done_state: top.has_done_state,
    candidates_ranked: eligible,
  }
}

// ── decisions_log writer ──────────────────────────────────────────────────────

export async function logPickDecision(
  pick: Extract<AutoPickResult, { ok: true }>,
  runId: string
): Promise<void> {
  try {
    const db = createServiceClient()
    await db.from('decisions_log').insert({
      topic: `continuous-mode auto-pick: ${pick.module_id}`,
      context: `Harness picked next target from system-inventory.md (continuous run ${runId.slice(0, 8)})`,
      options_considered: JSON.stringify(
        pick.candidates_ranked.slice(0, 5).map((c) => ({
          id: c.id,
          leverage: c.leverage_score.toFixed(1),
          pct: c.completion_pct,
        }))
      ),
      chosen_path: pick.module_id,
      reason: pick.reason,
      category: 'harness',
      tags: ['continuous-mode', 'auto-pick', 'self-prioritization'],
      decided_by: 'harness',
      source: 'coordinator_commands',
    })
  } catch {
    // Non-fatal — pick already recorded in coordinator_run_state
  }
}
