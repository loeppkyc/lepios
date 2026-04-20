/**
 * measure-handoff-tokens.ts — real token count for formatHandoffsForPrompt(getRecentHandoffs(3))
 * Uses Anthropic messages.countTokens (claude-haiku-4-5) — same tokenizer as production.
 *
 * Run:
 *   npx tsx --tsconfig tsconfig.json scripts/measure-handoff-tokens.ts
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

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

import Anthropic from '@anthropic-ai/sdk'
import { getRecentHandoffs, formatHandoffsForPrompt } from '../lib/handoffs/client'

async function main() {
  const handoffs = await getRecentHandoffs(3)
  console.log(`Fetched ${handoffs.length} handoffs from Supabase`)

  const formatted = formatHandoffsForPrompt(handoffs)
  console.log('\n── Formatted output (' + formatted.length + ' chars) ──────────────────')
  console.log(formatted)
  console.log('──────────────────────────────────────────────────────────────────\n')

  // Anthropic token count (real, not estimated)
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // Fallback: rough estimate (Claude tokenizer ≈ 3.5 chars/token for mixed English+code)
    const estimated = Math.round(formatted.length / 3.5)
    console.log(`⚠ ANTHROPIC_API_KEY not set — estimated token count: ~${estimated}`)
    console.log(`  (estimate: ${formatted.length} chars ÷ 3.5 = ${estimated} tokens)`)
    process.exit(0)
  }

  const client = new Anthropic({ apiKey })
  const result = await client.messages.countTokens({
    model: 'claude-haiku-4-5-20251001',
    messages: [{ role: 'user', content: formatted }],
  })

  console.log(`✓ Real token count (claude-haiku-4-5 tokenizer): ${result.input_tokens}`)
  console.log(`  Budget:  2000 tokens`)
  console.log(`  Used:    ${result.input_tokens} tokens`)
  console.log(`  Margin:  ${2000 - result.input_tokens} tokens remaining`)
  console.log(result.input_tokens <= 2000 ? '✓ UNDER BUDGET' : '⚠ OVER BUDGET')
}

main().catch((e) => {
  console.error('Script error:', e)
  process.exit(1)
})
