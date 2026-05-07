// Multi-window protocol — migration-claims helpers.
// Used by scripts/next-migration-number.mjs and (potentially) other tooling
// that reads/writes .claude/migration-claims.json.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

const CLAIMS_FILE = '.claude/migration-claims.json'

/**
 * Read the local working-tree copy of migration-claims.json.
 * Throws if file missing or unparseable — callers should treat this as fatal.
 */
export function readLocalClaims() {
  if (!existsSync(CLAIMS_FILE)) {
    throw new Error(`${CLAIMS_FILE} not found`)
  }
  return JSON.parse(readFileSync(CLAIMS_FILE, 'utf8'))
}

/**
 * Read migration-claims.json as it exists on origin/main. Returns null if the
 * file doesn't exist on origin/main (very early repo state) — callers fall
 * back to local view in that case.
 */
export function readOriginMainClaims() {
  try {
    const out = execSync('git show origin/main:.claude/migration-claims.json', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return JSON.parse(out)
  } catch {
    return null
  }
}

/**
 * Run `git fetch origin main` quietly. Returns true on success, false on
 * failure (offline, auth, etc) — callers fall back to local view.
 */
export function fetchOriginMain() {
  try {
    execSync('git fetch -q origin main', { stdio: ['ignore', 'pipe', 'pipe'] })
    return true
  } catch {
    return false
  }
}

/**
 * Compute the next-available migration number from a claims object. The number
 * returned is what the next migration's filename should start with (4-digit
 * zero-padded by the caller).
 *
 * Logic: max(claimed integer keys, next_available) → that + 1 if the slot is
 * currently the value of next_available; otherwise next_available is already
 * the right answer. Works for both old (next_available accurate) and drifted
 * (next_available stale, but max claimed is higher) JSON.
 */
export function computeNextNumber(claims) {
  const claimed = Object.keys(claims.claimed || {})
    .map((k) => Number.parseInt(k, 10))
    .filter((n) => Number.isFinite(n))
  const maxClaimed = claimed.length > 0 ? Math.max(...claimed) : 0
  const declared = Number.isFinite(claims.next_available) ? claims.next_available : 0
  return Math.max(maxClaimed + 1, declared)
}

/** Pad an integer to 4 digits with leading zeros: 142 → "0142". */
export function padNumber(n) {
  return String(n).padStart(4, '0')
}

/**
 * Compare local vs origin/main claims. Returns:
 *   { inSync: true } when local matches origin/main
 *   { inSync: false, behind: [...numbers], ahead: [...numbers] } otherwise
 *
 * "behind" = claims present on origin/main but not local
 * "ahead"  = claims present locally but not on origin/main
 */
export function compareClaims(local, origin) {
  if (origin == null) return { inSync: true }
  const localKeys = new Set(Object.keys(local.claimed || {}))
  const originKeys = new Set(Object.keys(origin.claimed || {}))
  const behind = [...originKeys].filter((k) => !localKeys.has(k))
  const ahead = [...localKeys].filter((k) => !originKeys.has(k))
  if (behind.length === 0 && ahead.length === 0) return { inSync: true }
  return { inSync: false, behind, ahead }
}

export { CLAIMS_FILE }
