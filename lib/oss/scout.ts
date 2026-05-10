import { createServiceClient } from '@/lib/supabase/service'
import { scoreModuleDeps, type AuditVerdict } from '@/lib/oss-radar/audit'
import { postMessage } from '@/lib/orchestrator/telegram'
import type { TaskRow } from '@/lib/harness/task-pickup'

export type ScoutDecision = 'pass' | 'warn' | 'block'

export interface ScoutVerdict {
  dep: string
  verdict: AuditVerdict
  lepios_alternative?: string
}

export interface ScoutResult {
  decision: ScoutDecision
  verdicts: ScoutVerdict[]
  scorer: 'oss_packages_cache' | 'rule_based_v1' | 'no_deps'
  latency_ms: number
}

export async function scoutCheck(task: TaskRow): Promise<ScoutResult> {
  const start = Date.now()
  const raw = task.metadata?.external_deps
  const deps: string[] = Array.isArray(raw) ? (raw as string[]) : []

  if (deps.length === 0) {
    return { decision: 'pass', verdicts: [], scorer: 'no_deps', latency_ms: Date.now() - start }
  }

  // Query oss_packages for already-audited deps — cache hit avoids re-running rule_based_v1
  const db = createServiceClient()
  const cachedVerdicts: Record<string, { verdict: AuditVerdict; lepios_alternative: string | null }> = {}
  try {
    const { data } = await db
      .from('oss_packages')
      .select('name, fit_score, lepios_alternative')
      .in('name', deps)
      .eq('audit_status', 'done')
    for (const row of data ?? []) {
      const score = row.fit_score ?? 100
      const verdict: AuditVerdict =
        score < 30 ? 'replace' : score < 50 ? 'fork-extend' : score < 80 ? 'absorb-patterns' : 'keep'
      cachedVerdicts[row.name] = { verdict, lepios_alternative: row.lepios_alternative ?? null }
    }
  } catch {
    // Cache miss on DB error — fall through to rule_based_v1
  }

  const uncachedDeps = deps.filter((d) => !(d in cachedVerdicts))
  const ruled = uncachedDeps.length > 0 ? scoreModuleDeps(uncachedDeps) : null

  const verdicts: ScoutVerdict[] = []

  for (const [dep, c] of Object.entries(cachedVerdicts)) {
    verdicts.push({ dep, verdict: c.verdict, ...(c.lepios_alternative ? { lepios_alternative: c.lepios_alternative } : {}) })
  }
  if (ruled) {
    for (const [dep, v] of Object.entries(ruled.dep_verdicts)) {
      verdicts.push({ dep, verdict: v, ...(ruled.lepios_alternatives[dep] ? { lepios_alternative: ruled.lepios_alternatives[dep] } : {}) })
    }
  }

  const allVerdicts = verdicts.map((v) => v.verdict)
  const decision: ScoutDecision = allVerdicts.some((v) => v === 'replace')
    ? 'block'
    : allVerdicts.some((v) => v === 'fork-extend' || v === 'absorb-patterns')
    ? 'warn'
    : 'pass'

  const scorer: ScoutResult['scorer'] =
    uncachedDeps.length === 0 ? 'oss_packages_cache' : 'rule_based_v1'

  return { decision, verdicts, scorer, latency_ms: Date.now() - start }
}

// Fire-and-forget Telegram block alert — called by pickup-runner on scout block.
export async function sendScoutBlockAlert(task: TaskRow, result: ScoutResult): Promise<void> {
  const blocked = result.verdicts.filter((v) => v.verdict === 'replace')
  const lines = [
    `🚫 Task pickup blocked — OSS Scout`,
    `Task: ${task.task.slice(0, 80)}${task.task.length > 80 ? '...' : ''}`,
    `ID: ${task.id.slice(0, 8)}`,
    ``,
    ...blocked.map(
      (v) => `Dep: ${v.dep} → replace${v.lepios_alternative ? ` → use ${v.lepios_alternative}` : ''}`
    ),
    ``,
    `Task returned to queue. Update metadata.external_deps or remove dep to unblock.`,
  ]
  await postMessage(lines.join('\n')).catch(() => {})
}
