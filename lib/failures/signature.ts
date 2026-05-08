/**
 * lib/failures/signature.ts
 *
 * Pure-function pattern signature builder for the failures_log.
 *
 * The signature is the load-bearing piece: too coarse and it matches every PR
 * (false recurrence detections); too fine and it never matches (no recurrence
 * caught). Initial shape (tunable later):
 *
 *   { type, file_glob?, error_class?, touched_files?, keywords? }
 *
 * Spec: docs/leverage-targets.md#t-006--failures-log-revised-2026-05-08
 */

export type FailureType =
  | 'test-fail'
  | 'migration-error'
  | 'silent-skip'
  | 'cron-skip'
  | 'cross-system-drift'
  | 'auth-leak'
  | 'route-500'
  | 'manual'

export type PatternSignature = {
  type: FailureType
  file_glob?: string
  error_class?: string
  touched_files?: string[]
  keywords?: string[]
}

export type SignatureInput = {
  type: FailureType
  files?: string[]
  error_message?: string
  http_status?: number
  free_text?: string
}

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'and',
  'or',
  'is',
  'was',
  'were',
  'be',
  'been',
  'has',
  'have',
  'had',
  'this',
  'that',
  'it',
  'its',
])

/**
 * Extract distinctive lowercase keyword tokens from free text. Keeps tokens
 * that are: ≥4 chars, not stop-words, not pure-numeric. Caps at 8 tokens
 * (most distinctive first by length-frequency heuristic) so the signature
 * stays bounded.
 */
function extractKeywords(text: string | undefined): string[] | undefined {
  if (!text) return undefined
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOP_WORDS.has(t) && !/^\d+$/.test(t))

  // Frequency-bias: keep most-distinctive (longest first, dedup).
  const seen = new Set<string>()
  const ordered = tokens
    .slice()
    .sort((a, b) => b.length - a.length)
    .filter((t) => {
      if (seen.has(t)) return false
      seen.add(t)
      return true
    })
    .slice(0, 8)

  return ordered.length > 0 ? ordered.sort() : undefined
}

function deriveFileGlob(files: string[]): string | undefined {
  if (files.length === 0) return undefined
  if (files.length === 1) return files[0]

  // Find longest common path prefix that ends at a directory boundary.
  const split = files.map((f) => f.split('/'))
  const minLen = Math.min(...split.map((p) => p.length))
  const common: string[] = []
  for (let i = 0; i < minLen; i++) {
    const seg = split[0][i]
    if (split.every((p) => p[i] === seg)) {
      common.push(seg)
    } else {
      break
    }
  }
  if (common.length === 0) return undefined
  // If all files share full path → return that single file.
  if (common.length === split[0].length && split.every((p) => p.length === common.length)) {
    return common.join('/')
  }
  return common.join('/') + '/**'
}

/**
 * Derive an error_class from an error message. Looks for known patterns:
 *   - JS error class names (TypeError, ReferenceError, ...)
 *   - HTTP status codes (4xx / 5xx grouped)
 *   - Postgres SQLSTATE codes (5-char)
 *   - Otherwise: undefined (don't invent)
 */
function deriveErrorClass(input: SignatureInput): string | undefined {
  if (input.error_message) {
    const jsClass =
      /\b(TypeError|ReferenceError|SyntaxError|RangeError|AssertionError|Error)\b/.exec(
        input.error_message
      )
    if (jsClass) return jsClass[1]
    const sqlState = /\b([0-9A-Z]{5})\b/.exec(input.error_message)
    if (sqlState && /^[A-Z0-9]/.test(sqlState[1])) return `pg:${sqlState[1]}`
  }
  if (input.http_status) {
    const tier = Math.floor(input.http_status / 100)
    if (tier === 4) return `http-4xx:${input.http_status}`
    if (tier === 5) return `http-5xx:${input.http_status}`
  }
  return undefined
}

/**
 * Build a deterministic pattern_signature from input. Output is JSONB-friendly
 * and is canonicalized (sorted arrays, omitted-when-empty fields) so two
 * signatures derived from the same logical failure produce identical JSON.
 */
export function buildSignature(input: SignatureInput): PatternSignature {
  const sig: PatternSignature = { type: input.type }

  if (input.files && input.files.length > 0) {
    const sortedFiles = input.files.slice().sort()
    sig.touched_files = sortedFiles.slice(0, 5)
    const glob = deriveFileGlob(sortedFiles)
    if (glob) sig.file_glob = glob
  }

  const errClass = deriveErrorClass(input)
  if (errClass) sig.error_class = errClass

  const keywords = extractKeywords(input.error_message ?? input.free_text)
  if (keywords) sig.keywords = keywords

  return sig
}

/**
 * Strict equality for pattern signatures. Two signatures match iff their
 * canonical JSON serialisations are identical. Used in tests; the production
 * matcher uses Postgres jsonb @> for partial overlap matching (see lib/failures/log.ts).
 */
export function signaturesEqual(a: PatternSignature, b: PatternSignature): boolean {
  return canonicalize(a) === canonicalize(b)
}

function canonicalize(sig: PatternSignature): string {
  // Object.keys order matters for JSON.stringify; sort keys.
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(sig).sort()) {
    sorted[key] = (sig as unknown as Record<string, unknown>)[key]
  }
  return JSON.stringify(sorted)
}
