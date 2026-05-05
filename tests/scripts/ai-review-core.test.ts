import { describe, it, expect } from 'vitest'
import {
  REVIEW_SYSTEM_PROMPT,
  chooseProvider,
  parseFindings,
} from '../../scripts/lib/ai-review-core.mjs'

describe('chooseProvider', () => {
  it('returns ollama when ollama is reachable, regardless of anthropic key', () => {
    expect(chooseProvider({ ollamaReachable: true, hasAnthropicKey: true })).toBe('ollama')
    expect(chooseProvider({ ollamaReachable: true, hasAnthropicKey: false })).toBe('ollama')
  })

  it('falls back to anthropic when ollama is unreachable but key is set', () => {
    expect(chooseProvider({ ollamaReachable: false, hasAnthropicKey: true })).toBe('anthropic')
  })

  it('soft-skips when neither ollama nor anthropic is available (Frontier OFF default)', () => {
    expect(chooseProvider({ ollamaReachable: false, hasAnthropicKey: false })).toBe('soft-skip')
  })
})

describe('parseFindings', () => {
  it('classifies BLOCK / WARN / PASS lines and sets hasBlock', () => {
    const result = parseFindings('BLOCK: hardcoded secret\nWARN: TODO marker\nPASS: tests updated')
    expect(result.findings).toEqual([
      { level: 'BLOCK', text: 'BLOCK: hardcoded secret' },
      { level: 'WARN', text: 'WARN: TODO marker' },
      { level: 'PASS', text: 'PASS: tests updated' },
    ])
    expect(result.hasBlock).toBe(true)
  })

  it('hasBlock is false when no BLOCK line is present', () => {
    const result = parseFindings('WARN: TODO marker\nPASS: tests updated')
    expect(result.hasBlock).toBe(false)
  })

  it('keeps unrecognized lines as OTHER (continuation lines, narration) without blocking', () => {
    const result = parseFindings('PASS: clean\nthis is a stray narration line')
    expect(result.findings.map((f) => f.level)).toEqual(['PASS', 'OTHER'])
    expect(result.hasBlock).toBe(false)
  })

  it('drops empty lines', () => {
    const result = parseFindings('PASS: clean\n\n\nWARN: minor')
    expect(result.findings).toHaveLength(2)
  })

  it('handles empty input → no findings, no block', () => {
    const result = parseFindings('')
    expect(result.findings).toEqual([])
    expect(result.hasBlock).toBe(false)
  })

  it('trims surrounding whitespace on lines', () => {
    const result = parseFindings('   BLOCK: leading whitespace\n  PASS: also trims  ')
    expect(result.findings).toEqual([
      { level: 'BLOCK', text: 'BLOCK: leading whitespace' },
      { level: 'PASS', text: 'PASS: also trims' },
    ])
    expect(result.hasBlock).toBe(true)
  })
})

describe('REVIEW_SYSTEM_PROMPT', () => {
  it('asks for the LEVEL: description format the parser expects', () => {
    expect(REVIEW_SYSTEM_PROMPT).toMatch(/LEVEL: description/)
    expect(REVIEW_SYSTEM_PROMPT).toMatch(/BLOCK/)
    expect(REVIEW_SYSTEM_PROMPT).toMatch(/WARN/)
    expect(REVIEW_SYSTEM_PROMPT).toMatch(/PASS/)
  })

  it('covers the 10-item checklist (anchor for future regressions)', () => {
    for (const id of [
      'SECRETS',
      'DEBUG',
      'TODOS',
      'INTENT',
      'TESTS',
      'TYPES',
      'SIZE',
      'SCHEMA',
      'CONTRACTS',
      'GROUNDING',
    ]) {
      expect(REVIEW_SYSTEM_PROMPT).toMatch(new RegExp(id))
    }
  })
})
