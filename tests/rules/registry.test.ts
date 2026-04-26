/**
 * Tests for lib/rules/index.ts — F-L8 collision prevention.
 *
 * Asserts:
 *   - Every key matches /^F\d+$/ and equals its `id` field.
 *   - nextRuleId() returns max+1.
 *   - Every registry rule has a matching `**FN —` heading in CLAUDE.md §3.
 *   - Every `**FN —` heading in CLAUDE.md §3 has a registry entry.
 *   - The §3 registry note is present.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { ARCHITECTURE_RULES, nextRuleId } from '@/lib/rules'

const CLAUDE_MD_PATH = resolve(__dirname, '../../CLAUDE.md')

function extractSection3(): string {
  const md = readFileSync(CLAUDE_MD_PATH, 'utf-8')
  const start = md.indexOf('## 3 — Architecture Rules')
  const end = md.indexOf('## 4 ', start)
  if (start === -1 || end === -1) {
    throw new Error('CLAUDE.md §3 not found — registry drift test cannot run')
  }
  return md.slice(start, end)
}

describe('ARCHITECTURE_RULES registry shape', () => {
  it('every key matches /^F\\d+$/', () => {
    for (const key of Object.keys(ARCHITECTURE_RULES)) {
      expect(key).toMatch(/^F\d+$/)
    }
  })

  it('every entry has id === its key', () => {
    for (const [key, rule] of Object.entries(ARCHITECTURE_RULES)) {
      expect(rule.id).toBe(key)
    }
  })

  it('every entry has a non-empty slug, title, shipped, section', () => {
    for (const rule of Object.values(ARCHITECTURE_RULES)) {
      expect(rule.slug).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(rule.title.length).toBeGreaterThan(0)
      expect(rule.shipped).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(rule.section).toMatch(/^§\d+(\.\d+)?$/)
    }
  })

  it('every entry has a complete ingest block', () => {
    for (const rule of Object.values(ARCHITECTURE_RULES)) {
      expect(rule.ingest.title).toContain(rule.id)
      expect(rule.ingest.problem.length).toBeGreaterThan(0)
      expect(rule.ingest.solution.length).toBeGreaterThan(0)
      expect(rule.ingest.context).toContain(rule.id)
      expect(rule.ingest.confidence).toBeGreaterThan(0)
      expect(rule.ingest.confidence).toBeLessThanOrEqual(1)
    }
  })
})

describe('nextRuleId()', () => {
  it('returns F{max+1}', () => {
    const nums = Object.keys(ARCHITECTURE_RULES).map((k) => parseInt(k.slice(1), 10))
    const expected = `F${Math.max(...nums) + 1}`
    expect(nextRuleId()).toBe(expected)
  })
})

describe('CLAUDE.md §3 ↔ registry drift', () => {
  it('§3 contains the registry pointer note', () => {
    const section = extractSection3()
    expect(section).toContain('lib/rules/index.ts')
    expect(section).toContain('canonical')
  })

  it('every registry rule has a matching **FN — heading in §3', () => {
    const section = extractSection3()
    for (const rule of Object.values(ARCHITECTURE_RULES)) {
      const heading = `**${rule.id} —`
      expect(section, `expected "${heading}" heading in CLAUDE.md §3`).toContain(heading)
    }
  })

  it('every **FN — heading in §3 has a registry entry', () => {
    const section = extractSection3()
    const headingMatches = section.matchAll(/\*\*(F\d+) —/g)
    const headingIds = Array.from(headingMatches, (m) => m[1])
    expect(headingIds.length).toBeGreaterThan(0)
    const registryIds = new Set(Object.keys(ARCHITECTURE_RULES))
    for (const id of headingIds) {
      expect(registryIds, `CLAUDE.md §3 heading "${id}" missing from registry`).toContain(id)
    }
  })
})
