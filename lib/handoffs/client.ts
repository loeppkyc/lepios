/**
 * LepiOS Handoff Client — persist and retrieve machine-readable session handoffs.
 *
 * Storage: Supabase session_handoffs table (migration 0012).
 * Access pattern: write once at session close, read N-most-recent at session start.
 *
 * Usage:
 *   import { saveHandoff, getRecentHandoffs, formatHandoffsForPrompt } from '@/lib/handoffs/client'
 *
 *   await saveHandoff(handoff)
 *   const ctx = formatHandoffsForPrompt(await getRecentHandoffs(3))  // → <2000 tokens
 */

import { createServiceClient } from '@/lib/supabase/service'
import type { SessionHandoff, SessionHandoffRow, SaveHandoffOptions } from './types'

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Persist a session handoff. Returns the row UUID on success, null on failure.
 * Pass `upsert: true` to overwrite an existing record with the same session_id.
 */
export async function saveHandoff(
  handoff: SessionHandoff,
  opts: SaveHandoffOptions = {},
): Promise<string | null> {
  try {
    const supabase = createServiceClient()

    const row = {
      session_id: handoff.session_id,
      schema_version: handoff.schema_version,
      occurred_at: handoff.occurred_at,
      goal: handoff.goal,
      status: handoff.status,
      sprint: handoff.sprint ?? null,
      payload: handoff as unknown as Record<string, unknown>,
    }

    const q = opts.upsert
      ? supabase
          .from('session_handoffs')
          .upsert(row, { onConflict: 'session_id' })
          .select('id')
          .single()
      : supabase.from('session_handoffs').insert(row).select('id').single()

    const { data, error } = await q
    if (error) return null
    return (data as { id: string } | null)?.id ?? null
  } catch {
    return null
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Return the N most-recent handoffs, newest first.
 */
export async function getRecentHandoffs(limit: number = 3): Promise<SessionHandoff[]> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('session_handoffs')
      .select('payload')
      .order('occurred_at', { ascending: false })
      .limit(limit)

    if (error || !data) return []
    return data.map((r) => r.payload as SessionHandoff)
  } catch {
    return []
  }
}

/**
 * Return a single handoff by session_id, or null if not found.
 */
export async function getHandoff(sessionId: string): Promise<SessionHandoff | null> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('session_handoffs')
      .select('payload')
      .eq('session_id', sessionId)
      .single()

    if (error || !data) return null
    return (data as SessionHandoffRow).payload
  } catch {
    return null
  }
}

// ── Format ────────────────────────────────────────────────────────────────────

/**
 * Render handoffs as a compact context string for LLM prompt injection.
 * Target: <2000 tokens for 3 handoffs.
 *
 * Priority order: decisions → next_steps → unresolved (critical/high) → blocking deferred items.
 * Low-signal fields (notes, score, architectural_changes) are omitted to stay under budget.
 */
export function formatHandoffsForPrompt(handoffs: SessionHandoff[]): string {
  if (!handoffs.length) return ''

  const sections: string[] = ['## Session Handoff History (most recent first)']

  for (const h of handoffs) {
    const sprint = h.sprint != null ? ` · Sprint ${h.sprint}` : ''
    sections.push(`\n### ${h.session_id}${sprint} — ${h.status.toUpperCase()}`)
    sections.push(`**Goal:** ${h.goal}`)

    if (h.decisions.length) {
      sections.push('\n**Key decisions:**')
      for (const d of h.decisions) {
        const rev = d.reversible ? '' : ' _(irreversible)_'
        sections.push(`- ${d.decision}${rev} — ${d.rationale}`)
      }
    }

    if (h.completed.length) {
      const verifiedCount = h.completed.filter((c) => c.verified).length
      sections.push(`\n**Completed:** ${h.completed.length} tasks (${verifiedCount} verified)`)
      for (const c of h.completed) {
        const tick = c.verified ? '✓' : '~'
        const art = c.artifact ? ` → \`${c.artifact}\`` : ''
        sections.push(`  ${tick} ${c.task}${art}`)
      }
    }

    const criticalUnresolved = h.unresolved.filter((u) => u.impact === 'critical' || u.impact === 'high')
    if (criticalUnresolved.length) {
      sections.push('\n**Unresolved (critical/high):**')
      for (const u of criticalUnresolved) {
        const act = u.suggested_action ? ` → ${u.suggested_action}` : ''
        sections.push(`- [${u.impact.toUpperCase()}] ${u.issue}${act}`)
      }
    }

    const blocking = h.deferred.filter((d) => d.blocking)
    if (blocking.length) {
      sections.push('\n**Blocking deferred:**')
      for (const d of blocking) {
        const gate = d.sprint_gate ? ` (${d.sprint_gate})` : ''
        sections.push(`- ${d.task}${gate} — ${d.rationale}`)
      }
    }

    if (h.next_steps.length) {
      sections.push('\n**Next steps:**')
      const sorted = [...h.next_steps].sort((a, b) => a.priority.localeCompare(b.priority))
      for (const s of sorted) {
        const pre = s.prerequisite ? ` [needs: ${s.prerequisite}]` : ''
        sections.push(`- [${s.priority.toUpperCase()}] ${s.action}${pre}`)
      }
    }
  }

  return sections.join('\n')
}
