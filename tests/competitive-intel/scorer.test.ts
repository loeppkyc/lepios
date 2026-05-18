import { describe, it, expect } from 'vitest'
import { scoreItem } from '@/lib/competitive-intel/scorer'

describe('scoreItem', () => {
  it('returns 0.0 for a paper with no keyword matches', () => {
    const title = 'Advances in Image Segmentation with Convolutional Networks'
    const abstract =
      'We present a novel approach to semantic segmentation using standard convolutional ' +
      'neural networks. Results show improved IoU on standard benchmarks.'
    expect(scoreItem(title, abstract)).toBe(0.0)
  })

  it('returns 0.30 for two primary keyword hits (multi-agent debate + debate framework)', () => {
    const title = 'Improving LLM Answers via Multi-Agent Debate'
    const abstract =
      'We propose a debate framework where multiple agents iteratively argue and ' +
      'refine their positions to reach consensus. Experiments on QA benchmarks validate the approach.'
    // "multi-agent debate" (primary, 0.15) + "debate framework" (primary, 0.15) = 0.30
    expect(scoreItem(title, abstract)).toBe(0.3)
  })

  it('returns 0.70 for four primary + two secondary keyword hits', () => {
    // 4 primary × 0.15 = 0.60; 2 secondary × 0.05 = 0.10; total = 0.70
    const title =
      'Adversarial Agent Coordination for Multi-Agent Reasoning via Agent Coordination'
    const abstract =
      'We introduce a multi-agent debate approach that employs a coordinator role and ' +
      'chain-of-thought reasoning across agents.'
    // Primary hits in combined text (case-insensitive):
    //   "adversarial agent" (title), "agent coordination" (title + abstract dedup — counted once per keyword),
    //   "multi-agent reasoning" (title), "multi-agent debate" (abstract) = 4
    // Secondary hits: "coordinator" (abstract), "chain-of-thought" (abstract) = 2
    // Score = 4 × 0.15 + 2 × 0.05 = 0.60 + 0.10 = 0.70
    expect(scoreItem(title, abstract)).toBeCloseTo(0.7, 10)
  })

  it('caps at 1.0 even if all keywords match', () => {
    const title =
      'Multi-Agent Debate via Debate Synthesis, Agent Coordination, Debate Framework, ' +
      'Adversarial Agent, and Multi-Agent Reasoning'
    const abstract =
      'LLM orchestration with chain-of-thought self-reflection task decomposition ' +
      'tool-augmented constitutional AI autonomous agent coordinator argumentation'
    const score = scoreItem(title, abstract)
    expect(score).toBeLessThanOrEqual(1.0)
  })

  it('is case-insensitive', () => {
    const title = 'MULTI-AGENT DEBATE FOR REASONING'
    const abstract = 'Debate Framework applied to LLM Orchestration'
    // multi-agent debate (primary 0.15) + debate framework (primary 0.15) + LLM orchestration (secondary 0.05) = 0.35
    expect(scoreItem(title, abstract)).toBeCloseTo(0.35, 10)
  })
})
