/**
 * verify-rag.ts — one-off script to confirm retrieveContext() returns
 * relevant seeded knowledge entries.
 *
 * Run from project root:
 *   npx tsx --tsconfig tsconfig.json scripts/verify-rag.ts
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local before any Supabase calls (env vars read at call time, not import time)
const envPath = resolve(process.cwd(), '.env.local')
const envLines = readFileSync(envPath, 'utf-8').split('\n')
for (const line of envLines) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) continue
  const key = trimmed.slice(0, eqIdx).trim()
  const val = trimmed.slice(eqIdx + 1)
  if (key && !(key in process.env)) process.env[key] = val
}

import { retrieveContext, findKnowledge, getKnowledgeStats } from '../lib/knowledge/client'

const QUERIES = [
  {
    label: 'Keepa token budget',
    query: 'Keepa token budget exhaustion',
    expectCategory: 'error_fix',
    expectKeyword: 'Keepa',
  },
  {
    label: 'ISBN scan no ASIN found',
    query: 'ISBN scan fails no ASIN found retry',
    expectCategory: 'error_fix',
    expectKeyword: 'ASIN',
  },
  {
    label: 'Agent decision authority',
    query: 'agents propose Colin decides autonomous decision authority',
    expectCategory: 'principle',
    expectKeyword: 'Colin',
  },
]

async function main() {
  console.log('='.repeat(60))
  console.log('LepiOS RAG — retrieveContext() verification')
  console.log('='.repeat(60))

  const stats = await getKnowledgeStats()
  console.log(`\nKnowledge base: ${stats.total} entries, avg confidence ${stats.avgConfidence}`)
  console.log('By category:', JSON.stringify(stats.byCategory, null, 2))

  let allPassed = true

  for (const { label, query, expectKeyword } of QUERIES) {
    console.log('\n' + '─'.repeat(60))
    console.log(`Query: "${query}"`)
    console.log(`Expected keyword in result: "${expectKeyword}"`)
    console.log('─'.repeat(60))

    const context = await retrieveContext(query, { limit: 3 })

    if (!context) {
      console.error(`❌ FAIL [${label}]: retrieveContext returned empty string`)
      allPassed = false
      continue
    }

    if (!context.includes(expectKeyword)) {
      console.error(`❌ FAIL [${label}]: result does not contain "${expectKeyword}"`)
      console.log('Got:\n', context)
      allPassed = false
      continue
    }

    console.log(`✓ PASS [${label}]`)
    console.log(context)
  }

  // Also test findKnowledge directly to check FTS
  console.log('\n' + '─'.repeat(60))
  console.log('Direct findKnowledge("check before build") — principle retrieval')
  console.log('─'.repeat(60))
  const hits = await findKnowledge('check before build', { limit: 3 })
  if (hits.length === 0) {
    console.error('❌ FAIL: findKnowledge returned 0 results for "check before build"')
    allPassed = false
  } else {
    console.log(`✓ PASS: ${hits.length} result(s)`)
    for (const h of hits) {
      console.log(`  [${h.category}] ${h.title} (conf: ${h.confidence})`)
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log(allPassed ? '✓ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED')
  console.log('='.repeat(60))
  process.exit(allPassed ? 0 : 1)
}

main().catch((e) => {
  console.error('Script error:', e)
  process.exit(1)
})
