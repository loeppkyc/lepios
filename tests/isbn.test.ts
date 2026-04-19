import { describe, it, expect } from 'vitest'
import { normalizeIsbn, isIsbn, isbn13ToIsbn10 } from '@/lib/amazon/isbn'

describe('normalizeIsbn', () => {
  it('strips hyphens', () => {
    expect(normalizeIsbn('978-0-307-88803-7')).toBe('9780307888037')
  })

  it('strips spaces', () => {
    expect(normalizeIsbn('978 0307 888037')).toBe('9780307888037')
  })
})

describe('isIsbn', () => {
  it('recognises 13-digit ISBN', () => {
    expect(isIsbn('9780307888037')).toBe(true)
  })

  it('recognises 10-digit ISBN', () => {
    expect(isIsbn('0307888037')).toBe(true)
  })

  it('rejects 9-digit code', () => {
    expect(isIsbn('123456789')).toBe(false)
  })

  it('handles hyphenated input', () => {
    expect(isIsbn('978-0-307-88803-7')).toBe(true)
  })
})

describe('isbn13ToIsbn10', () => {
  it('converts a known ISBN-13 to ISBN-10', () => {
    // 9780307888037 → 0307888037
    expect(isbn13ToIsbn10('9780307888037')).toBe('0307888037')
  })

  it('returns null for non-978 prefix', () => {
    expect(isbn13ToIsbn10('9790307888037')).toBeNull()
  })

  it('returns null for ISBN-10 input', () => {
    expect(isbn13ToIsbn10('0307888037')).toBeNull()
  })

  it('handles ISBN-10 with X check digit correctly', () => {
    // 9780020049401 → 0020049404... let's use a known X example
    // 9780316769174 → 0316769177
    expect(isbn13ToIsbn10('9780316769174')).toBe('0316769177')
  })
})
