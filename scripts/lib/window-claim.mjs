// Shared utilities for the multi-window protocol.
// Used by scripts/window-{start,end,status,scope-check}.mjs and the pre-commit hook.

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
  unlinkSync,
} from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'

export const ACTIVE_DIR = '.claude/active-windows'
export const STALE_MS = 30 * 60 * 1000 // 30 minutes — heartbeat older than this = window is dead

/** Replace path separators so a branch like `feat/foo/bar` lands as one flat filename. */
export function branchToFilename(branch) {
  return `${branch.replace(/\//g, '__')}.json`
}

/** Current branch via git. Returns 'HEAD' if detached. */
export function currentBranch() {
  return execSync('git rev-parse --abbrev-ref HEAD').toString().trim()
}

/** True iff the working tree (tracked files only — untracked files are tolerated) has no changes. */
export function workingTreeClean() {
  // -uno = ignore untracked files (they're fine for claim purposes)
  return execSync('git status --porcelain -uno').toString().trim() === ''
}

/** List files staged for the next commit. */
export function stagedFiles() {
  const out = execSync('git diff --cached --name-only').toString().trim()
  return out ? out.split('\n') : []
}

export function ensureActiveDir() {
  if (!existsSync(ACTIVE_DIR)) mkdirSync(ACTIVE_DIR, { recursive: true })
}

export function loadAllClaims() {
  if (!existsSync(ACTIVE_DIR)) return []
  return readdirSync(ACTIVE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const data = JSON.parse(readFileSync(join(ACTIVE_DIR, f), 'utf8'))
        return { ...data, _file: f, _path: join(ACTIVE_DIR, f) }
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

export function loadClaimForBranch(branch) {
  const path = join(ACTIVE_DIR, branchToFilename(branch))
  if (!existsSync(path)) return null
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    return { ...data, _path: path }
  } catch {
    return null
  }
}

export function writeClaim(claim) {
  ensureActiveDir()
  const path = join(ACTIVE_DIR, branchToFilename(claim.branch))
  writeFileSync(path, JSON.stringify(claim, null, 2) + '\n')
  return path
}

export function deleteClaim(branch) {
  const path = join(ACTIVE_DIR, branchToFilename(branch))
  if (existsSync(path)) {
    unlinkSync(path)
    return path
  }
  return null
}

/** Remove claims whose last_heartbeat is older than STALE_MS. Returns array of deleted file paths. */
export function pruneStaleClaims() {
  const now = Date.now()
  const deleted = []
  for (const c of loadAllClaims()) {
    const beat = Date.parse(c.last_heartbeat || c.started_at || 0)
    if (Number.isFinite(beat) && now - beat > STALE_MS) {
      try {
        unlinkSync(c._path)
        deleted.push(c._path)
      } catch {
        // ignore — best-effort
      }
    }
  }
  return deleted
}

/** Bump last_heartbeat on the branch's claim file (if present). No-op if no claim. */
export function heartbeat(branch) {
  const claim = loadClaimForBranch(branch)
  if (!claim) return false
  claim.last_heartbeat = new Date().toISOString()
  delete claim._path
  writeClaim(claim)
  return true
}

/**
 * Translate a glob pattern to a RegExp.
 * Supports:
 *   `**`  → match any number of path segments (greedy)
 *   `*`   → match any chars except `/`
 *   `?`   → match one char except `/`
 *   exact path segments
 *
 * Examples:
 *   "lib/auth/**"            matches lib/auth/foo.ts and lib/auth/sub/dir/x.ts
 *   "app/api/admin/*\/route.ts"  matches app/api/admin/users/route.ts
 *   "supabase/migrations/0140_*" matches supabase/migrations/0140_anything.sql
 */
export function globToRegex(glob) {
  let re = '^'
  let i = 0
  while (i < glob.length) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      // ** — match anything including /. Eat trailing / if present.
      re += '.*'
      i += 2
      if (glob[i] === '/') i += 1
    } else if (c === '*') {
      re += '[^/]*'
      i += 1
    } else if (c === '?') {
      re += '[^/]'
      i += 1
    } else if ('.+()[]{}^$|\\'.includes(c)) {
      re += '\\' + c
      i += 1
    } else {
      re += c
      i += 1
    }
  }
  re += '$'
  return new RegExp(re)
}

export function fileMatchesScope(filePath, scope) {
  return scope.some((g) => globToRegex(g).test(filePath))
}

/**
 * Heuristic overlap detection between two scope arrays.
 * For each pair (a, b) of globs, extract the literal prefix (everything before the first `*` or `?`)
 * and check if one is a prefix of the other. Conservative — may report false positives, but never
 * misses a true overlap on directory trees.
 *
 * Returns an array of {mine, theirs} overlap pairs (empty if no overlap).
 */
export function scopeOverlaps(myScope, theirScope) {
  const overlaps = []
  for (const a of myScope) {
    const aPrefix = a.replace(/[*?].*$/, '')
    for (const b of theirScope) {
      const bPrefix = b.replace(/[*?].*$/, '')
      // Skip empty prefixes — `**` alone would match everything; treat as overlap of root.
      if (!aPrefix && !bPrefix) {
        overlaps.push({ mine: a, theirs: b })
        continue
      }
      if (aPrefix && bPrefix && (aPrefix.startsWith(bPrefix) || bPrefix.startsWith(aPrefix))) {
        overlaps.push({ mine: a, theirs: b })
      }
    }
  }
  return overlaps
}
