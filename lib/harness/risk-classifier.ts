/**
 * lib/harness/risk-classifier.ts
 *
 * Pure-function risk classifier for the deploy gate.
 *
 * Maps a diff (changed files + line counts + diff text) to the minimum
 * RiskTier that allows auto-merge. The configured `DEPLOY_GATE_RISK_TIER`
 * (read from harness_config at runtime) is compared against this output;
 * auto-merge fires when configured >= required.
 *
 * Spec: docs/sprint-5/overnight-autonomy-acceptance.md §3
 *
 * Forking decisions baked in (see acceptance doc Q3, Q6):
 *   Q3 — additive-migration allowlist deferred. Any migration → 'off'.
 *   Q6 — Ollama-drafted self-repair fixes get +20 risk score; pass that as
 *        a hint via classifyInput.drafter_tier_hint.
 */

export type RiskTier = 'off' | 'low' | 'medium' | 'migration-allow'

const TIER_RANK: Record<RiskTier, number> = {
  off: 0,
  low: 1,
  medium: 2,
  'migration-allow': 3,
}

/** Configured tier permits a required tier iff configured rank >= required rank. */
export function tierPermits(configured: RiskTier, required: RiskTier): boolean {
  if (configured === 'off') return false
  return TIER_RANK[configured] >= TIER_RANK[required]
}

/**
 * Shared seam files — must always gate on a human. Mirror of the seam set in
 * `.claude/CLAUDE.md` (Multi-window protocol §Hard rules → Shared seams).
 *
 * Keep in sync. The protocol-files entries from that list are not included
 * here because they are covered by the broader `.claude/**` and `scripts/**`
 * pattern checks below. The seam set here is exact-paths only.
 */
const SHARED_SEAM_PATHS = new Set<string>([
  'package.json',
  'package-lock.json',
  'app/layout.tsx',
  'middleware.ts',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'tailwind.config.js',
  'tailwind.config.ts',
  'tsconfig.json',
  '.env.example',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.ts',
  '.gitignore',
  'supabase/seed.sql',
  '.claude/CLAUDE.md',
])

const SHARED_SEAM_PREFIXES = ['scripts/window-', 'scripts/lib/window-', '.husky/']

function isSharedSeam(path: string): boolean {
  if (SHARED_SEAM_PATHS.has(path)) return true
  return SHARED_SEAM_PREFIXES.some((p) => path.startsWith(p))
}

/** Any change under .env or to .env.example variants. */
function isEnvChange(path: string): boolean {
  return /(^|\/)\.env(\..+)?$/.test(path) || path === '.env.example'
}

function isMigration(path: string): boolean {
  return /^supabase\/migrations\/.+\.sql$/.test(path)
}

/**
 * Additive-migration allowlist regex set. v1: returns false for everything
 * (Q3 deferred to a follow-up task). When implemented, will whitelist:
 *   CREATE TABLE, ADD COLUMN (nullable), CREATE INDEX CONCURRENTLY,
 *   CREATE POLICY, CREATE FUNCTION, CREATE TYPE
 * and reject anything containing destructive verbs.
 *
 * Until then: any migration touching a *.sql file in supabase/migrations/**
 * routes to 'off'.
 */
function isAdditiveOnly(_diffText: string): boolean {
  return false
}

export type ClassifyInput = {
  changed_files: string[]
  added_lines: number
  removed_lines: number
  diff_text: string
  /**
   * Optional hint from the upstream PR source. Currently used by self-repair
   * to flag Ollama-drafted fixes; classifier adds +20 to risk score, which
   * pushes most diffs out of the 'low' tier. (Q6 in the acceptance doc.)
   */
  drafter_tier_hint?: 'tier_1_laptop_ollama' | 'tier_2_cline' | 'tier_3_frontier' | null
}

export type ClassifyResult = {
  required_tier: RiskTier
  /** 0–100 raw score (mostly informational; tier is what auto-merge compares against) */
  risk_score: number
  reasons: string[]
}

const LOW_FILE_CAP = 5
const LOW_LINE_CAP = 200
const MEDIUM_FILE_CAP = 15
const MEDIUM_LINE_CAP = 800

/**
 * Decision order (first match wins, escalating to off):
 *  1. Any shared-seam file → off
 *  2. Any .env* change → off
 *  3. Any migration → off (until additive allowlist ships)
 *  4. >medium-tier caps → off (>15 files OR >800 added)
 *  5. >low-tier caps → medium (>5 files OR >200 added)
 *  6. Otherwise → low
 *
 * risk_score is a coarse companion signal:
 *   base 10
 *   + min(50, added_lines / 4)                — 200 lines = +50
 *   + 5 * (changed_files - 1) up to +25
 *   + 20 if drafter_tier_hint = tier_1_laptop_ollama
 *   capped at 100.
 */
export function classifyRisk(input: ClassifyInput): ClassifyResult {
  const reasons: string[] = []

  // Compute raw risk_score for observability.
  let score = 10
  score += Math.min(50, Math.floor(input.added_lines / 4))
  score += Math.min(25, Math.max(0, input.changed_files.length - 1) * 5)
  if (input.drafter_tier_hint === 'tier_1_laptop_ollama') {
    score += 20
    reasons.push('drafter is tier_1_laptop_ollama (+20 risk)')
  }
  score = Math.max(0, Math.min(100, score))

  // 1. Shared seams → off (always)
  const seams = input.changed_files.filter(isSharedSeam)
  if (seams.length > 0) {
    reasons.push(`shared seam file(s): ${seams.join(', ')}`)
    return { required_tier: 'off', risk_score: Math.max(score, 80), reasons }
  }

  // 2. Env changes → off
  const envFiles = input.changed_files.filter(isEnvChange)
  if (envFiles.length > 0) {
    reasons.push(`env file(s): ${envFiles.join(', ')}`)
    return { required_tier: 'off', risk_score: Math.max(score, 75), reasons }
  }

  // 3. Migrations → off until additive allowlist ships
  const migrations = input.changed_files.filter(isMigration)
  if (migrations.length > 0) {
    if (isAdditiveOnly(input.diff_text)) {
      reasons.push(`additive migration(s): ${migrations.join(', ')}`)
      return { required_tier: 'migration-allow', risk_score: Math.max(score, 55), reasons }
    }
    reasons.push(
      `migration(s) detected; additive allowlist not implemented (Q3): ${migrations.join(', ')}`
    )
    return { required_tier: 'off', risk_score: Math.max(score, 70), reasons }
  }

  // 4. Medium caps blown → off
  if (input.added_lines > MEDIUM_LINE_CAP) {
    reasons.push(`added_lines ${input.added_lines} > medium cap ${MEDIUM_LINE_CAP}`)
    return { required_tier: 'off', risk_score: Math.max(score, 80), reasons }
  }
  if (input.changed_files.length > MEDIUM_FILE_CAP) {
    reasons.push(`changed_files ${input.changed_files.length} > medium cap ${MEDIUM_FILE_CAP}`)
    return { required_tier: 'off', risk_score: Math.max(score, 80), reasons }
  }

  // 5. Low caps blown → medium
  if (input.added_lines > LOW_LINE_CAP) {
    reasons.push(`added_lines ${input.added_lines} > low cap ${LOW_LINE_CAP}`)
    return { required_tier: 'medium', risk_score: Math.max(score, 35), reasons }
  }
  if (input.changed_files.length > LOW_FILE_CAP) {
    reasons.push(`changed_files ${input.changed_files.length} > low cap ${LOW_FILE_CAP}`)
    return { required_tier: 'medium', risk_score: Math.max(score, 35), reasons }
  }

  // 6. Default — low tier
  reasons.push('within low-tier caps; no shared seams, env, or migrations')
  return { required_tier: 'low', risk_score: score, reasons }
}

/** Map a 0–100 risk_score to the minimum tier that can auto-promote it. */
export function riskScoreToTier(score: number): RiskTier {
  if (score <= 20) return 'low'
  if (score <= 50) return 'medium'
  if (score <= 70) return 'migration-allow'
  return 'off'
}
