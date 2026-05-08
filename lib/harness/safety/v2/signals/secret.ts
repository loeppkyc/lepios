/**
 * lib/harness/safety/v2/signals/secret.ts
 *
 * Secret-leak signal. Scans the unified PR diff for hardcoded secret tokens
 * (AWS keys, Stripe keys, JWTs, DB connection strings, hex secrets) and the
 * harness_config write pattern. Any hit is a single SECRET_DETECTED finding
 * regardless of count — the scorer caps the contribution at the configured
 * weight (default +100 = automatic high tier per Q-003 calibration).
 *
 * Reuses static patterns from lib/safety/checker.ts. Does not duplicate the
 * checker's per-file scan loop — operates on the unified diff so it works
 * cross-file from a single text input.
 *
 * Spec: docs/leverage-targets.md#safety-agent-0--done (signal #1)
 */

import type { SignalFinding, PRDiffInput } from '../types'

// F18: lib/harness/safety/v2/signals/secret

/**
 * Token patterns mirror lib/safety/checker.ts SECRET_PATTERNS (kept duplicated
 * here so the v2 path doesn't depend on that file's internal export — checker.ts
 * is a v1 pre-commit module with a different output shape).
 */
const SECRET_PATTERNS: Array<{ re: RegExp; id: string; label: string }> = [
  { re: /AKIA[0-9A-Z]{16}/, id: 'aws_access_key', label: 'AWS access key ID' },
  { re: /sk_live_[a-zA-Z0-9]{20,}/, id: 'stripe_live_key', label: 'Stripe live secret key' },
  { re: /sk_test_[a-zA-Z0-9]{20,}/, id: 'stripe_test_key', label: 'Stripe test secret key' },
  { re: /whsec_[a-zA-Z0-9]{20,}/, id: 'stripe_webhook_secret', label: 'Stripe webhook secret' },
  {
    re: /sb_secret_[a-zA-Z0-9_]{20,}/,
    id: 'supabase_service_key',
    label: 'Supabase service role key',
  },
  {
    re: /eyJ[a-zA-Z0-9_-]{30,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/,
    id: 'jwt_token',
    label: 'JWT token',
  },
  {
    re: /(?:postgres|postgresql|mysql|mongodb):\/\/[^:]+:[^@\s'"]{6,}@/i,
    id: 'db_connection_string',
    label: 'database connection string with credentials',
  },
  {
    re: /(?:=\s*["']|:\s*["'])[0-9a-f]{48,}["']/i,
    id: 'hex_secret',
    label: 'hardcoded hex secret (48+ chars)',
  },
]

/** Lines that read from environment variables — never flagged. */
function isEnvVarRef(line: string): boolean {
  return /process\.env\.|env\[|import\.meta\.env\./.test(line)
}

/** Comment-only lines — never flagged. */
function isCommentLine(line: string): boolean {
  return /^\+\s*(?:\/\/|#|\*)/.test(line)
}

/** Mask the matched value for evidence display. */
function maskMatch(value: string): string {
  return value.replace(/[a-zA-Z0-9]{8,}/g, (s) => s.slice(0, 4) + '…')
}

/**
 * Scan additions (`+` lines) in the unified diff for secret token patterns.
 * Returns at most one finding per (pattern_id, file_path) pair so the same
 * leaked secret detected twice doesn't double-count.
 *
 * harness_config writes from app code are caught separately by the static
 * checker at pre-commit (Layer 0); v2 deliberately does not duplicate that
 * check here — the deploy gate runs after pre-commit, so a harness_config
 * write would already have been blocked.
 */
export function detectSecrets(input: PRDiffInput): SignalFinding[] {
  const findings: SignalFinding[] = []
  const seen = new Set<string>()

  let currentFile = ''
  for (const line of input.unified_diff.split('\n')) {
    // Track which file the diff is currently in (`+++ b/path/to/file`).
    const fileHeader = line.match(/^\+\+\+\s+b\/(.+)$/)
    if (fileHeader) {
      currentFile = fileHeader[1]
      continue
    }

    // Only scan additions, skip the diff header line `+++` itself.
    if (!line.startsWith('+') || line.startsWith('+++')) continue
    // .env files legitimately hold secrets.
    if (currentFile.includes('.env')) continue
    if (isEnvVarRef(line)) continue
    if (isCommentLine(line)) continue

    for (const { re, id, label } of SECRET_PATTERNS) {
      const m = line.match(re)
      if (!m) continue
      const key = `${id}::${currentFile}`
      if (seen.has(key)) continue
      seen.add(key)
      findings.push({
        id,
        name: `secret leak: ${label}`,
        weight_key: 'SAFETY_WEIGHT_SECRET_DETECTED',
        evidence: `${currentFile}: ${maskMatch(m[0])}`,
      })
    }
  }

  return findings
}
