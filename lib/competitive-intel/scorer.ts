/**
 * lib/competitive-intel/scorer.ts
 *
 * Pure relevance scorer for AI research papers.
 * No async, no external deps — testable offline.
 *
 * Keywords tuned for LepiOS's core theme: multi-agent debate & reasoning.
 * TODO: tune with real data — thresholds set from domain intuition, not calibration data.
 */

// Primary keywords — highly specific to multi-agent debate / coordination (weight: 0.15 each)
const PRIMARY_KEYWORDS = [
  'multi-agent debate',
  'debate synthesis',
  'agent coordination',
  'debate framework',
  'adversarial agent',
  'multi-agent reasoning',
]

// Secondary keywords — broader LLM / agent domain (weight: 0.05 each)
const SECONDARY_KEYWORDS = [
  'LLM orchestration',
  'chain-of-thought',
  'self-reflection',
  'task decomposition',
  'tool-augmented',
  'constitutional AI',
  'autonomous agent',
  'coordinator',
  'argumentation',
]

/**
 * Score a paper by keyword relevance.
 *
 * @param title    Paper title (any case — lowercased internally)
 * @param abstract Abstract text (any case — lowercased internally)
 * @returns        Float in [0.0, 1.0]
 */
export function scoreItem(title: string, abstract: string): number {
  const text = (title + ' ' + abstract).toLowerCase()
  const primaryHits = PRIMARY_KEYWORDS.filter((k) => text.includes(k.toLowerCase())).length
  const secondaryHits = SECONDARY_KEYWORDS.filter((k) => text.includes(k.toLowerCase())).length
  return Math.min(primaryHits * 0.15 + secondaryHits * 0.05, 1.0)
}
