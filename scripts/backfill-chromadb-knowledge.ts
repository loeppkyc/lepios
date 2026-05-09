#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * One-time backfill: import knowledge entries from a ChromaDB JSON export
 * into the LepiOS pgvector knowledge table.
 *
 * STEP 1 — Export from ChromaDB (run in the streamlit_app virtualenv):
 *
 *   cd streamlit_app
 *   python3 - <<'EOF'
 *   import chromadb, json
 *   client = chromadb.PersistentClient(path="ai-knowledge/vectordb")
 *   col = client.get_collection("knowledge-base")
 *   result = col.get(include=["documents","metadatas"])
 *   rows = [{"id": i, "document": d, "meta": m}
 *           for i, d, m in zip(result["ids"], result["documents"], result["metadatas"])]
 *   with open("../lepios/scripts/chromadb-export.json", "w") as f:
 *       json.dump(rows, f, indent=2)
 *   print(f"Exported {len(rows)} entries")
 *   EOF
 *
 * STEP 2 — Run this script:
 *
 *   npx tsx scripts/backfill-chromadb-knowledge.ts [--dry-run] [--limit=N]
 *   npx tsx scripts/backfill-chromadb-knowledge.ts --input=path/to/export.json
 *
 * What migrates:
 *   - source=knowledge entries (error_fix, workflow, pattern, etc.)
 *
 * What is skipped:
 *   - source=claude-memory / claude-skill / claude-brief
 *     (those are already ingested by scripts/ingest-claude-md.ts)
 *   - Keepa product collections (lego-products etc.) — Amazon catalog, not knowledge
 */

import fs from 'fs'
import path from 'path'
import { saveKnowledge } from '@/lib/knowledge/client'
import type { KnowledgeCategory } from '@/lib/knowledge/types'

const VALID_CATEGORIES = new Set<KnowledgeCategory>([
  'error_fix',
  'workflow',
  'pattern',
  'principle',
  'rule',
  'tip',
  'debug_step',
  'failed_approach',
  'translation_pattern',
])

function isValidCategory(s: string): s is KnowledgeCategory {
  return VALID_CATEGORIES.has(s as KnowledgeCategory)
}

// ── Args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : null
const inputArg = args.find((a) => a.startsWith('--input='))
const INPUT_PATH = inputArg
  ? inputArg.split('=')[1]
  : path.resolve(process.cwd(), 'scripts', 'chromadb-export.json')

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChromaEntry {
  id: string
  document: string | null
  meta: Record<string, string>
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`=== ChromaDB → pgvector knowledge backfill ===`)
  console.log(`Input: ${INPUT_PATH}`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`)

  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`Export file not found: ${INPUT_PATH}`)
    console.error('\nRun the Python export step first (see script header for instructions).')
    process.exit(1)
  }

  let entries: ChromaEntry[]
  try {
    entries = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8')) as ChromaEntry[]
  } catch (err) {
    console.error(`Failed to parse export file: ${err}`)
    process.exit(1)
  }

  console.log(`Entries in export: ${entries.length}`)
  if (LIMIT) {
    entries = entries.slice(0, LIMIT)
    console.log(`Limiting to: ${LIMIT}`)
  }

  let saved = 0
  let skipped = 0
  let failed = 0

  for (const entry of entries) {
    const { meta } = entry

    // Only migrate entries from the knowledge pipeline
    if (meta.source !== 'knowledge') {
      skipped++
      continue
    }

    const rawCategory = meta.category ?? 'pattern'
    const category: KnowledgeCategory = isValidCategory(rawCategory) ? rawCategory : 'pattern'
    const domain = meta.domain ?? 'general'
    const title = meta.title ?? entry.document?.slice(0, 100) ?? '(untitled)'

    if (DRY_RUN) {
      console.log(`  [dry] ${category}/${domain}: ${title}`)
      saved++
      continue
    }

    const id = await saveKnowledge(category, domain, title, {
      problem: meta.problem ?? undefined,
      solution: meta.solution ?? undefined,
      context: meta.context ?? undefined,
      confidence: 0.6,
      tags: ['chromadb_import'],
    })

    if (id) {
      saved++
      if (saved % 25 === 0) console.log(`  migrated ${saved}...`)
    } else {
      failed++
      console.warn(`  FAILED: ${title}`)
    }
  }

  console.log(`\n── Results ──────────────────────────────────────`)
  console.log(`  migrated:  ${saved}`)
  console.log(`  skipped (non-knowledge): ${skipped}`)
  console.log(`  failed:    ${failed}`)

  if (DRY_RUN) {
    console.log('\nDry run complete — no writes made. Remove --dry-run to apply.')
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
