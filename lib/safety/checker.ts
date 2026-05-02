/**
 * LepiOS Safety Checker — rule-based pre-execution guardrail layer (Step 3).
 *
 * Six rule categories: destructive_operation, secret_leak, missing_test,
 * scope_creep, missing_rollback, schema_validation.
 *
 * Not an LLM reviewer — catches obvious failure modes and logs everything
 * to agent_events for scoring (false-positive rate over time).
 *
 * SPRINT5-GATE: Add LLM-based semantic intent analysis when Ollama is ported.
 *
 * Usage:
 *   import { validateProposedChanges } from '@/lib/safety/checker'
 *   const report = await validateProposedChanges(input)
 *   if (report.blocking) { halt and surface to Colin }
 */

import { logEvent } from '@/lib/knowledge/client'
import { requireCapability } from '@/lib/security/capability'
import type {
  SafetyCheck,
  SafetyReport,
  SafetyCheckInput,
  ProposedFileChange,
  ProposedMigration,
} from './types'

// ── Rule 1: Destructive SQL ───────────────────────────────────────────────────

const DESTRUCTIVE_SQL_PATTERNS: Array<{ re: RegExp; id: string; label: string }> = [
  { re: /\bDROP\s+TABLE\b/i, id: 'drop_table', label: 'DROP TABLE' },
  { re: /\bTRUNCATE\b/i, id: 'truncate', label: 'TRUNCATE' },
  {
    re: /\bDELETE\s+FROM\s+\w+\s*(?:;|$|\n)(?!\s*WHERE)/im,
    id: 'delete_no_where',
    label: 'DELETE without WHERE',
  },
  {
    re: /\bDELETE\s+FROM\s+\w+\s*\n\s*(?!WHERE)/im,
    id: 'delete_no_where_newline',
    label: 'DELETE without WHERE',
  },
  { re: /\bALTER\s+TABLE\b.+\bDROP\s+COLUMN\b/i, id: 'drop_column', label: 'DROP COLUMN' },
  {
    re: /\bALTER\s+TABLE\b.+\bDROP\s+NOT\s+NULL\b/i,
    id: 'drop_not_null',
    label: 'DROP NOT NULL constraint',
  },
]

/** Strip SQL comment lines before scanning for destructive patterns */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
}

function checkDestructiveSql(migrations: ProposedMigration[]): SafetyCheck[] {
  const checks: SafetyCheck[] = []
  for (const m of migrations) {
    const sql = stripSqlComments(m.sql)
    for (const { re, id, label } of DESTRUCTIVE_SQL_PATTERNS) {
      const match = re.exec(sql)
      if (match) {
        checks.push({
          id: `destructive_sql_${id}`,
          severity: 'critical',
          category: 'destructive_operation',
          message: `Migration "${m.name}" contains ${label}`,
          suggestion:
            'Use a soft-delete or rename pattern instead. If intentional, document the rollback plan and get Colin approval.',
          file: `supabase/migrations/${m.name}.sql`,
          excerpt: match[0].trim(),
        })
      }
    }
    // Also check for DELETE without WHERE in a lookahead-friendly way
    const deleteMatch = /\bDELETE\s+FROM\s+(\w+)([^;]*?)(;|$)/gim.exec(sql)
    if (deleteMatch) {
      const stmt = deleteMatch[0]
      if (
        !/\bWHERE\b/i.test(stmt) &&
        !checks.some((c) => c.id === 'destructive_sql_delete_no_where')
      ) {
        checks.push({
          id: 'destructive_sql_delete_no_where',
          severity: 'critical',
          category: 'destructive_operation',
          message: `Migration "${m.name}" contains DELETE FROM without WHERE clause`,
          suggestion: 'Add a WHERE clause or use TRUNCATE with explicit intent documented.',
          file: `supabase/migrations/${m.name}.sql`,
          excerpt: stmt.slice(0, 120).trim(),
        })
      }
    }
  }
  return checks
}

// ── Rule 2: Secret Leak ───────────────────────────────────────────────────────

// Match hardcoded secrets — NOT env var references (process.env.*) or placeholder comments
const SECRET_PATTERNS: Array<{ re: RegExp; id: string; label: string }> = [
  { re: /AKIA[0-9A-Z]{16}/g, id: 'aws_access_key', label: 'AWS access key ID' },
  { re: /sk_live_[a-zA-Z0-9]{20,}/g, id: 'stripe_live_key', label: 'Stripe live secret key' },
  { re: /sk_test_[a-zA-Z0-9]{20,}/g, id: 'stripe_test_key', label: 'Stripe test secret key' },
  { re: /whsec_[a-zA-Z0-9]{20,}/g, id: 'stripe_webhook_secret', label: 'Stripe webhook secret' },
  {
    re: /sb_secret_[a-zA-Z0-9_]{20,}/g,
    id: 'supabase_service_key',
    label: 'Supabase service role key',
  },
  {
    re: /eyJ[a-zA-Z0-9_-]{30,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
    id: 'jwt_token',
    label: 'JWT token',
  },
  {
    re: /(?:postgres|postgresql|mysql|mongodb):\/\/[^:]+:[^@\s'"]{6,}@/gi,
    id: 'db_connection_string',
    label: 'database connection string with credentials',
  },
  // Long hex strings adjacent to an assignment (e.g. const SECRET = "abcd1234..." not in an import or comment)
  {
    re: /(?:=\s*["']|:\s*["'])[0-9a-f]{48,}["']/gi,
    id: 'hex_secret',
    label: 'hardcoded hex secret (48+ chars)',
  },
]

function isEnvVarRef(line: string): boolean {
  return /process\.env\.|env\[|import\.meta\.env\./.test(line)
}

function checkSecretLeak(fileChanges: ProposedFileChange[]): SafetyCheck[] {
  const checks: SafetyCheck[] = []
  const seen = new Set<string>()

  for (const f of fileChanges) {
    // Never scan .env* files — they're meant to hold secrets
    if (f.path.includes('.env')) continue

    for (const { re, id, label } of SECRET_PATTERNS) {
      re.lastIndex = 0
      const lines = f.diff.split('\n')
      for (const line of lines) {
        // Skip lines that are just env var references
        if (isEnvVarRef(line)) continue
        // Skip comment lines
        if (/^\s*(\/\/|#|\*)/.test(line)) continue
        re.lastIndex = 0
        const match = re.exec(line)
        if (match) {
          const key = `${id}::${f.path}`
          if (!seen.has(key)) {
            seen.add(key)
            checks.push({
              id: `secret_leak_${id}`,
              severity: 'critical',
              category: 'secret_leak',
              message: `Possible ${label} hardcoded in "${f.path}"`,
              suggestion: 'Move to process.env / .env.local. Never commit secrets to source.',
              file: f.path,
              excerpt: match[0].replace(/[a-zA-Z0-9]{8,}/g, (s) => s.slice(0, 4) + '****'),
            })
          }
        }
      }
    }
  }
  return checks
}

// ── Rule 3: Missing Test Coverage ────────────────────────────────────────────

// Existing test file names (derived from tests/ directory convention: tests/*.test.ts)
const EXISTING_TESTS = new Set([
  'bets-api',
  'betting-tile',
  'bsr-history',
  'calculator',
  'ebay-fees',
  'ebay-listings',
  'hit-lists',
  'isbn',
  'keepa-product',
  'kelly',
])

function testSlugFor(filePath: string): string {
  // lib/foo/bar.ts → foo-bar; app/api/foo/route.ts → foo-api
  const withoutExt = filePath.replace(/\.tsx?$/, '')
  if (withoutExt.startsWith('app/api/')) {
    const parts = withoutExt
      .split('/')
      .filter((p) => p && p !== 'app' && p !== 'api' && p !== 'route' && p !== '[id]')
    return parts.join('-') + (parts[parts.length - 1] !== 'api' ? '-api' : '')
  }
  if (withoutExt.startsWith('lib/')) {
    const parts = withoutExt.split('/').filter((p) => p && p !== 'lib' && p !== 'index')
    return parts.join('-')
  }
  return ''
}

function checkMissingTests(
  fileChanges: ProposedFileChange[],
  knownTests: Set<string>
): SafetyCheck[] {
  const checks: SafetyCheck[] = []
  for (const f of fileChanges) {
    if (!f.isNew) continue
    const isLib = f.path.startsWith('lib/') && f.path.endsWith('.ts')
    const isRoute = f.path.startsWith('app/api/') && f.path.endsWith('.ts')
    if (!isLib && !isRoute) continue

    const slug = testSlugFor(f.path)
    if (!slug) continue
    if (!knownTests.has(slug)) {
      checks.push({
        id: `missing_test_${slug.replace(/-/g, '_')}`,
        severity: 'medium',
        category: 'missing_test',
        message: `New file "${f.path}" has no corresponding test (expected tests/${slug}.test.ts)`,
        suggestion: `Add tests/${slug}.test.ts with at least the happy path and one error case.`,
        file: f.path,
      })
    }
  }
  return checks
}

// ── Rule 4: Scope Creep ───────────────────────────────────────────────────────

function matchesScope(filePath: string, declaredScope: string[]): boolean {
  return declaredScope.some((prefix) => filePath.startsWith(prefix) || filePath === prefix)
}

function checkScopeCreep(
  fileChanges: ProposedFileChange[],
  declaredScope: string[]
): SafetyCheck[] {
  if (!declaredScope.length) return []
  const checks: SafetyCheck[] = []
  for (const f of fileChanges) {
    if (!matchesScope(f.path, declaredScope)) {
      checks.push({
        id: `scope_creep_${f.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
        severity: 'high',
        category: 'scope_creep',
        message: `File "${f.path}" is outside the declared scope`,
        suggestion: 'Either add this file to the declared scope or split it into a separate step.',
        file: f.path,
      })
    }
  }
  return checks
}

// ── Rule 5: Missing Rollback ──────────────────────────────────────────────────

const ROLLBACK_INDICATORS = [
  /--\s*rollback/i,
  /--\s*down/i,
  /--\s*revert/i,
  /--\s*undo/i,
  /drop\s+table\s+if\s+exists/i, // cleanup section
]

function hasRollbackComment(sql: string): boolean {
  return ROLLBACK_INDICATORS.some((re) => re.test(sql))
}

function checkMissingRollback(migrations: ProposedMigration[]): SafetyCheck[] {
  const checks: SafetyCheck[] = []
  for (const m of migrations) {
    if (!m.hasRollback && !hasRollbackComment(m.sql)) {
      checks.push({
        id: `missing_rollback_${m.name}`,
        severity: 'high',
        category: 'missing_rollback',
        message: `Migration "${m.name}" has no documented rollback path`,
        suggestion:
          'Add a "-- Rollback: DROP TABLE ..." comment or equivalent at the bottom of the migration.',
        file: `supabase/migrations/${m.name}.sql`,
      })
    }
  }
  return checks
}

// ── Rule 6: Zod Schema Validation ────────────────────────────────────────────

// Routes that legitimately have no body input (safe to skip Zod check)
const BODY_EXEMPT_ROUTE_PATTERNS = [
  /\/nightly\//, // cron-triggered, no body
  /\/health\//, // health checks
  /\/webhooks\//, // Stripe webhooks use raw body, not JSON
]

function isBodyExempt(routePath: string): boolean {
  return BODY_EXEMPT_ROUTE_PATTERNS.some((re) => re.test(routePath))
}

function checkZodCoverage(
  fileChanges: ProposedFileChange[],
  newApiRoutes: string[]
): SafetyCheck[] {
  const checks: SafetyCheck[] = []
  for (const routePath of newApiRoutes) {
    if (isBodyExempt(routePath)) continue

    const fileChange = fileChanges.find((f) => f.path === routePath)
    if (!fileChange) continue

    const hasZod =
      /from ['"]zod['"]|from ['"]@\/lib\/schemas|z\.object|z\.string|z\.number|ZodSchema/.test(
        fileChange.diff
      )
    if (!hasZod) {
      checks.push({
        id: `missing_zod_${routePath.replace(/[^a-zA-Z0-9]/g, '_')}`,
        severity: 'high',
        category: 'schema_validation',
        message: `New API route "${routePath}" appears to have no Zod input validation`,
        suggestion:
          'Add a Zod schema for the request body/query and call schema.parse() or schema.safeParse() at the top of the handler.',
        file: routePath,
      })
    }
  }
  return checks
}

// ── Core: runSafetyChecks ─────────────────────────────────────────────────────

/**
 * Run all rule-based safety checks against a proposed change set.
 * Pass `knownTests` to extend the built-in set (useful in tests).
 */
export function runSafetyChecks(
  input: SafetyCheckInput,
  knownTests: Set<string> = EXISTING_TESTS
): SafetyReport {
  const allChecks: SafetyCheck[] = [
    ...checkDestructiveSql(input.migrations ?? []),
    ...checkSecretLeak(input.fileChanges),
    ...checkMissingTests(input.fileChanges, knownTests),
    ...checkScopeCreep(input.fileChanges, input.declaredScope ?? []),
    ...checkMissingRollback(input.migrations ?? []),
    ...checkZodCoverage(input.fileChanges, input.newApiRoutes ?? []),
  ]

  const hasBlocking = allChecks.some((c) => c.severity === 'critical')
  const hasFailing = allChecks.some((c) => c.severity === 'critical' || c.severity === 'high')

  return {
    passed: !hasFailing,
    blocking: hasBlocking,
    checks: allChecks,
    metadata: {
      checked_at: new Date().toISOString(),
      files_changed: input.fileChanges.length,
      migrations_proposed: input.migrations?.length ?? 0,
      routes_proposed: input.newApiRoutes?.length ?? 0,
      scope_declared: (input.declaredScope?.length ?? 0) > 0,
    },
  }
}

// ── Entry point: validateProposedChanges ──────────────────────────────────────

/**
 * Run safety checks and log the result to agent_events.
 * Call this before executing any proposed change set.
 *
 * If report.blocking is true: halt and surface to Colin.
 * If not blocking: log and proceed (checks may still contain warnings).
 */
export async function validateProposedChanges(
  input: SafetyCheckInput,
  knownTests?: Set<string>,
  opts?: { agentId?: string }
): Promise<SafetyReport> {
  await requireCapability({ agentId: opts?.agentId ?? 'coordinator', capability: 'shell.run' })

  const report = runSafetyChecks(input, knownTests)

  // Log to agent_events for scoring trail
  void logEvent('safety', 'safety.check', {
    actor: 'system',
    status: report.passed ? 'success' : report.blocking ? 'failure' : 'warning',
    inputSummary: input.scopeDescription.slice(0, 500),
    outputSummary: report.passed
      ? 'All checks passed'
      : `${report.checks.length} check(s) fired: ${report.checks.map((c) => c.id).join(', ')}`,
    meta: {
      passed: report.passed,
      blocking: report.blocking,
      check_count: report.checks.length,
      severity_breakdown: report.checks.reduce<Record<string, number>>((acc, c) => {
        acc[c.severity] = (acc[c.severity] ?? 0) + 1
        return acc
      }, {}),
      metadata: report.metadata,
    },
  })

  return report
}
