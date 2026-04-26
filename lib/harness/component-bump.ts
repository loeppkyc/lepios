import { createServiceClient } from '@/lib/supabase/service'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BumpDirective {
  id: string
  pct: number
  raw: string
}

export interface BumpResult {
  id: string
  pct: number
  success: boolean
  error?: string
}

// ── parseBumpDirectives — pure ────────────────────────────────────────────────

const BUMP_RE = /^\s*bump:\s+harness:([\w-]+)=(\d+)\s*$/i

export function parseBumpDirectives(text: string): BumpDirective[] {
  const results: BumpDirective[] = []
  for (const line of text.split('\n')) {
    const match = BUMP_RE.exec(line)
    if (!match) continue
    const pct = parseInt(match[2], 10)
    if (pct > 100) continue
    results.push({
      id: `harness:${match[1].replace(/-/g, '_')}`,
      pct,
      raw: line.trim(),
    })
  }
  return results
}

// ── applyBumps — DB writes ────────────────────────────────────────────────────

export async function applyBumps(
  directives: BumpDirective[],
  commitSha: string
): Promise<BumpResult[]> {
  if (directives.length === 0) return []

  const db = createServiceClient()
  const results: BumpResult[] = []

  for (const d of directives) {
    let success = false
    let error: string | undefined

    try {
      const { data: rows, error: dbErr } = await db
        .from('harness_components')
        .update({ completion_pct: d.pct, updated_at: new Date().toISOString() })
        .eq('id', d.id)
        .select()

      if (dbErr) {
        error = dbErr.message
      } else if (!rows || rows.length === 0) {
        error = 'no_rows_updated'
      } else {
        success = true
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'unknown'
    }

    results.push({ id: d.id, pct: d.pct, success, ...(error !== undefined ? { error } : {}) })

    if (success) {
      try {
        await db.from('agent_events').insert({
          domain: 'harness',
          action: 'harness_component_bumped',
          actor: 'deploy-gate',
          status: 'success',
          meta: { id: d.id, pct: d.pct, commit_sha: commitSha },
        })
      } catch {
        // Non-fatal
      }
    } else {
      try {
        await db.from('agent_events').insert({
          domain: 'harness',
          action: 'harness_component_bump_failed',
          actor: 'deploy-gate',
          status: 'error',
          meta: { id: d.id, pct: d.pct, commit_sha: commitSha },
        })
      } catch {
        // Non-fatal
      }
    }
  }

  return results
}
