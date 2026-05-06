/**
 * Safety Agent — Phase 1: static checks (no LLM).
 *
 * Spec: docs/specs/safety-agent.md.
 *
 * Catches destructive or unsafe operations before they execute by pattern-
 * matching on inputs. No model dependency, fast (<50ms). Phases 2 (LLM
 * review) and 3 (Telegram approval flow) build on this.
 *
 * Three categories:
 *   1. destructive_sql  — DROP, TRUNCATE, DELETE without WHERE, ALTER on
 *      RLS-policy-bearing tables
 *   2. secret           — diff additions/removals of process.env.X or
 *      harness_config keys
 *   3. side_effect      — Telegram sends with literal chat IDs (vs config-
 *      resolved), Stripe live-mode marker, GitHub force-push to main,
 *      Supabase Storage bucket edits
 *
 * Severity ladder: pass < warn < block. The orchestrator returns the worst
 * severity across all findings.
 */

export type Severity = 'pass' | 'warn' | 'block'

export interface SafetyFinding {
  severity: Severity
  category: 'destructive_sql' | 'secret' | 'side_effect'
  rule: string
  evidence: string
}

export interface StaticCheckInput {
  sql?: string
  diff?: string
  telegram?: { chatId?: unknown; via?: 'config' | 'literal' | 'unknown' }
  stripe?: { liveMode?: boolean }
  git?: { forcePushToMain?: boolean }
  storage?: { bucketChange?: boolean }
}

export interface StaticCheckResult {
  severity: Severity
  findings: SafetyFinding[]
}

const SEVERITY_RANK: Record<Severity, number> = { pass: 0, warn: 1, block: 2 }

function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b
}

/**
 * RLS-bearing tables — ALTER on these is high-risk because RLS policies
 * govern security. Add to this list when new RLS-protected tables ship.
 */
const RLS_PROTECTED_TABLES = [
  'harness_config',
  'agent_events',
  'task_queue',
  'conversations',
  'messages',
  'knowledge',
  'business_expenses',
  'balance_sheet_entries',
  'oura_daily',
  'amazon_orders',
  'utility_bills',
]

// ── Destructive SQL ──────────────────────────────────────────────────────────

/**
 * Strip Postgres dollar-quoted string bodies from SQL text.
 *
 * Function bodies (`CREATE [OR REPLACE] FUNCTION ... AS $tag$ ... $tag$;`) are
 * stored as TEXT in pg_proc.prosrc and re-parsed at call time — they are NOT
 * top-level DDL. A `DROP INDEX IF EXISTS` *inside* a function body is a string
 * literal, not a destructive operation at migration apply time.
 *
 * Without this strip, the destructive_sql patterns produce false positives on
 * any migration that defines a function whose body includes DROP/TRUNCATE/etc.
 * (See migrations 0129, 0131, and PRs #82 / #84 which had to use SAFETY_BYPASS
 * for exactly this reason.)
 *
 * Anonymous tags (`$$ ... $$`) and named tags (`$function$ ... $function$`,
 * `$body$ ... $body$`, etc.) are both handled. Backreference matches an empty
 * group when the tag is anonymous.
 */
export function stripDollarQuotedBodies(sql: string): string {
  return sql.replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, '')
}

export function checkDestructiveSql(sql: string): SafetyFinding[] {
  const findings: SafetyFinding[] = []
  const stripped = stripDollarQuotedBodies(sql)
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const upper = stripped.toUpperCase()

  if (/\bDROP\s+(TABLE|SCHEMA|DATABASE|VIEW|FUNCTION|INDEX)\b/.test(upper)) {
    findings.push({
      severity: 'block',
      category: 'destructive_sql',
      rule: 'DROP statement',
      evidence: extractMatch(stripped, /\bDROP\s+\w+\s+\w+/i) ?? 'DROP …',
    })
  }

  if (/\bTRUNCATE\b/.test(upper)) {
    findings.push({
      severity: 'block',
      category: 'destructive_sql',
      rule: 'TRUNCATE statement',
      evidence: extractMatch(stripped, /\bTRUNCATE\s+(?:TABLE\s+)?\w+/i) ?? 'TRUNCATE …',
    })
  }

  // DELETE without WHERE — match DELETE FROM <table> not followed by WHERE
  // before terminator or chained ; .
  for (const stmt of stripped.split(';')) {
    if (!/\bDELETE\s+FROM\b/i.test(stmt)) continue
    if (!/\bWHERE\b/i.test(stmt)) {
      findings.push({
        severity: 'block',
        category: 'destructive_sql',
        rule: 'DELETE without WHERE',
        evidence: extractMatch(stmt, /\bDELETE\s+FROM\s+\w+/i) ?? 'DELETE FROM …',
      })
    }
  }

  // ALTER TABLE <rls-table> — warn (RLS policy or column drop is risky)
  const alterMatch = stripped.match(/\bALTER\s+TABLE\s+(\w+)/i)
  if (alterMatch && RLS_PROTECTED_TABLES.includes(alterMatch[1].toLowerCase())) {
    findings.push({
      severity: 'warn',
      category: 'destructive_sql',
      rule: `ALTER on RLS-protected table (${alterMatch[1]})`,
      evidence: alterMatch[0],
    })
  }

  return findings
}

// ── Secret changes ───────────────────────────────────────────────────────────

export function checkSecretChanges(diff: string): SafetyFinding[] {
  const findings: SafetyFinding[] = []
  const lines = diff.split('\n')

  for (const line of lines) {
    const isAddition = line.startsWith('+') && !line.startsWith('+++')
    const isRemoval = line.startsWith('-') && !line.startsWith('---')
    if (!isAddition && !isRemoval) continue

    // process.env.SOMETHING — addition or removal of secret read
    const envMatch = line.match(/process\.env\.([A-Z_][A-Z_0-9]+)/)
    if (envMatch) {
      const verb = isAddition ? 'adds' : 'removes'
      findings.push({
        severity: 'warn',
        category: 'secret',
        rule: `${verb} process.env.${envMatch[1]} reference`,
        evidence: line.trim().slice(0, 120),
      })
    }

    // harness_config row reference (string literal in code)
    if (/['"]harness_config['"]/.test(line) && /(insert|update|upsert|delete)/i.test(line)) {
      findings.push({
        severity: 'block',
        category: 'secret',
        rule: 'harness_config write in code',
        evidence: line.trim().slice(0, 120),
      })
    }
  }

  return findings
}

// ── Side effects ─────────────────────────────────────────────────────────────

export function checkSideEffects(
  input:
    | NonNullable<
        | StaticCheckInput['telegram']
        | StaticCheckInput['stripe']
        | StaticCheckInput['git']
        | StaticCheckInput['storage']
      >
    | undefined,
  context: 'telegram' | 'stripe' | 'git' | 'storage'
): SafetyFinding[] {
  const findings: SafetyFinding[] = []
  if (!input) return findings

  if (context === 'telegram') {
    const t = input as { chatId?: unknown; via?: 'config' | 'literal' | 'unknown' }
    if (t.via === 'literal' || (t.chatId !== undefined && t.via !== 'config')) {
      findings.push({
        severity: 'warn',
        category: 'side_effect',
        rule: 'Telegram sendMessage with non-config chat_id',
        evidence: `chat_id: ${typeof t.chatId === 'string' ? t.chatId.slice(0, 20) : String(t.chatId)}`,
      })
    }
  }

  if (context === 'stripe') {
    const s = input as { liveMode?: boolean }
    if (s.liveMode === true) {
      findings.push({
        severity: 'block',
        category: 'side_effect',
        rule: 'Stripe live-mode operation',
        evidence: 'liveMode=true',
      })
    }
  }

  if (context === 'git') {
    const g = input as { forcePushToMain?: boolean }
    if (g.forcePushToMain === true) {
      findings.push({
        severity: 'block',
        category: 'side_effect',
        rule: 'force-push to main branch',
        evidence: 'git push --force origin main',
      })
    }
  }

  if (context === 'storage') {
    const s = input as { bucketChange?: boolean }
    if (s.bucketChange === true) {
      findings.push({
        severity: 'warn',
        category: 'side_effect',
        rule: 'Supabase Storage bucket configuration change',
        evidence: 'bucket policy / lifecycle / RLS edited',
      })
    }
  }

  return findings
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export function staticSafetyCheck(input: StaticCheckInput): StaticCheckResult {
  const findings: SafetyFinding[] = []

  if (input.sql) findings.push(...checkDestructiveSql(input.sql))
  if (input.diff) findings.push(...checkSecretChanges(input.diff))
  if (input.telegram) findings.push(...checkSideEffects(input.telegram, 'telegram'))
  if (input.stripe) findings.push(...checkSideEffects(input.stripe, 'stripe'))
  if (input.git) findings.push(...checkSideEffects(input.git, 'git'))
  if (input.storage) findings.push(...checkSideEffects(input.storage, 'storage'))

  const severity = findings.reduce<Severity>((worst, f) => maxSeverity(worst, f.severity), 'pass')
  return { severity, findings }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractMatch(input: string, pattern: RegExp): string | null {
  const m = input.match(pattern)
  return m ? m[0].trim() : null
}
