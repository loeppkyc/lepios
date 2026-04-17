#!/usr/bin/env node
/**
 * Layer 2 AI Reviewer — runs Sonnet on the staged diff.
 * Called from .husky/pre-commit after lint-staged (Layer 1) passes.
 *
 * Outputs: PASS | WARN | BLOCK per finding.
 * Exits 1 if any finding is BLOCK (blocks the commit).
 * Exits 0 if only PASS or WARN findings.
 *
 * Skip: SKIP_AI_REVIEW=1 git commit (logged to docs/review-skips.md)
 */

import { execSync } from 'child_process'
import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-4-6'

// ── Dry-run mode: simulate AI response from env var (for testing without API key) ──
// Usage: AI_REVIEW_DRY_RUN="BLOCK: hardcoded secret\nWARN: TODO marker" node scripts/ai-review.mjs
const DRY_RUN_RESPONSE = process.env.AI_REVIEW_DRY_RUN

// ── Get staged diff ────────────────────────────────────────────────────────────
let diff
try {
  diff = execSync('git diff --cached', { encoding: 'utf8', maxBuffer: 512 * 1024 })
} catch {
  console.error('[review] Failed to get staged diff — skipping AI review')
  process.exit(0)
}

if (!diff.trim()) {
  console.log('[review] No staged changes — skipping AI review')
  process.exit(0)
}

// Flag oversized diffs for manual review
if (diff.length > 40_000) {
  console.warn('[review] WARN: diff exceeds 400 lines — flagged for manual review')
  console.warn('[review] Commit proceeds but large diffs risk missing issues.')
}

// ── Call Sonnet (or use dry-run) ──────────────────────────────────────────────
let response

if (DRY_RUN_RESPONSE !== undefined) {
  console.warn('[review] DRY RUN MODE — using simulated AI response')
  response = DRY_RUN_RESPONSE.replace(/\\n/g, '\n')
} else {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('')
    console.error('[review] ✗ BLOCKED — ANTHROPIC_API_KEY not set in environment.')
    console.error('[review]   The Reviewer Agent cannot run without it.')
    console.error('[review]   Fix: add to your shell profile and reload:')
    console.error('[review]     export ANTHROPIC_API_KEY=sk-ant-...')
    console.error('[review]   Bypass (logs reason): ./scripts/commit-skip.sh "reason"')
    console.error('[review]   Raw bypass (no log):  git commit --no-verify')
    console.error('')
    process.exit(1)
  }

  const client = new Anthropic({ apiKey })

  const SYSTEM = `You are a strict code reviewer for a Next.js 16 + TypeScript + Supabase project.
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

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Review this staged diff:\n\n\`\`\`diff\n${diff.slice(0, 32_000)}\n\`\`\``,
        },
      ],
    })
    response = msg.content[0].type === 'text' ? msg.content[0].text : ''
  } catch (err) {
    console.warn('[review] AI review call failed — skipping Layer 2:', err.message)
    process.exit(0)
  }
}

// ── Parse and display findings ─────────────────────────────────────────────────
const lines = response.trim().split('\n').filter(Boolean)
let hasBlock = false

console.log('\n[review] ── Reviewer Agent findings ──')
for (const line of lines) {
  if (line.startsWith('BLOCK:')) {
    console.error(`  ❌ ${line}`)
    hasBlock = true
  } else if (line.startsWith('WARN:')) {
    console.warn(`  ⚠️  ${line}`)
  } else if (line.startsWith('PASS:')) {
    console.log(`  ✓  ${line}`)
  } else {
    console.log(`     ${line}`)
  }
}
console.log('[review] ──────────────────────────────\n')

if (hasBlock) {
  console.error('[review] BLOCKED — fix the issues above before committing.')
  console.error('[review] To bypass (and log the skip): SKIP_AI_REVIEW=1 git commit')
  process.exit(1)
}

process.exit(0)
