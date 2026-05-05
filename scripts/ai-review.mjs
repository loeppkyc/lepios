#!/usr/bin/env node
/**
 * Layer 2 AI Reviewer — runs against the staged diff.
 * Called from .husky/pre-commit after lint-staged (Layer 1) passes.
 *
 * Provider order (matches Frontier OFF, 2026-05-05):
 *   1. Local Ollama if reachable (free, local, default).
 *   2. Anthropic Sonnet if ANTHROPIC_API_KEY is set (fallback).
 *   3. Soft-skip with warning + audit log (review is a quality net,
 *      not a security gate — Layer 0 safety + Layer 1 lint already ran).
 *
 * Outputs: PASS | WARN | BLOCK per finding.
 * Exits 1 only if any BLOCK finding from a provider that actually ran.
 * Exits 0 if PASS/WARN, or if soft-skipped.
 *
 * Skip: SKIP_AI_REVIEW=1 git commit (logged to docs/review-skips.md)
 * Dry run: AI_REVIEW_DRY_RUN="BLOCK: foo" node scripts/ai-review.mjs
 */

import { execSync } from 'child_process'
import { appendFileSync, existsSync, writeFileSync } from 'fs'
import {
  REVIEW_SYSTEM_PROMPT,
  callOllama,
  chooseProvider,
  parseFindings,
  pingOllama,
} from './lib/ai-review-core.mjs'

const ANTHROPIC_MODEL = 'claude-sonnet-4-6'
const OLLAMA_BASE_URL = (
  process.env.OLLAMA_REVIEW_BASE_URL ??
  process.env.OLLAMA_BASE_URL ??
  'http://127.0.0.1:11434'
).replace(/\/$/, '')
const OLLAMA_REVIEW_MODEL = process.env.OLLAMA_REVIEW_MODEL ?? 'qwen2.5:7b'
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_REVIEW_TIMEOUT_MS ?? 30_000)

// ── Dry-run mode (testing without calling any provider) ──────────────────────
const DRY_RUN_RESPONSE = process.env.AI_REVIEW_DRY_RUN

function logSoftSkip(reason) {
  const path = 'docs/review-skips.md'
  const header = `# Review Skip Log

Entries added when commits bypass the AI Reviewer (Layer 2).
Layer 1 linters still run — only AI review is skipped.

| Timestamp | Branch | Author | Reason |
|-----------|--------|--------|--------|
`
  if (!existsSync(path)) {
    try {
      writeFileSync(path, header)
    } catch {
      return
    }
  }
  try {
    const ts = new Date().toISOString()
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim()
    const author = execSync('git config user.name', { encoding: 'utf8' }).trim()
    appendFileSync(path, `| ${ts} | ${branch} | ${author} | auto-skip: ${reason} |\n`)
  } catch {
    // Non-fatal — log failure must not block the commit
  }
}

async function getDiff() {
  try {
    return execSync('git diff --cached', { encoding: 'utf8', maxBuffer: 512 * 1024 })
  } catch {
    return null
  }
}

async function reviewWithAnthropic(diff) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing')

  // Lazy import — only paid when this branch runs.
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const msg = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 512,
    system: REVIEW_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Review this staged diff:\n\n\`\`\`diff\n${diff.slice(0, 32_000)}\n\`\`\``,
      },
    ],
  })
  return msg.content[0]?.type === 'text' ? msg.content[0].text : ''
}

async function reviewWithOllama(diff) {
  return callOllama({
    baseUrl: OLLAMA_BASE_URL,
    model: OLLAMA_REVIEW_MODEL,
    prompt: `Review this staged diff:\n\n\`\`\`diff\n${diff.slice(0, 32_000)}\n\`\`\``,
    system: REVIEW_SYSTEM_PROMPT,
    timeoutMs: OLLAMA_TIMEOUT_MS,
  })
}

function printFindings(findings, providerLabel) {
  console.log(`\n[review] ── Reviewer Agent findings (${providerLabel}) ──`)
  for (const { level, text } of findings) {
    if (level === 'BLOCK') console.error(`  ❌ ${text}`)
    else if (level === 'WARN') console.warn(`  ⚠️  ${text}`)
    else if (level === 'PASS') console.log(`  ✓  ${text}`)
    else console.log(`     ${text}`)
  }
  console.log('[review] ──────────────────────────────\n')
}

async function main() {
  const diff = await getDiff()
  if (diff === null) {
    console.error('[review] Failed to get staged diff — skipping AI review')
    return 0
  }
  if (!diff.trim()) {
    console.log('[review] No staged changes — skipping AI review')
    return 0
  }
  if (diff.length > 40_000) {
    console.warn('[review] WARN: diff exceeds 400 lines — flagged for manual review')
    console.warn('[review] Commit proceeds but large diffs risk missing issues.')
  }

  // ── Dry-run shortcut ───────────────────────────────────────────────────────
  if (DRY_RUN_RESPONSE !== undefined) {
    console.warn('[review] DRY RUN MODE — using simulated response')
    const { findings, hasBlock } = parseFindings(DRY_RUN_RESPONSE.replace(/\\n/g, '\n'))
    printFindings(findings, 'dry-run')
    return hasBlock ? 1 : 0
  }

  // ── Provider selection ─────────────────────────────────────────────────────
  const ollamaReachable = await pingOllama(OLLAMA_BASE_URL, 1500)
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY
  const provider = chooseProvider({ ollamaReachable, hasAnthropicKey })

  if (provider === 'soft-skip') {
    console.warn('')
    console.warn('[review] ⚠ SOFT-SKIP — no review provider available.')
    console.warn(`[review]   Ollama:    not reachable at ${OLLAMA_BASE_URL}`)
    console.warn(`[review]   Anthropic: ANTHROPIC_API_KEY not set`)
    console.warn('[review]   Layer 0 (safety) + Layer 1 (lint) still ran.')
    console.warn('[review]   To enable: start Ollama locally, OR set ANTHROPIC_API_KEY.')
    console.warn('')
    logSoftSkip(`no provider available (ollama=${OLLAMA_BASE_URL}, anthropic=unset)`)
    return 0
  }

  // ── Run the chosen provider ────────────────────────────────────────────────
  let response
  let providerLabel
  try {
    if (provider === 'ollama') {
      providerLabel = `ollama:${OLLAMA_REVIEW_MODEL}`
      response = await reviewWithOllama(diff)
    } else {
      providerLabel = `anthropic:${ANTHROPIC_MODEL}`
      response = await reviewWithAnthropic(diff)
    }
  } catch (err) {
    // Any provider error here → soft-skip rather than block. The review is
    // best-effort; Layer 0 + Layer 1 are the hard gates.
    console.warn(`[review] ⚠ Provider call failed (${provider}): ${err.message}`)
    console.warn('[review]   Soft-skipping Layer 2.')
    logSoftSkip(`${provider} call failed: ${err.message?.slice(0, 120)}`)
    return 0
  }

  const { findings, hasBlock } = parseFindings(response)
  printFindings(findings, providerLabel)

  if (hasBlock) {
    console.error('[review] BLOCKED — fix the issues above before committing.')
    console.error('[review] To bypass (and log the skip): SKIP_AI_REVIEW=1 git commit')
    return 1
  }
  return 0
}

// Use exitCode (not process.exit) — lets Node drain open handles cleanly
// (Anthropic SDK keep-alive sockets) before shutdown, avoiding the libuv
// UV_HANDLE_CLOSING assertion on Windows. Same precedent as
// scripts/verify-task-queue.ts:175. See docs/review-skips.md rows 234-235, 242-243.
process.exitCode = await main()
