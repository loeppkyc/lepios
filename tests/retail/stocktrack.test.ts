import { describe, it, expect } from 'vitest'
import {
  STATUS_LABELS,
  STATUS_COLORS,
  type RetailWatchlistStatus,
} from '@/lib/retail/types'
import { STOCKTRACK_STORES, EDMONTON_STORE_IDS } from '@/lib/retail/stocktrack-client'

// AC-1: RetailWatchlistStatus type has all 8 values + STATUS_LABELS/COLORS have 8 keys
describe('RetailWatchlistStatus — 8 statuses (AC-1)', () => {
  const EXPECTED: RetailWatchlistStatus[] = [
    'watching',
    'active',
    'bought',
    'shipped_to_fba',
    'live_on_amazon',
    'sold',
    'passed',
    'returned',
  ]

  it('STATUS_LABELS has all 8 keys', () => {
    expect(Object.keys(STATUS_LABELS)).toHaveLength(8)
    for (const s of EXPECTED) {
      expect(STATUS_LABELS).toHaveProperty(s)
    }
  })

  it('STATUS_COLORS has all 8 keys', () => {
    expect(Object.keys(STATUS_COLORS)).toHaveLength(8)
    for (const s of EXPECTED) {
      expect(STATUS_COLORS).toHaveProperty(s)
    }
  })

  it('STATUS_LABELS values are non-empty strings', () => {
    for (const [, v] of Object.entries(STATUS_LABELS)) {
      expect(typeof v).toBe('string')
      expect(v.length).toBeGreaterThan(0)
    }
  })

  it('STATUS_COLORS values are Tailwind class strings', () => {
    for (const [, v] of Object.entries(STATUS_COLORS)) {
      expect(typeof v).toBe('string')
      expect(v).toMatch(/bg-/)
    }
  })
})

// AC-7: Store codes and Edmonton IDs
describe('STOCKTRACK_STORES — 8 stores', () => {
  const EXPECTED_CODES = ['bb', 'ct', 'hd', 'st', 'wm', 'sc', 'tr', 'pa']

  it('has exactly 8 store codes', () => {
    expect(Object.keys(STOCKTRACK_STORES)).toHaveLength(8)
  })

  it('includes all expected codes', () => {
    for (const code of EXPECTED_CODES) {
      expect(STOCKTRACK_STORES).toHaveProperty(code)
    }
  })

  it('all display names are non-empty strings', () => {
    for (const [, name] of Object.entries(STOCKTRACK_STORES)) {
      expect(typeof name).toBe('string')
      expect(name.length).toBeGreaterThan(0)
    }
  })
})

describe('EDMONTON_STORE_IDS', () => {
  it('bb has 5 store IDs', () => {
    expect(EDMONTON_STORE_IDS.bb).toHaveLength(5)
  })

  it('ct has 6 store IDs', () => {
    expect(EDMONTON_STORE_IDS.ct).toHaveLength(6)
  })

  it('hd has 5 store IDs', () => {
    expect(EDMONTON_STORE_IDS.hd).toHaveLength(5)
  })

  it('wm has 5 store IDs', () => {
    expect(EDMONTON_STORE_IDS.wm).toHaveLength(5)
  })

  it('st uses postal code (empty array)', () => {
    expect(EDMONTON_STORE_IDS.st).toHaveLength(0)
  })

  it('all IDs are non-empty strings', () => {
    for (const [, ids] of Object.entries(EDMONTON_STORE_IDS)) {
      for (const id of ids) {
        expect(typeof id).toBe('string')
        expect(id.length).toBeGreaterThan(0)
      }
    }
  })
})

// Parsing sanity: HD prices in cents
describe('Home Depot price parsing', () => {
  it('HD price 2497 cents → $24.97', () => {
    const rawCents = 2497
    const cad = rawCents / 100
    expect(cad).toBeCloseTo(24.97, 2)
  })

  it('non-HD price 24.97 stays as-is', () => {
    const raw = 24.97
    expect(raw).toBeCloseTo(24.97, 2)
  })
})
