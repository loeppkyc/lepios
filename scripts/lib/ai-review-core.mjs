/**
 * Pure helpers for the AI Reviewer pre-commit hook.
 *
 * Kept .mjs (not .ts) so scripts/ai-review.mjs can import without a build
 * step. Vitest still tests these directly.
 */

/**
 * Decide which provider to use for review.
 *
 * Priority:
 *   1. Ollama, if reachable. Free, local, matches Frontier OFF stance.
 *   2. Anthropic, if ANTHROPIC_API_KEY is set. Fallback for when Ollama is down.
 *   3. soft-skip: warn + log + exit 0. Hook is a quality net, not a security gate.
 *
 * @param {{ ollamaReachable: boolean, hasAnthropicKey: boolean }} state
 * @returns {'ollama' | 'anthropic' | 'soft-skip'}
 */
export function chooseProvider(state) {
  if (state.ollamaReachable) return 'ollama'
  if (state.hasAnthropicKey) return 'anthropic'
  return 'soft-skip'
}

/**
 * Parse the model's PASS/WARN/BLOCK findings response into structured form.
 *
 * Each non-empty line should start with PASS:, WARN:, or BLOCK:. Lines without
 * a recognized prefix are kept as continuation lines (printed but not classified).
 *
 * @param {string} response
 * @returns {{ findings: Array<{ level: 'PASS' | 'WARN' | 'BLOCK' | 'OTHER', text: string }>, hasBlock: boolean }}
 */
export function parseFindings(response) {
  const lines = response.trim().split('\n').filter(Boolean)
  const findings = []
  let hasBlock = false
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('BLOCK:')) {
      findings.push({ level: 'BLOCK', text: line })
      hasBlock = true
    } else if (line.startsWith('WARN:')) {
      findings.push({ level: 'WARN', text: line })
    } else if (line.startsWith('PASS:')) {
      findings.push({ level: 'PASS', text: line })
    } else {
      findings.push({ level: 'OTHER', text: line })
    }
  }
  return { findings, hasBlock }
}

/**
 * The system prompt sent to whichever provider runs the review.
 * Same content for Ollama and Anthropic so output parsing stays uniform.
 */
export const REVIEW_SYSTEM_PROMPT = `You are a strict code reviewer for a Next.js 16 + TypeScript + Supabase project.
Review the staged git diff and output findings.

For each issue found, output exactly one line in this format:
  LEVEL: description

Where LEVEL is one of:
  BLOCK — must not commit (secret leak, debugger, broken contract)
  WARN  — should fix soon but not a blocker (todo markers, console.log, style issues)
  PASS  — everything looks good (output at least one PASS line if nothing is wrong)

Checklist — check ALL of these:
1. SECRETS: No Telegram tokens, Supabase keys (sb_secret_, eyJ JWTs), AWS keys (AKIA), Stripe keys (sk_live_, rk_live_), GitHub PATs (ghp_, github_pat_), or suspicious long hex/base64 strings (32+ chars) hardcoded in code
2. DEBUG: No console.log, console.debug, or debugger statements in non-test production paths
3. TODOS: Flag any TODO, FIXME, or XXX comment markers
4. INTENT: Does the diff content match what a sensible commit message would say? Flag if scope is wildly inconsistent
5. TESTS: If feature/logic code changed, were acceptance tests also updated?
6. TYPES: No bare 'any' types; no @ts-ignore without a trailing // reason: comment
7. SIZE: If diff is very large (400+ lines), flag for manual review
8. SCHEMA: Supabase table reads/writes use column names that exist in the known schema (deals, bets, trades, orders, transactions tables)
9. CONTRACTS: API handler function signatures match their TypeScript types
10. GROUNDING: Hardcoded data that looks AI-generated or placeholder (fake names, lorem ipsum, placeholder UUIDs) gets flagged

Output only the finding lines. No preamble, no markdown, no explanations beyond the finding line itself.
Minimum one line of output. If nothing is wrong: "PASS: diff looks clean"`

/**
 * Probe Ollama for reachability with a tight timeout. Returns true if /api/tags
 * responds 2xx within timeoutMs, false otherwise.
 *
 * @param {string} baseUrl - e.g. http://127.0.0.1:11434
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
export async function pingOllama(baseUrl, timeoutMs = 1500) {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Call Ollama /api/generate non-streaming. Returns the text response or throws.
 *
 * @param {{ baseUrl: string, model: string, prompt: string, system: string, timeoutMs: number }} opts
 * @returns {Promise<string>}
 */
export async function callOllama(opts) {
  const url = `${opts.baseUrl.replace(/\/$/, '')}/api/generate`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      prompt: opts.prompt,
      system: opts.system,
      stream: false,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs),
  })
  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}`)
  }
  const data = await res.json()
  return typeof data.response === 'string' ? data.response : ''
}
