/**
 * Tests for the resource budget pre-commit gate.
 *
 * Mirrors the structure of cron-count.test.ts. Pure-function tests of
 * the evaluators + the block decision — no filesystem or git access.
 */

import { describe, it, expect } from 'vitest'
// @ts-expect-error — pure JS module without types
import {
  BUDGETS,
  countVercelCrons,
  countPackageDeps,
  evaluateBudgets,
  shouldBlock,
} from '../../scripts/check-budgets.mjs'

describe('BUDGETS registry shape', () => {
  it('every entry has key, max, file, evaluator, note', () => {
    expect(BUDGETS.length).toBeGreaterThan(0)
    for (const b of BUDGETS) {
      expect(typeof b.key).toBe('string')
      expect(typeof b.max).toBe('number')
      expect(b.max).toBeGreaterThan(0)
      expect(typeof b.file).toBe('string')
      expect(typeof b.evaluator).toBe('string')
      expect(typeof b.note).toBe('string')
    }
  })

  it('keys are unique', () => {
    const keys = BUDGETS.map((b: { key: string }) => b.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('includes vercel.crons + package.deps_total (v1 file-resident set)', () => {
    const keys = BUDGETS.map((b: { key: string }) => b.key)
    expect(keys).toContain('vercel.crons')
    expect(keys).toContain('package.deps_total')
  })
})

describe('countVercelCrons', () => {
  it('returns 0 when crons array missing', () => {
    expect(countVercelCrons({})).toBe(0)
  })

  it('returns 0 for null / non-object input', () => {
    expect(countVercelCrons(null)).toBe(0)
    expect(countVercelCrons(undefined)).toBe(0)
  })

  it('counts entries in the crons array', () => {
    expect(countVercelCrons({ crons: [{ path: '/a', schedule: '0 0 * * *' }] })).toBe(1)
    expect(countVercelCrons({ crons: Array(18).fill({ path: '/x', schedule: '0 1 * * *' }) })).toBe(
      18
    )
  })

  it('returns 0 when crons is not an array', () => {
    expect(countVercelCrons({ crons: 'not-an-array' })).toBe(0)
  })
})

describe('countPackageDeps', () => {
  it('returns 0 when no dependencies / devDependencies', () => {
    expect(countPackageDeps({})).toBe(0)
  })

  it('counts dependencies + devDependencies', () => {
    expect(
      countPackageDeps({
        dependencies: { a: '1', b: '1', c: '1' },
        devDependencies: { d: '1', e: '1' },
      })
    ).toBe(5)
  })

  it('handles missing devDependencies', () => {
    expect(countPackageDeps({ dependencies: { a: '1', b: '1' } })).toBe(2)
  })

  it('handles missing dependencies', () => {
    expect(countPackageDeps({ devDependencies: { a: '1' } })).toBe(1)
  })
})

describe('evaluateBudgets', () => {
  const fakeBudgets = [
    { key: 'a.test', max: 10, file: 'a.json', evaluator: 'countVercelCrons', note: '' },
  ]

  it('marks ok when current is well under max', () => {
    const loadJson = (path: string) =>
      path === 'a.json' ? { crons: [{ path: '/x', schedule: '0 0 * * *' }] } : null
    const [r] = evaluateBudgets(fakeBudgets, loadJson)
    expect(r.current).toBe(1)
    expect(r.status).toBe('ok')
  })

  it('marks warning at 85% of max (rounded)', () => {
    // 9/10 = 90% → warning
    const loadJson = () => ({ crons: Array(9).fill({ path: '/x', schedule: '0 0 * * *' }) })
    const [r] = evaluateBudgets(fakeBudgets, loadJson)
    expect(r.current).toBe(9)
    expect(r.status).toBe('warning')
  })

  it('marks at_limit when current equals max', () => {
    const loadJson = () => ({ crons: Array(10).fill({ path: '/x', schedule: '0 0 * * *' }) })
    const [r] = evaluateBudgets(fakeBudgets, loadJson)
    expect(r.current).toBe(10)
    expect(r.status).toBe('at_limit')
  })

  it('marks at_limit when current exceeds max', () => {
    const loadJson = () => ({ crons: Array(15).fill({ path: '/x', schedule: '0 0 * * *' }) })
    const [r] = evaluateBudgets(fakeBudgets, loadJson)
    expect(r.current).toBe(15)
    expect(r.status).toBe('at_limit')
  })

  it('marks unreadable when evaluator name is unknown', () => {
    const broken = [{ key: 'broken', max: 5, file: 'x.json', evaluator: 'doesNotExist', note: '' }]
    const [r] = evaluateBudgets(broken, () => ({}))
    expect(r.status).toBe('unreadable')
  })

  it('treats missing file as 0 / ok (nothing to count)', () => {
    const [r] = evaluateBudgets(fakeBudgets, () => null)
    expect(r.current).toBe(0)
    expect(r.status).toBe('ok')
  })
})

describe('shouldBlock', () => {
  it('only blocks when an at_limit result is for a staged file', () => {
    const results = [{ key: 'a', file: 'a.json', status: 'at_limit', current: 20, max: 10 }]
    expect(shouldBlock(results, ['unrelated.ts']).blockers).toEqual([])
    expect(shouldBlock(results, ['a.json']).blockers).toHaveLength(1)
  })

  it('surfaces warnings only for staged files', () => {
    const results = [
      { key: 'a', file: 'a.json', status: 'warning', current: 9, max: 10 },
      { key: 'b', file: 'b.json', status: 'warning', current: 9, max: 10 },
    ]
    const { warnings, blockers } = shouldBlock(results, ['a.json'])
    expect(blockers).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0].key).toBe('a')
  })

  it('returns no blockers when nothing is at_limit', () => {
    const results = [
      { key: 'a', file: 'a.json', status: 'ok', current: 1, max: 10 },
      { key: 'b', file: 'b.json', status: 'warning', current: 9, max: 10 },
    ]
    const { blockers } = shouldBlock(results, ['a.json', 'b.json'])
    expect(blockers).toEqual([])
  })
})

describe('integration — real-shaped inputs', () => {
  it('a 19-cron vercel.json against the real BUDGETS list trips at_limit', () => {
    const loadJson = (path: string) =>
      path === 'vercel.json'
        ? { crons: Array(19).fill({ path: '/x', schedule: '0 0 * * *' }) }
        : path === 'package.json'
          ? { dependencies: {}, devDependencies: {} }
          : null
    const results = evaluateBudgets(BUDGETS, loadJson)
    const cron = results.find((r: { key: string }) => r.key === 'vercel.crons')
    expect(cron?.status).toBe('at_limit')
    expect(cron?.current).toBe(19)
  })

  it('a small package.json against BUDGETS reports ok for deps', () => {
    const loadJson = (path: string) =>
      path === 'package.json'
        ? { dependencies: { a: '1' }, devDependencies: { b: '1' } }
        : path === 'vercel.json'
          ? { crons: [] }
          : null
    const results = evaluateBudgets(BUDGETS, loadJson)
    const deps = results.find((r: { key: string }) => r.key === 'package.deps_total')
    expect(deps?.status).toBe('ok')
    expect(deps?.current).toBe(2)
  })
})
