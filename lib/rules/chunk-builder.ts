/**
 * lib/rules/chunk-builder.ts
 *
 * Converts Rule registry entries into KnowledgeChunk objects for ingest into
 * the knowledge table. Extracted from ingest-claude-md.ts so the conversion
 * logic is testable without importing the ingest script (which has side effects:
 * Supabase client init, Ollama health check, .env.local load).
 *
 * Entity ID scheme: cmdingest:lepios:arch-F{number}-{name}
 * F21 (name='acceptance-tests-first') produces entity ID that exactly matches
 * the existing DB row — idempotency check will SKIP on re-run.
 */

import type { Rule } from './registry'

export type KnowledgeChunk = {
  entity: string
  category: 'rule' | 'principle'
  domain: string
  title: string
  problem: string
  solution: string
  context: string
  confidence: number
}

/**
 * Converts a single Rule into a KnowledgeChunk ready for insertion.
 * Caller filters by scope when only project-scoped rules should be included.
 */
export function buildArchRuleChunk(rule: Rule): KnowledgeChunk {
  const firstSentence = rule.summary.split(/\.\s+/)[0].replace(/\.$/, '').trim()
  const title =
    firstSentence.length > 100
      ? `F${rule.number}: ${firstSentence.slice(0, 97)}...`
      : `F${rule.number}: ${firstSentence}`

  const humanName = rule.name.replace(/-/g, ' ')

  return {
    entity: `cmdingest:lepios:arch-F${rule.number}-${rule.name}`,
    category: 'rule',
    domain: 'lepios',
    title,
    problem: `What does F${rule.number} (${humanName}) require? When does this arch rule apply in LepiOS?`,
    solution: rule.summary,
    context: `Source: lepios CLAUDE.md §3 Architecture Rules F${rule.number} (${rule.name}). Registry: lib/rules/registry.ts. Defined at: ${rule.defined_at}. Keywords: F${rule.number}, ${rule.name}, ${humanName}`,
    confidence: 0.9,
  }
}

/**
 * Converts an array of Rules into KnowledgeChunks.
 * Caller is responsible for filtering by scope (e.g., scope === 'project').
 */
export function buildArchRuleChunks(rules: readonly Rule[]): KnowledgeChunk[] {
  return rules.map(buildArchRuleChunk)
}
