/**
 * ingest-health-notes.ts
 *
 * Inserts 6 health knowledge entries (domain: 'health') about seborrheic
 * dermatitis into the Twin corpus (knowledge table) using saveKnowledge().
 *
 * Idempotent — content_hash + entity unique index (migration 0049) prevents
 * duplicate rows. Safe to run multiple times.
 *
 * Run:
 *   npx tsx --tsconfig tsconfig.json scripts/ingest-health-notes.ts
 *
 * If rows show embedding=null (Ollama unavailable), run afterward:
 *   npx tsx --tsconfig tsconfig.json scripts/backfill-embeddings.ts
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// ── Load .env.local ────────────────────────────────────────────────────────────
try {
  const lines = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8').split('\n')
  for (const line of lines) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    // Strip surrounding quotes (single or double) from .env values.
    // Also strip trailing \r\n escape sequences that Vercel CLI injects (F15).
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    // /[\\]n$/ matches a literal backslash followed by n (F15-style \n escape in value)
    v = v.replace(/[\\]n$/, '').trimEnd()
    if (k && !(k in process.env)) process.env[k] = v
  }
} catch {
  /* rely on shell env */
}

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')

import { saveKnowledge, findKnowledge } from '../lib/knowledge/client'
import { createServiceClient } from '../lib/supabase/service'
import type { KnowledgeCategory } from '../lib/knowledge/types'

// ── Entry type ────────────────────────────────────────────────────────────────

interface HealthEntry {
  entity: string
  category: KnowledgeCategory
  title: string
  problem: string
  solution: string
  context: string
  confidence: number
  tags: string[]
}

// ── The 6 entries ─────────────────────────────────────────────────────────────

const ENTRIES: HealthEntry[] = [
  // Entry 1 — Definition
  {
    entity: 'health:seborrheic-dermatitis:definition',
    category: 'principle',
    title: 'Seborrheic dermatitis — definition, cause, and affected areas',
    problem: 'What is seborrheic dermatitis? What causes it? What areas does it affect?',
    solution:
      'Seborrheic dermatitis (SD) is a chronic, relapsing inflammatory skin condition caused by an exaggerated immune response to Malassezia yeast (a normal skin commensal). Primarily affects sebum-rich areas: scalp (dandruff/flakes), face (eyebrows, nasolabial folds, ears), chest. Not contagious. Affects 3–5% of adults; more common in males. Flares and remits over years — no permanent cure.',
    context: 'Source: UpToDate, AAD clinical review.',
    confidence: 0.9,
    tags: ['health', 'seborrheic-dermatitis', 'dermatology', 'scalp', 'colin'],
  },

  // Entry 2 — Treatment
  {
    entity: 'health:seborrheic-dermatitis:treatment',
    category: 'rule',
    title: 'Seborrheic dermatitis — shampoo protocol and flare management',
    problem: 'How do you treat seborrheic dermatitis? What shampoos work and how often?',
    solution:
      'First-line: antifungal shampoos 2–3× per week during active phase — ketoconazole 2% (Nizoral), selenium sulfide 1–2.5%, or zinc pyrithione (Head & Shoulders). Leave on scalp 3–5 min before rinsing. For flares: coal tar shampoo (T-Gel) or short-course topical corticosteroid foam (clobetasol 0.05%, max 2 weeks). Maintenance: rotate shampoo types monthly to prevent tolerance. Even when clear, 1× per week antifungal shampoo prevents relapse.',
    context: 'Source: AAD guidelines.',
    confidence: 0.9,
    tags: ['health', 'seborrheic-dermatitis', 'treatment', 'shampoo', 'antifungal', 'colin'],
  },

  // Entry 3 — Triggers
  {
    entity: 'health:seborrheic-dermatitis:triggers',
    category: 'rule',
    title: 'Seborrheic dermatitis — flare triggers and lifestyle factors',
    problem: 'What triggers seborrheic dermatitis flares? What makes it worse?',
    solution:
      'Primary triggers: stress/anxiety (strongest correlation — elevated cortisol promotes Malassezia proliferation), sleep deprivation, cold/dry weather, harsh hair products (sulfates, alcohols, heavy silicones). Secondary: prolonged wet scalp, immunosuppression, some medications. Managing stress and maintaining consistent antifungal shampoo routine are the highest-leverage interventions for SD control.',
    context: 'Source: PubMed meta-analyses.',
    confidence: 0.85,
    tags: ['health', 'seborrheic-dermatitis', 'triggers', 'stress', 'lifestyle', 'colin'],
  },

  // Entry 4 — Differential diagnosis
  {
    entity: 'health:seborrheic-dermatitis:differential',
    category: 'rule',
    title: 'Seborrheic dermatitis vs scalp psoriasis vs dry scalp — how to tell apart',
    problem: 'Is this seborrheic dermatitis or scalp psoriasis? How are they different?',
    solution:
      'Dry scalp: fine powdery flakes, no redness/oiliness. SD: larger yellowish greasy flakes, diffuse redness in oily zones. Scalp psoriasis: thick silvery-white plaques, sharp defined borders, often extends beyond hairline. Sebopsoriasis is an overlap requiring both antifungal and mild steroid. SD responds to antifungal monotherapy; psoriasis needs keratolytics (salicylic acid) and higher-potency steroids.',
    context: 'Source: UpToDate, AAD.',
    confidence: 0.85,
    tags: ['health', 'seborrheic-dermatitis', 'differential-diagnosis', 'psoriasis', 'scalp'],
  },

  // Entry 5 — Prognosis
  {
    entity: 'health:seborrheic-dermatitis:prognosis',
    category: 'principle',
    title: 'Seborrheic dermatitis — long-term outlook and what to expect',
    problem: "Will seborrheic dermatitis go away? Is it curable? What's the long-term picture?",
    solution:
      'SD is chronic — not curable but highly manageable. Pattern is relapsing-remitting; most people identify their personal trigger pattern within 6–12 months. Consistent maintenance (1–2× per week antifungal shampoo even when clear) significantly reduces flare frequency and severity. SD does not cause hair loss. Does not spread person-to-person. Adult-onset SD does not spontaneously resolve.',
    context: 'Source: UpToDate, PubMed long-term outcome studies.',
    confidence: 0.88,
    tags: ['health', 'seborrheic-dermatitis', 'prognosis', 'chronic', 'management', 'colin'],
  },

  // Entry 6 — Colin's personal experience
  {
    entity: 'health:seborrheic-dermatitis:colin-experience',
    category: 'principle',
    title: "Colin's personal seborrheic dermatitis experience and management routine",
    problem:
      "What is Colin's personal experience with seborrheic dermatitis? What works for him specifically?",
    solution:
      "Colin's pattern: severe flares every 1–2 years requiring a topical steroid cream from doctor. Between flares: Nizoral (ketoconazole) every 2–3 days keeps it controlled. During active buildup: double-washing in one session removes the layer effectively. Presentation progression: starts as fine dusty white flakes, escalates to a thick scalp layer that can be manually scraped off (described as similar to old soap scum). Key personal trigger identified: chlorinated pool exposure — even without submerging head, using pool facility showers causes rapid severe flare. Nizoral is the primary maintenance tool; steroid cream is the rescue treatment.",
    context:
      "Colin's first-hand account provided 2026-05-15. Multiple cycles of this pattern confirmed.",
    confidence: 0.95,
    tags: [
      'health',
      'seborrheic-dermatitis',
      'colin',
      'personal',
      'nizoral',
      'pool-trigger',
      'management',
      'steroid-cream',
    ],
  },
]

// ── Verification ──────────────────────────────────────────────────────────────

async function verifyIngest(): Promise<void> {
  console.log('\n[2/2] Verification')

  // FTS search to confirm entries are findable
  const results = await findKnowledge('seborrheic dermatitis', { limit: 3 })
  if (results.length > 0) {
    console.log(
      `  findKnowledge("seborrheic dermatitis") -> ${results.length} result(s): ${results.map((r) => `"${r.title.slice(0, 50)}"`).join(', ')}`
    )
  } else {
    console.log('  findKnowledge("seborrheic dermatitis") -> 0 results — check FTS indexing')
  }

  // Direct count via SQL
  try {
    const supabase = createServiceClient()
    const { count } = await supabase
      .from('knowledge')
      .select('id', { count: 'exact', head: true })
      .eq('domain', 'health')
    console.log(`  SELECT COUNT(*) FROM knowledge WHERE domain='health' -> ${count ?? 0}`)
  } catch (err) {
    console.error('  Count query failed:', err)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60))
  console.log('LepiOS — Ingest Health Notes (Seborrheic Dermatitis)')
  console.log('='.repeat(60))

  console.log('\n[1/2] Inserting knowledge entries')
  let inserted = 0
  let failed = 0
  const failedTitles: string[] = []

  for (const entry of ENTRIES) {
    const id = await saveKnowledge(entry.category, 'health', entry.title, {
      entity: entry.entity,
      problem: entry.problem,
      solution: entry.solution,
      context: entry.context,
      confidence: entry.confidence,
      tags: entry.tags,
    })
    if (id) {
      inserted++
      const icon = entry.category === 'principle' ? 'P' : 'R'
      console.log(`  [${icon}] ${entry.title.slice(0, 65)}`)
    } else {
      failed++
      failedTitles.push(entry.title)
      console.error(`  FAILED: ${entry.title.slice(0, 65)}`)
    }
  }

  // Verify
  await verifyIngest()

  // Report
  console.log('\n' + '='.repeat(60))
  console.log('Ingest Report')
  console.log('='.repeat(60))
  console.log(`Entries attempted : ${ENTRIES.length}`)
  console.log(`Inserted/updated  : ${inserted}`)
  console.log(`Failed            : ${failed}`)
  if (failedTitles.length > 0) {
    console.log('\nFailed entries:')
    for (const t of failedTitles) console.log(`  - ${t}`)
  }
  console.log('='.repeat(60))

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
