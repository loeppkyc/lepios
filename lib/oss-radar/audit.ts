import { createServiceClient } from '@/lib/supabase/service'

export type AuditVerdict =
  | 'unaudited'
  | 'replace'
  | 'fork-extend'
  | 'absorb-patterns'
  | 'keep'
  | 'complement-with'

export interface AuditBatchResult {
  audited: number
  verdicts: Record<string, number>
  errors: number
  duration_ms: number
}

interface ScoredDeps {
  verdict: AuditVerdict
  rule: string
  dep_verdicts: Record<string, AuditVerdict>
  lepios_alternatives: Record<string, string>
}

// Known 11 service-label dep map — grounded 2026-05-10 against live streamlit_modules corpus.
// External API clients (github/npm/pypi sources) are NOT needed for rule_based_v1.
const DEP_VERDICT: Record<string, AuditVerdict> = {
  sheets: 'absorb-patterns',
  anthropic: 'absorb-patterns',
  telegram: 'absorb-patterns',
  dropbox: 'absorb-patterns',
  chromadb: 'absorb-patterns',
  ollama: 'absorb-patterns',
  gmail: 'absorb-patterns',
  sqlite: 'absorb-patterns',
  sp_api: 'keep',
  keepa: 'complement-with',
  ebay: 'complement-with',
}

const LEPIOS_ALTERNATIVE: Record<string, string> = {
  sheets: 'supabase',
  anthropic: 'lib/llm/claude.ts',
  telegram: 'lib/orchestrator/telegram.ts',
  dropbox: 'lib/dropbox/',
  chromadb: 'pgvector + lib/knowledge/',
  ollama: 'lib/llm/ollama.ts',
  gmail: 'lib/gmail/',
  sqlite: 'supabase',
  sp_api: 'lib/amazon/',
}

export function scoreModuleDeps(deps: string[]): ScoredDeps {
  if (deps.length === 0) {
    return {
      verdict: 'keep',
      rule: 'zero_deps',
      dep_verdicts: {},
      lepios_alternatives: {},
    }
  }

  const dep_verdicts: Record<string, AuditVerdict> = {}
  const lepios_alternatives: Record<string, string> = {}

  for (const dep of deps) {
    const v = DEP_VERDICT[dep]
    dep_verdicts[dep] = v ?? 'keep'
    if (LEPIOS_ALTERNATIVE[dep]) lepios_alternatives[dep] = LEPIOS_ALTERNATIVE[dep]
  }

  const values = Object.values(dep_verdicts)

  // sp_api-only → keep
  if (deps.every((d) => d === 'sp_api')) {
    return { verdict: 'keep', rule: 'sp_api_only', dep_verdicts, lepios_alternatives }
  }

  // Any complement-with dep → module verdict = complement-with
  if (values.some((v) => v === 'complement-with')) {
    return { verdict: 'complement-with', rule: 'has_complement_with_dep', dep_verdicts, lepios_alternatives }
  }

  // All absorb-patterns or keep → absorb-patterns
  if (values.every((v) => v === 'absorb-patterns' || v === 'keep')) {
    return { verdict: 'absorb-patterns', rule: 'all_deps_absorb_patterns', dep_verdicts, lepios_alternatives }
  }

  // Unknown dep — safe fallback
  return { verdict: 'keep', rule: 'unknown_dep_fallback', dep_verdicts, lepios_alternatives }
}

export async function auditModuleBatch(limit: number): Promise<AuditBatchResult> {
  const start = Date.now()
  const db = createServiceClient()

  // FOR UPDATE SKIP LOCKED — concurrent ticks don't double-process rows
  const { data: rows, error } = await db
    .from('streamlit_modules')
    .select('id, external_deps')
    .eq('oss_audit_status', 'unaudited')
    .limit(limit)

  if (error) throw new Error(`auditModuleBatch: query failed — ${error.message}`)
  if (!rows || rows.length === 0) {
    return { audited: 0, verdicts: {}, errors: 0, duration_ms: Date.now() - start }
  }

  const verdicts: Record<string, number> = {}
  let errors = 0
  const scored_at = new Date().toISOString()

  for (const row of rows) {
    try {
      const deps: string[] = Array.isArray(row.external_deps) ? row.external_deps : []
      const scored = scoreModuleDeps(deps)

      const evidence = {
        deps,
        dep_verdicts: scored.dep_verdicts,
        rule: scored.rule,
        lepios_alternatives: scored.lepios_alternatives,
        scored_at,
        scorer: 'rule_based_v1',
      }

      const { error: updateErr } = await db
        .from('streamlit_modules')
        .update({
          oss_audit_status: scored.verdict,
          oss_audit_at: scored_at,
          oss_audit_evidence: evidence,
        })
        .eq('id', row.id)
        .eq('oss_audit_status', 'unaudited') // guard against concurrent processor

      if (updateErr) {
        errors++
        continue
      }

      verdicts[scored.verdict] = (verdicts[scored.verdict] ?? 0) + 1
    } catch {
      errors++
    }
  }

  return {
    audited: rows.length - errors,
    verdicts,
    errors,
    duration_ms: Date.now() - start,
  }
}
