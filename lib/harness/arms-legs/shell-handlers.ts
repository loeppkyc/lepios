// shell-handlers.ts — wires shell execution into the dispatch registry.
//
// Import for side effects only:
//   import '@/lib/harness/arms-legs/shell-handlers'
//
// Security model:
//   1. ALLOWED_PREFIXES — first command segment must match (e.g. "git log", "grep")
//   2. DANGER_PATTERNS  — whole command must not match (prevents injection via ; && || $() etc.)
//   Both must pass; failure throws before execSync is called.

import { execSync } from 'child_process'
import { registerHandler } from './dispatch'

// ── Payload / result types ────────────────────────────────────────────────────

export interface ShellRunPayload {
  command: string
  cwd?: string
  timeoutMs?: number
}

export interface ShellRunResult {
  stdout: string
}

// ── Allowlist: first command segment must match one pattern ───────────────────
// Covers: read-only git queries + grep search. Expand only when a new use case
// is committed with a corresponding test.

const ALLOWED_PREFIXES: RegExp[] = [
  /^git\s+(branch|log|status|diff|show|rev-parse|remote|describe)\b/,
  /^grep\b/,
]

// ── Danger patterns: whole command must not match any of these ────────────────

const DANGER_PATTERNS: RegExp[] = [
  /\$\(/, // $(command substitution)
  /`/, // `backtick substitution`
  /;/, // command chaining
  /&&/, // conditional AND
  /\|\|/, // conditional OR
  /\brm\b/, // rm
  /\bchmod\b/, // chmod
  /\bsudo\b/, // sudo
  /\bcurl\b/, // curl
  /\bwget\b/, // wget
  /\beval\b/, // eval
]

export function validateCommand(command: string): void {
  const trimmed = command.trim()

  // Check allowlist against the first pipe segment (before any | filter)
  const firstSegment = trimmed.split('|')[0].trim()
  const allowed = ALLOWED_PREFIXES.some((re) => re.test(firstSegment))
  if (!allowed) {
    throw new Error(`shell.run: command not in allowlist: "${firstSegment.slice(0, 80)}"`)
  }

  // Check danger patterns against the full command
  for (const pattern of DANGER_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new Error(
        `shell.run: command contains blocked pattern (${pattern}): "${trimmed.slice(0, 80)}"`
      )
    }
  }
}

// ── Handler registration ──────────────────────────────────────────────────────

const MAX_TIMEOUT_MS = 30_000

registerHandler<ShellRunPayload, ShellRunResult>('shell.run', async (payload) => {
  validateCommand(payload.command)

  const timeout = Math.min(payload.timeoutMs ?? 10_000, MAX_TIMEOUT_MS)
  const cwd = payload.cwd ?? process.cwd()

  const stdout = execSync(payload.command, {
    encoding: 'utf-8',
    timeout,
    cwd,
  }) as string

  return { stdout }
})
