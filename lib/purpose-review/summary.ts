/**
 * lib/purpose-review/summary.ts
 *
 * Generates a 5-bullet module summary for the purpose_review gate.
 * Phase 0.5 in all Streamlit port chunks.
 *
 * Bullet (a)–(d) are deterministic from streamlit_modules row + file header.
 * Bullet (e) calls Ollama ANALYSIS; falls back to Claude haiku on failure.
 *
 * Output fits in one Telegram message (≤ 4096 chars).
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generate, OllamaUnreachableError, autoSelectModel } from '@/lib/ollama/client'

// ── Constants ─────────────────────────────────────────────────────────────────

const TELEGRAM_MAX_CHARS = 4096
const SOURCE_HEADER_LINES = 30
// Relative path from project root to the Streamlit app directory
const STREAMLIT_BASE = join(process.cwd(), '..', 'streamlit_app')

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StreamlitModuleRow {
  path: string
  classification: string | null
  suggested_tier: string | null
  f17_signal: string | null
  f18_metric_candidate: string | null
  lines: number | null
  external_deps: string[] | null
  notes: string | null
}

export interface ModuleSummary {
  module_path: string
  suggested_tier: string
  lines: number
  classification: string
  does: string
  goal: string
  issues: string
  baked_in: string
  could_instead: string
}

// ── Source file reader ────────────────────────────────────────────────────────

function readSourceHeader(modulePath: string): string {
  try {
    const fullPath = join(STREAMLIT_BASE, modulePath)
    const content = readFileSync(fullPath, 'utf-8')
    const lines = content.split('\n').slice(0, SOURCE_HEADER_LINES)
    return lines.join('\n')
  } catch {
    return '(source file unreadable)'
  }
}

// ── Deterministic bullet generators ──────────────────────────────────────────

function bulletDoes(row: StreamlitModuleRow, header: string): string {
  if (row.notes) return row.notes.slice(0, 200)

  // Extract first non-empty docstring line from header as fallback
  const docMatch = header.match(/"""([^"]+)"""/)
  if (docMatch) return docMatch[1].trim().slice(0, 200)

  const classMatch = header.match(/^class\s+(\w+)/m)
  const defMatch = header.match(/^def\s+(\w+)/m)
  if (classMatch) return `Defines ${classMatch[1]} class`
  if (defMatch) return `Defines ${defMatch[1]} function`

  return `${row.classification ?? 'unknown'} module at ${row.path}`
}

function bulletGoal(row: StreamlitModuleRow): string {
  const f17 = row.f17_signal
  if (f17) return `Feeds behavioral signal: ${f17.slice(0, 200)}`
  const f18 = row.f18_metric_candidate
  if (f18) return `Tracks metric: ${f18.slice(0, 200)}`
  return `${row.classification ?? 'General'} functionality for the Streamlit OS`
}

function bulletIssues(row: StreamlitModuleRow, header: string): string {
  const issues: string[] = []
  if (header.includes('TODO') || header.includes('FIXME')) issues.push('has TODO/FIXME markers')
  if (header.includes('st.session_state')) issues.push('relies on Streamlit session state')
  if (header.includes('gspread') || header.includes('google.oauth'))
    issues.push('Google Sheets dependency')
  if (header.includes('st.secrets')) issues.push('uses st.secrets (must migrate to env vars)')
  if ((row.lines ?? 0) > 500)
    issues.push(`large file (${row.lines} lines) — may need decomposition`)
  return issues.length > 0 ? issues.join('; ') : 'no obvious issues in header'
}

function bulletBakedIn(row: StreamlitModuleRow, header: string): string {
  const deps: string[] = []
  if (row.external_deps && row.external_deps.length > 0) {
    deps.push(...row.external_deps.map((d) => d.slice(0, 40)))
  }
  // Infer from imports in header
  const importMatches = header.match(/^(?:import|from)\s+(\S+)/gm)
  if (importMatches) {
    const external = importMatches
      .map((m) => m.split(/\s+/)[1])
      .filter((m) => !m.startsWith('.') && !m.startsWith('streamlit') && !m.startsWith('st'))
      .slice(0, 5)
    deps.push(...external)
  }
  const unique = [...new Set(deps)].slice(0, 6)
  return unique.length > 0 ? unique.join(', ') : 'standard library only'
}

// ── Ollama / Claude fallback for bullet (e) ───────────────────────────────────

async function generateAlternatives(row: StreamlitModuleRow, header: string): Promise<string> {
  const prompt = `You are analyzing a Streamlit module for possible port to a Next.js app.
Module path: ${row.path}
Classification: ${row.classification ?? 'unknown'}
Lines: ${row.lines ?? 'unknown'}
First ${SOURCE_HEADER_LINES} lines of source:
${header}

In 1–2 short sentences, suggest an alternative approach or architecture that would be better than a direct port. Be specific and concise.`

  try {
    const result = await generate(prompt, { task: 'analysis', model: autoSelectModel('analysis') })
    return result.text.trim().slice(0, 300)
  } catch (err) {
    if (err instanceof OllamaUnreachableError) {
      // Claude haiku fallback
      return await callClaudeHaikuFallback(prompt)
    }
    throw err
  }
}

async function callClaudeHaikuFallback(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return '(Ollama unreachable; Claude API key not configured)'

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Claude API error ${res.status}: ${body.slice(0, 200)}`)
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text: string }>
  }
  return (data.content[0]?.text ?? '').trim().slice(0, 300)
}

// ── formatReviewMessage ───────────────────────────────────────────────────────

export function formatReviewMessage(summary: ModuleSummary): string {
  const msg = [
    `📋 Port Review — ${summary.module_path}`,
    `Tier ${summary.suggested_tier} · ${summary.lines} lines · ${summary.classification}`,
    '',
    `(a) Does: ${summary.does}`,
    `(b) Goal: ${summary.goal}`,
    `(c) Issues: ${summary.issues}`,
    `(d) Baked in: ${summary.baked_in}`,
    `(e) Could instead: ${summary.could_instead}`,
  ].join('\n')

  if (msg.length <= TELEGRAM_MAX_CHARS) return msg

  // Truncate (e) to fit
  const overhead = msg.length - summary.could_instead.length
  const budget = TELEGRAM_MAX_CHARS - overhead - 3
  const truncated = summary.could_instead.slice(0, Math.max(20, budget)) + '…'

  return [
    `📋 Port Review — ${summary.module_path}`,
    `Tier ${summary.suggested_tier} · ${summary.lines} lines · ${summary.classification}`,
    '',
    `(a) Does: ${summary.does}`,
    `(b) Goal: ${summary.goal}`,
    `(c) Issues: ${summary.issues}`,
    `(d) Baked in: ${summary.baked_in}`,
    `(e) Could instead: ${truncated}`,
  ].join('\n')
}

// ── generateModuleSummary ─────────────────────────────────────────────────────

export async function generateModuleSummary(
  modulePath: string,
  db: SupabaseClient
): Promise<string> {
  // Read streamlit_modules row
  const { data: row, error } = await db
    .from('streamlit_modules')
    .select(
      'path, classification, suggested_tier, f17_signal, f18_metric_candidate, lines, external_deps, notes'
    )
    .eq('path', modulePath)
    .maybeSingle()

  if (error || !row) {
    throw new Error(`streamlit_modules row not found for path: ${modulePath}`)
  }

  const moduleRow = row as StreamlitModuleRow
  const header = readSourceHeader(modulePath)

  const does = bulletDoes(moduleRow, header)
  const goal = bulletGoal(moduleRow)
  const issues = bulletIssues(moduleRow, header)
  const baked_in = bulletBakedIn(moduleRow, header)
  const could_instead = await generateAlternatives(moduleRow, header)

  const summary: ModuleSummary = {
    module_path: modulePath,
    suggested_tier: moduleRow.suggested_tier ?? 'unknown',
    lines: moduleRow.lines ?? 0,
    classification: moduleRow.classification ?? 'unknown',
    does,
    goal,
    issues,
    baked_in,
    could_instead,
  }

  return formatReviewMessage(summary)
}
