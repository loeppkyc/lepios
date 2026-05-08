/**
 * Tests for lib/failures/signature.ts (pattern signature builder).
 *
 * Pure function tests — no DB. Covers: keyword extraction, file glob
 * derivation, error_class detection, canonicalization (deterministic output
 * regardless of input ordering).
 *
 * Spec: docs/leverage-targets.md#t-006--failures-log-revised-2026-05-08
 */

import { describe, it, expect } from 'vitest'
import { buildSignature, signaturesEqual } from '@/lib/failures/signature'

describe('buildSignature — type-only input', () => {
  it('returns minimal signature with just type', () => {
    const sig = buildSignature({ type: 'manual' })
    expect(sig).toEqual({ type: 'manual' })
  })
})

describe('buildSignature — file glob derivation', () => {
  it('single file → exact match in file_glob', () => {
    const sig = buildSignature({ type: 'test-fail', files: ['tests/foo.test.ts'] })
    expect(sig.file_glob).toBe('tests/foo.test.ts')
    expect(sig.touched_files).toEqual(['tests/foo.test.ts'])
  })

  it('two files in same dir → derives parent glob', () => {
    const sig = buildSignature({
      type: 'test-fail',
      files: ['tests/harness/foo.test.ts', 'tests/harness/bar.test.ts'],
    })
    expect(sig.file_glob).toBe('tests/harness/**')
  })

  it('files in different trees → derives shortest common prefix', () => {
    const sig = buildSignature({
      type: 'route-500',
      files: ['app/api/foo/route.ts', 'app/api/bar/route.ts'],
    })
    expect(sig.file_glob).toBe('app/api/**')
  })

  it('files share no common prefix → undefined glob, but touched_files preserved', () => {
    const sig = buildSignature({
      type: 'cross-system-drift',
      files: ['lib/foo.ts', 'tests/bar.test.ts'],
    })
    expect(sig.file_glob).toBeUndefined()
    expect(sig.touched_files).toEqual(['lib/foo.ts', 'tests/bar.test.ts'])
  })

  it('caps touched_files at 5', () => {
    const files = Array.from({ length: 12 }, (_, i) => `lib/f${i}.ts`)
    const sig = buildSignature({ type: 'test-fail', files })
    expect(sig.touched_files).toHaveLength(5)
  })

  it('sorts touched_files for canonical output', () => {
    const sigA = buildSignature({ type: 'test-fail', files: ['lib/b.ts', 'lib/a.ts'] })
    const sigB = buildSignature({ type: 'test-fail', files: ['lib/a.ts', 'lib/b.ts'] })
    expect(sigA.touched_files).toEqual(sigB.touched_files)
  })
})

describe('buildSignature — error_class detection', () => {
  it('detects JS error class names', () => {
    const sig = buildSignature({
      type: 'test-fail',
      error_message: 'TypeError: Cannot read property of undefined',
    })
    expect(sig.error_class).toBe('TypeError')
  })

  it('detects HTTP 5xx', () => {
    const sig = buildSignature({ type: 'route-500', http_status: 503 })
    expect(sig.error_class).toBe('http-5xx:503')
  })

  it('detects HTTP 4xx', () => {
    const sig = buildSignature({ type: 'route-500', http_status: 401 })
    expect(sig.error_class).toBe('http-4xx:401')
  })

  it('does not invent error_class when nothing matches', () => {
    const sig = buildSignature({ type: 'manual', error_message: 'something went wrong' })
    expect(sig.error_class).toBeUndefined()
  })
})

describe('buildSignature — keyword extraction', () => {
  it('extracts distinctive tokens from error messages', () => {
    const sig = buildSignature({
      type: 'route-500',
      error_message: 'Failed to load orders: SP-API GET /orders/v0/orders InternalFailure',
    })
    expect(sig.keywords).toBeDefined()
    expect(sig.keywords).toContain('internalfailure')
    expect(sig.keywords).toContain('orders')
  })

  it('drops stop words', () => {
    const sig = buildSignature({
      type: 'manual',
      error_message: 'the value is in the table and was not found',
    })
    expect(sig.keywords ?? []).not.toContain('the')
    expect(sig.keywords ?? []).not.toContain('was')
  })

  it('drops short tokens (<4 chars)', () => {
    const sig = buildSignature({
      type: 'manual',
      error_message: 'a b cd ef ghi jklm specialword',
    })
    expect(sig.keywords).toBeDefined()
    expect(sig.keywords?.every((t) => t.length >= 4)).toBe(true)
  })

  it('caps at 8 keywords', () => {
    const text = Array.from({ length: 30 }, (_, i) => `keyword${i}distinctive`).join(' ')
    const sig = buildSignature({ type: 'manual', error_message: text })
    expect(sig.keywords?.length).toBeLessThanOrEqual(8)
  })

  it('returns undefined keywords when no extractable tokens', () => {
    const sig = buildSignature({ type: 'manual', error_message: 'a b c' })
    expect(sig.keywords).toBeUndefined()
  })
})

describe('signaturesEqual — canonicalization', () => {
  it('two signatures with same fields in different orders are equal', () => {
    const a = buildSignature({
      type: 'test-fail',
      files: ['tests/a.ts', 'tests/b.ts'],
      error_message: 'AssertionError: foo bar baz',
    })
    const b = buildSignature({
      type: 'test-fail',
      files: ['tests/b.ts', 'tests/a.ts'],
      error_message: 'AssertionError: baz bar foo',
    })
    expect(signaturesEqual(a, b)).toBe(true)
  })

  it('different types → not equal', () => {
    const a = buildSignature({ type: 'test-fail' })
    const b = buildSignature({ type: 'manual' })
    expect(signaturesEqual(a, b)).toBe(false)
  })

  it('different keyword sets → not equal', () => {
    const a = buildSignature({ type: 'manual', error_message: 'distinctword foo bar' })
    const b = buildSignature({ type: 'manual', error_message: 'otherword foo bar' })
    expect(signaturesEqual(a, b)).toBe(false)
  })
})
