/**
 * scan-streamlit-and-queue.ts
 *
 * Scans streamlit_app/pages/*.py, generates TaskSpec for each module,
 * writes docs/streamlit-rebuild-queue.json.
 *
 * Does NOT insert into task_queue — output is for review only.
 *
 * Run: npx tsx scripts/scan-streamlit-and-queue.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, join } from 'path'

try {
  const envLines = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8').split('\n')
  for (const line of envLines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1)
    if (key && !(key in process.env)) process.env[key] = val
  }
} catch { /* no .env.local */ }

import { scanStreamlitModules } from '../lib/scanners/streamlit-module-scanner'
import { generateTaskSpecs } from '../lib/scanners/spec-generator'
import type { Category } from '../lib/scanners/streamlit-categories'

const STREAMLIT_ROOT = resolve(process.cwd(), '..', 'streamlit_app')
const OUTPUT_PATH = resolve(process.cwd(), 'docs', 'streamlit-rebuild-queue.json')

const CATEGORY_ORDER: Category[] = [
  'amazon', 'finance', 'inventory', 'automation', 'betting_trading', 'health', 'life', 'misc',
]

const PRIORITY_SORT: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
}

function padEnd(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length)
}

function main() {
  console.log('='.repeat(60))
  console.log('LepiOS — Streamlit module scanner')
  console.log('='.repeat(60))
  console.log(`\nStreamlit root: ${STREAMLIT_ROOT}`)

  const candidates = scanStreamlitModules(STREAMLIT_ROOT)
  const specs = generateTaskSpecs(candidates)

  console.log(`\nModules found: ${candidates.length}`)

  // Summary by category
  const byCategory: Partial<Record<Category, number>> = {}
  const complexityByCategory: Partial<Record<Category, { small: number; medium: number; large: number }>> = {}

  for (const c of candidates) {
    const cat = c.category as Category
    byCategory[cat] = (byCategory[cat] ?? 0) + 1
    if (!complexityByCategory[cat]) complexityByCategory[cat] = { small: 0, medium: 0, large: 0 }
    complexityByCategory[cat]![c.complexity]++
  }

  console.log('\n── By category ─────────────────────────────────────────────')
  console.log(padEnd('Category', 18) + padEnd('Count', 8) + padEnd('S/M/L', 14) + 'Priority')
  console.log('-'.repeat(54))
  for (const cat of CATEGORY_ORDER) {
    const count = byCategory[cat] ?? 0
    if (count === 0) continue
    const cmplx = complexityByCategory[cat] ?? { small: 0, medium: 0, large: 0 }
    const sml = `${cmplx.small}/${cmplx.medium}/${cmplx.large}`
    const priority = specs.find((s) => s.priority === 'critical' && candidates.find((c) => c.category === cat))
      ? 'critical' : specs.find((s) => candidates.find((c) => c.category === cat && c.filename === s.module_filename))?.priority ?? '-'
    console.log(padEnd(cat, 18) + padEnd(String(count), 8) + padEnd(sml, 14) + priority)
  }

  // Top 5 simplest (by line_count)
  const sorted = [...candidates].sort((a, b) => a.line_count - b.line_count)
  console.log('\n── Top 5 simplest (lowest complexity — first autonomous rebuild candidates) ──')
  for (const c of sorted.slice(0, 5)) {
    console.log(`  ${padEnd(c.filename, 35)} ${c.line_count} lines  [${c.category}]`)
  }

  // Top 5 most complex
  console.log('\n── Top 5 most complex (manual rebuild only) ────────────────')
  for (const c of sorted.slice(-5).reverse()) {
    console.log(`  ${padEnd(c.filename, 35)} ${c.line_count} lines  [${c.category}]`)
  }

  // Greenfield (no audit hints)
  const greenfield = specs.filter((s) => s.audit_hints.length === 0)
  console.log(`\n── Greenfield modules (no LepiOS overlap): ${greenfield.length} ─`)
  for (const s of greenfield.slice(0, 10)) {
    console.log(`  ${s.module_filename}`)
  }
  if (greenfield.length > 10) console.log(`  ... and ${greenfield.length - 10} more`)

  // High coverage (has audit hints)
  const covered = specs.filter((s) => s.audit_hints.length >= 2)
  console.log(`\n── Already substantially covered in LepiOS: ${covered.length} ─`)
  for (const s of covered) {
    console.log(`  ${s.module_filename} → ${s.audit_hints.slice(0, 2).join(', ')}`)
  }

  // Build output JSON
  const output = {
    generated_at: new Date().toISOString(),
    streamlit_root: STREAMLIT_ROOT,
    total_modules: candidates.length,
    by_category: byCategory,
    instructions: 'Review this file before inserting into task_queue. Do not auto-queue. Each spec is one coordinator acceptance-doc sprint.',
    queue: specs
      .sort((a, b) => PRIORITY_SORT[a.priority] - PRIORITY_SORT[b.priority])
      .map((spec, i) => ({
        queue_position: i + 1,
        ...spec,
        candidate: candidates.find((c) => c.filename === spec.module_filename),
      })),
  }

  // Write output
  mkdirSync(resolve(process.cwd(), 'docs'), { recursive: true })
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8')
  console.log(`\nOutput written to: ${OUTPUT_PATH}`)
  console.log('\n' + '='.repeat(60))
}

main()
