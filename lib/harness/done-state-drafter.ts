/**
 * lib/harness/done-state-drafter.ts — auto-drafts done_state for modules without one.
 *
 * Called by continuous mode when the picked module shows "no spec yet" in system-inventory.md.
 * Gathers context from: Streamlit source grep, README, prior git commits, schema tables.
 * Calls Anthropic API (claude-haiku-4-5-20251001) to produce a candidate done_state.
 * Appends the draft to docs/leverage-targets.md with an [auto-drafted] tag.
 *
 * Returns {drafted: false} when no context is found — caller skips and picks next.
 * Idempotent: will not re-draft if module already has a section in leverage-targets.md.
 * Never throws.
 */

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import Anthropic from '@anthropic-ai/sdk'

// ── Types ─────────────────────────────────────────────────────────────────────

export type DraftResult =
  | { drafted: true; module_id: string; content: string }
  | { drafted: false; module_id: string; reason: string }

// ── Paths ─────────────────────────────────────────────────────────────────────

const LEVERAGE_TARGETS_PATH = path.join(process.cwd(), 'docs', 'leverage-targets.md')
const STREAMLIT_PATH = path.join(process.cwd(), '..', 'streamlit_app')
const REPO_ROOT = process.cwd()

// ── Existence check ───────────────────────────────────────────────────────────

export function hasDoneState(moduleId: string): boolean {
  try {
    const content = fs.readFileSync(LEVERAGE_TARGETS_PATH, 'utf-8')
    const escaped = moduleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Match either: a heading that names the module ID (auto-drafted),
    // or an "Inventory row" reference line (manual T-xxx specs reference the slug).
    return (
      new RegExp(`^###.*${escaped}`, 'm').test(content) ||
      new RegExp(`\\*\\*Inventory rows?:\\*\\*[^\\n]*\`${escaped}\``, 'm').test(content)
    )
  } catch {
    return false
  }
}

// ── Context gatherer ──────────────────────────────────────────────────────────

interface ModuleContext {
  streamlit_excerpts: string[]
  commit_log: string
  schema_refs: string[]
  readme_excerpt: string
}

function gatherContext(moduleId: string, moduleName: string): ModuleContext {
  const ctx: ModuleContext = {
    streamlit_excerpts: [],
    commit_log: '',
    schema_refs: [],
    readme_excerpt: '',
  }

  // Streamlit source: grep for the module name keywords (first 3 results, 20 lines each)
  try {
    const keywords = moduleName.split(/[\s/()]+/).filter((w) => w.length > 3)
    for (const kw of keywords.slice(0, 2)) {
      const result = execSync(
        `grep -r --include="*.py" -i -l "${kw}" "${STREAMLIT_PATH}" 2>/dev/null | head -3`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim()
      if (result) {
        for (const fp of result.split('\n').filter(Boolean)) {
          const excerpt = execSync(`grep -n -i "${kw}" "${fp}" 2>/dev/null | head -20`, {
            encoding: 'utf-8',
            timeout: 3000,
          }).trim()
          if (excerpt) ctx.streamlit_excerpts.push(`${path.basename(fp)}:\n${excerpt}`)
        }
      }
    }
  } catch {
    // Non-fatal
  }

  // Git commit log: last 15 commits mentioning the module or its keywords
  try {
    const searchTerm = moduleId.replace(/-/g, '[-_]')
    ctx.commit_log = execSync(
      `git log --oneline -50 2>/dev/null | grep -i "${searchTerm}" | head -15`,
      { encoding: 'utf-8', timeout: 5000, cwd: REPO_ROOT }
    ).trim()
  } catch {
    // Non-fatal
  }

  // Schema refs: grep supabase migrations for table names related to the module
  try {
    const slug = moduleId.replace(/^cockpit-|^harness-|^behav-|^meas-/, '')
    const result = execSync(
      `grep -r --include="*.sql" -i -l "${slug}" "${path.join(REPO_ROOT, 'supabase', 'migrations')}" 2>/dev/null | head -3`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim()
    if (result) {
      for (const fp of result.split('\n').filter(Boolean)) {
        const tables = execSync(`grep -i "CREATE TABLE" "${fp}" 2>/dev/null | head -5`, {
          encoding: 'utf-8',
          timeout: 3000,
        }).trim()
        if (tables) ctx.schema_refs.push(tables)
      }
    }
  } catch {
    // Non-fatal
  }

  // README: check if there's a relevant README or acceptance doc
  try {
    const slug = moduleId.replace(/^cockpit-|^harness-/, '')
    const result = execSync(
      `find "${path.join(REPO_ROOT, 'docs')}" -name "*${slug}*" -o -name "*${slug.split('-')[0]}*" 2>/dev/null | head -2`,
      { encoding: 'utf-8', timeout: 3000 }
    ).trim()
    if (result) {
      const fp = result.split('\n')[0]
      const readmeContent = fs.readFileSync(fp, 'utf-8').slice(0, 800)
      ctx.readme_excerpt = `${path.basename(fp)}:\n${readmeContent}`
    }
  } catch {
    // Non-fatal
  }

  return ctx
}

function hasAnyContext(ctx: ModuleContext): boolean {
  return (
    ctx.streamlit_excerpts.length > 0 ||
    ctx.commit_log.length > 0 ||
    ctx.schema_refs.length > 0 ||
    ctx.readme_excerpt.length > 0
  )
}

// ── Anthropic drafter ─────────────────────────────────────────────────────────

async function callDraftApi(
  moduleId: string,
  moduleName: string,
  ctx: ModuleContext
): Promise<string> {
  const client = new Anthropic()

  const contextParts: string[] = []
  if (ctx.streamlit_excerpts.length > 0) {
    contextParts.push(
      `Streamlit source snippets:\n${ctx.streamlit_excerpts.slice(0, 2).join('\n\n')}`
    )
  }
  if (ctx.commit_log) {
    contextParts.push(`Related git commits:\n${ctx.commit_log}`)
  }
  if (ctx.schema_refs.length > 0) {
    contextParts.push(`Related schema tables:\n${ctx.schema_refs.join('\n')}`)
  }
  if (ctx.readme_excerpt) {
    contextParts.push(`Related doc:\n${ctx.readme_excerpt}`)
  }

  const prompt = `You are writing a done_state spec for a LepiOS module. LepiOS is Colin's personal life OS built in Next.js + Supabase.

Module ID: ${moduleId}
Module name: ${moduleName}

Context from codebase:
${contextParts.join('\n\n---\n\n')}

Write a concise done_state spec (150–300 words) in the style of this example:
"done_state: /scanner renders last 90 days of Amazon + non-Amazon receipts pulled from daily Gmail scanner, parsed into receipt_lines table (vendor, date, line_items[], total, tax, source_email_id, reconciled_bool). Reconciliation runs against bank/CC transactions, surfaces unmatched in cockpit. Sortable/filterable by vendor, date, amount, reconciled status."

The done_state should describe:
1. What the user sees/can do (page, UI, actions)
2. What data it pulls and from where
3. Key behaviors or rules
4. Any table names if inferrable from context

Do NOT include headings, bullet points, or markdown. Write as continuous prose starting with "done_state: /...". Keep it under 300 words.`

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  })

  return response.content[0].type === 'text' ? response.content[0].text.trim() : ''
}

// ── File writer ───────────────────────────────────────────────────────────────

function appendDraftToFile(moduleId: string, moduleName: string, draftContent: string): void {
  const today = new Date().toISOString().slice(0, 10)
  const section = `
### ${moduleId} — ${moduleName} [auto-drafted ${today}, review on next inspection]

- **Inventory row:** \`${moduleId}\`
- **Status:** auto-drafted — no manual spec exists yet
- **Build priority:** TBD

${draftContent}

**metric:** TBD (auto-drafted — coordinator to refine at Phase 1c)

**benchmark:** TBD

**surface:** TBD
`

  const current = fs.readFileSync(LEVERAGE_TARGETS_PATH, 'utf-8')
  // Append before the last `---` separator if one exists, otherwise append to end
  const lastSepIdx = current.lastIndexOf('\n---\n')
  let updated: string
  if (lastSepIdx > 0) {
    updated =
      current.slice(0, lastSepIdx) + '\n' + section + '\n---\n' + current.slice(lastSepIdx + 5)
  } else {
    updated = current + '\n' + section
  }

  fs.writeFileSync(LEVERAGE_TARGETS_PATH, updated, 'utf-8')
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function draftDoneState(moduleId: string, moduleName: string): Promise<DraftResult> {
  // Idempotency check
  if (hasDoneState(moduleId)) {
    return {
      drafted: false,
      module_id: moduleId,
      reason: 'done_state already exists in leverage-targets.md',
    }
  }

  // Gather context
  const ctx = gatherContext(moduleId, moduleName)

  if (!hasAnyContext(ctx)) {
    return {
      drafted: false,
      module_id: moduleId,
      reason: 'no context found (no Streamlit source, commits, schema refs, or docs)',
    }
  }

  // Draft via Anthropic API
  let draftContent: string
  try {
    draftContent = await callDraftApi(moduleId, moduleName, ctx)
  } catch (err) {
    return { drafted: false, module_id: moduleId, reason: `Anthropic API error: ${String(err)}` }
  }

  if (!draftContent) {
    return { drafted: false, module_id: moduleId, reason: 'Anthropic API returned empty response' }
  }

  // Append to leverage-targets.md
  try {
    appendDraftToFile(moduleId, moduleName, draftContent)
  } catch (err) {
    return { drafted: false, module_id: moduleId, reason: `file write error: ${String(err)}` }
  }

  return { drafted: true, module_id: moduleId, content: draftContent }
}
