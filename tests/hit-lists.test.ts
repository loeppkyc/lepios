import { describe, it, expect } from 'vitest'
import { CreateListSchema, AddItemsSchema } from '@/lib/hit-lists/schemas'

describe('CreateListSchema', () => {
  it('accepts a valid name', () => {
    expect(CreateListSchema.safeParse({ name: 'April Pallet' }).success).toBe(true)
  })

  it('rejects empty string', () => {
    expect(CreateListSchema.safeParse({ name: '' }).success).toBe(false)
  })

  it('rejects whitespace-only name', () => {
    expect(CreateListSchema.safeParse({ name: '   ' }).success).toBe(false)
  })

  it('rejects name over 80 chars', () => {
    expect(CreateListSchema.safeParse({ name: 'a'.repeat(81) }).success).toBe(false)
  })

  it('accepts name exactly 80 chars', () => {
    expect(CreateListSchema.safeParse({ name: 'a'.repeat(80) }).success).toBe(true)
  })

  it('trims surrounding whitespace before validating', () => {
    expect(CreateListSchema.safeParse({ name: '  April Pallet  ' }).success).toBe(true)
  })

  it('rejects missing name field', () => {
    expect(CreateListSchema.safeParse({}).success).toBe(false)
  })
})

describe('AddItemsSchema', () => {
  it('accepts a valid ISBNs array', () => {
    expect(AddItemsSchema.safeParse({ isbns: ['9780062316097', '9780385490818'] }).success).toBe(
      true
    )
  })

  it('accepts empty array', () => {
    expect(AddItemsSchema.safeParse({ isbns: [] }).success).toBe(true)
  })

  it('accepts exactly 200 ISBNs', () => {
    expect(AddItemsSchema.safeParse({ isbns: Array(200).fill('9780062316097') }).success).toBe(true)
  })

  it('rejects 201 ISBNs', () => {
    expect(AddItemsSchema.safeParse({ isbns: Array(201).fill('9780062316097') }).success).toBe(
      false
    )
  })

  it('rejects missing isbns field', () => {
    expect(AddItemsSchema.safeParse({}).success).toBe(false)
  })

  it('rejects non-array isbns', () => {
    expect(AddItemsSchema.safeParse({ isbns: '9780062316097' }).success).toBe(false)
  })
})
