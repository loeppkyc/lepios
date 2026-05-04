/**
 * push_bash_automation — Policy engine (Slice 1)
 *
 * Pure function. No side effects, no DB calls, no async.
 * Three-layer allowlist: Block → Confirm → Auto → default confirm.
 *
 * // TODO: tune thresholds with real data as command patterns are observed
 */

export type DecisionTier = 'auto' | 'confirm' | 'block'

export interface DecisionContext {
  agentId?: string
  branch?: string // current git branch — used for branch-aware rules in Slice 2
  reason?: string // free text from caller
}

export interface PolicyDecision {
  tier: DecisionTier
  reason: string // human-readable, written to push_bash_decisions.reason
}

// ── Layer 1 — Block patterns (checked first, highest priority) ─────────────────

// Force push or force reset with git
const BLOCK_FORCE_GIT = /\bgit\s+(?:push|reset)\b.*(?:--force|-f\b)/

// Pushing to protected branches
const BLOCK_PUSH_MAIN = /\bgit\s+push\b.*\b(?:main|master)\b/

// Hard reset
const BLOCK_RESET_HARD = /\bgit\s+reset\s+--hard\b/

// Filesystem destruction
const BLOCK_RM_RF = /\brm\s+-rf?\b/

// Destructive SQL (case-insensitive)
const BLOCK_SQL_DESTRUCTIVE = /\b(?:drop\s+table|truncate|delete\s+from)\b/i

// Credential exposure
const BLOCK_CREDENTIALS = /(?:SECRET|TOKEN|PASSWORD|API_KEY)=/

// Skip hooks
const BLOCK_NO_VERIFY = /\bgit\s+push\b.*--no-verify/

const BLOCK_RULES: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: BLOCK_FORCE_GIT, reason: 'block: force push or force reset with git' },
  { pattern: BLOCK_PUSH_MAIN, reason: 'block: pushing to protected branch (main/master)' },
  { pattern: BLOCK_RESET_HARD, reason: 'block: git reset --hard is destructive' },
  { pattern: BLOCK_RM_RF, reason: 'block: rm -rf is filesystem destructive' },
  {
    pattern: BLOCK_SQL_DESTRUCTIVE,
    reason: 'block: destructive SQL (DROP TABLE / TRUNCATE / DELETE FROM)',
  },
  {
    pattern: BLOCK_CREDENTIALS,
    reason: 'block: command contains credential (SECRET=/TOKEN=/PASSWORD=/API_KEY=)',
  },
  { pattern: BLOCK_NO_VERIFY, reason: 'block: git push --no-verify bypasses hooks' },
]

function checkBlock(cmd: string): string | null {
  for (const { pattern, reason } of BLOCK_RULES) {
    if (pattern.test(cmd)) return reason
  }
  return null
}

// ── Layer 2 — Confirm patterns (checked second) ────────────────────────────────

const CONFIRM_RULES: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^git\s+commit\b/, reason: 'confirm: git commit — committing code' },
  { pattern: /^git\s+push\b/, reason: 'confirm: git push — pushing to remote' },
  { pattern: /^git\s+checkout\s+-b\b/, reason: 'confirm: git checkout -b — creating a branch' },
  { pattern: /^git\s+merge\b/, reason: 'confirm: git merge — merging branches' },
  { pattern: /^git\s+rebase\b/, reason: 'confirm: git rebase — rebasing' },
  {
    pattern: /^npm\s+(?:install|ci|uninstall|update)\b/,
    reason: 'confirm: npm package mutation (install/ci/uninstall/update)',
  },
  {
    pattern: /^npm\s+run\s+(?:format|lint:fix)$/,
    reason: 'confirm: npm run format/lint:fix — mutating formatter/linter',
  },
  {
    pattern: /^gh\s+pr\s+(?:create|merge|close|edit)\b/,
    reason: 'confirm: gh pr action — GitHub PR operation',
  },
  { pattern: /^supabase\b/, reason: 'confirm: supabase CLI operation' },
  { pattern: /^vercel\b/, reason: 'confirm: vercel CLI operation' },
]

function checkConfirm(cmd: string): string | null {
  for (const { pattern, reason } of CONFIRM_RULES) {
    if (pattern.test(cmd)) return reason
  }
  return null
}

// ── Layer 3 — Auto patterns (checked last; default = confirm) ─────────────────

const AUTO_RULES: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /^git\s+(?:status|log|diff|show|branch|fetch|remote)\b/,
    reason: 'auto: read-only git command',
  },
  { pattern: /^git\s+add\b/, reason: 'auto: git add — staging files (not destructive)' },
  {
    pattern:
      /^npm\s+(?:test|run\s+test|run\s+build|run\s+lint$|run\s+format:check|run\s+type-check)\b/,
    reason: 'auto: npm build/test/check command',
  },
  { pattern: /^npx\s+tsc\b/, reason: 'auto: npx tsc — TypeScript check' },
  { pattern: /^(?:ls|cat|head|tail|wc|find)\b/, reason: 'auto: filesystem read command' },
  { pattern: /^echo\b/, reason: 'auto: echo — output only' },
]

function checkAuto(cmd: string): string | null {
  for (const { pattern, reason } of AUTO_RULES) {
    if (pattern.test(cmd)) return reason
  }
  return null
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function decideAction(cmd: string, _context?: DecisionContext): PolicyDecision {
  const normalized = cmd.trim()

  // Layer 1 — block (highest priority)
  const blockMatch = checkBlock(normalized)
  if (blockMatch) return { tier: 'block', reason: blockMatch }

  // Layer 2 — confirm
  const confirmMatch = checkConfirm(normalized)
  if (confirmMatch) return { tier: 'confirm', reason: confirmMatch }

  // Layer 3 — auto
  const autoMatch = checkAuto(normalized)
  if (autoMatch) return { tier: 'auto', reason: autoMatch }

  // Default — unknown commands require confirmation
  return { tier: 'confirm', reason: 'unknown command: defaulting to confirm' }
}
