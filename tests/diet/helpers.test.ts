import { describe, it, expect } from 'vitest'
import {
  alreadyExpired,
  dailyNutrition,
  deriveBiomarkerStatus,
  expiringSoon,
  latestBiomarkerByMarker,
  latestWeight,
  rowsToCsv,
  summarizeReceipts,
  todaysTotals,
  weightSeries,
} from '@/lib/diet/helpers'
import type { BiomarkerRow, InventoryRow, MealRow, ReceiptRow, WeightRow } from '@/lib/diet/types'

function inventory(over: Partial<InventoryRow> = {}): InventoryRow {
  return {
    id: 'i1',
    item: 'Bananas',
    category: 'Produce',
    qty: 1,
    unit: 'count',
    purchased_on: '2026-04-07',
    expires_on: null,
    status: 'On hand',
    notes: '',
    created_at: '',
    updated_at: '',
    ...over,
  }
}

function receipt(over: Partial<ReceiptRow> = {}): ReceiptRow {
  return {
    id: 'r1',
    purchased_on: '2026-04-07',
    store: 'Costco #154',
    item: 'Bananas',
    price: 7.49,
    category: 'Produce',
    qty: 1,
    unit: 'bag',
    calories: null,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    notes: '',
    created_at: '',
    updated_at: '',
    ...over,
  }
}

function meal(over: Partial<MealRow> = {}): MealRow {
  return {
    id: 'm1',
    meal_date: '2026-05-07',
    meal: 'Breakfast',
    description: 'Oatmeal',
    calories: 350,
    protein_g: 12,
    carbs_g: 60,
    fat_g: 6,
    notes: '',
    created_at: '',
    updated_at: '',
    ...over,
  }
}

function weight(over: Partial<WeightRow> = {}): WeightRow {
  return {
    id: 'w1',
    weighed_on: '2026-05-07',
    weight_lbs: 197,
    notes: '',
    created_at: '',
    updated_at: '',
    ...over,
  }
}

function biomarker(over: Partial<BiomarkerRow> = {}): BiomarkerRow {
  return {
    id: 'b1',
    recorded_on: '2026-05-01',
    marker: 'Vitamin D',
    value: 35,
    unit: 'ng/mL',
    ref_low: 30,
    ref_high: 100,
    status: 'normal',
    notes: '',
    created_at: '',
    updated_at: '',
    ...over,
  }
}

describe('summarizeReceipts', () => {
  it('handles empty', () => {
    const s = summarizeReceipts([])
    expect(s.totalSpent).toBe(0)
    expect(s.totalSaved).toBe(0)
    expect(s.itemCount).toBe(0)
    expect(s.storeCount).toBe(0)
    expect(s.avgPerItem).toBe(0)
  })

  it('separates positive (spent) from negative (saved) prices', () => {
    const rows = [
      receipt({ id: 'a', price: 10, category: 'Pantry' }),
      receipt({ id: 'b', price: 5, category: 'Produce' }),
      receipt({ id: 'c', price: -2, category: 'Discount' }),
    ]
    const s = summarizeReceipts(rows)
    expect(s.totalSpent).toBe(15)
    expect(s.totalSaved).toBe(2)
    expect(s.netCost).toBe(13)
  })

  it('counts items excluding Discount category', () => {
    const rows = [
      receipt({ id: 'a', category: 'Pantry' }),
      receipt({ id: 'b', category: 'Pantry' }),
      receipt({ id: 'c', category: 'Discount', price: -3 }),
    ]
    expect(summarizeReceipts(rows).itemCount).toBe(2)
  })

  it('aggregates byCategory only positive prices', () => {
    const rows = [
      receipt({ id: 'a', price: 10, category: 'Pantry' }),
      receipt({ id: 'b', price: 5, category: 'Pantry' }),
      receipt({ id: 'c', price: 8, category: 'Produce' }),
      receipt({ id: 'd', price: -2, category: 'Discount' }),
    ]
    const s = summarizeReceipts(rows)
    expect(s.byCategory).toEqual({ Pantry: 15, Produce: 8 })
  })

  it('counts distinct stores', () => {
    const rows = [
      receipt({ id: 'a', store: 'Costco' }),
      receipt({ id: 'b', store: 'Costco' }),
      receipt({ id: 'c', store: 'Superstore' }),
    ]
    expect(summarizeReceipts(rows).storeCount).toBe(2)
  })
})

describe('dailyNutrition', () => {
  it('rolls up by date and sorts ascending', () => {
    const rows = [
      meal({ meal_date: '2026-05-07', calories: 300, protein_g: 10 }),
      meal({ meal_date: '2026-05-07', calories: 400, protein_g: 30 }),
      meal({ meal_date: '2026-05-06', calories: 250, protein_g: 5 }),
    ]
    const out = dailyNutrition(rows)
    expect(out.map((r) => r.date)).toEqual(['2026-05-06', '2026-05-07'])
    expect(out[1]).toMatchObject({ calories: 700, protein_g: 40, count: 2 })
  })

  it('treats null macros as 0', () => {
    const rows = [meal({ calories: null, protein_g: null, carbs_g: null, fat_g: null })]
    expect(dailyNutrition(rows)[0]).toMatchObject({
      calories: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
    })
  })
})

describe('todaysTotals', () => {
  it("only sums today's rows", () => {
    const rows = [
      meal({ meal_date: '2026-05-07', calories: 500 }),
      meal({ meal_date: '2026-05-06', calories: 400 }),
    ]
    expect(todaysTotals(rows, '2026-05-07').calories).toBe(500)
  })
})

describe('weight helpers', () => {
  it('latestWeight picks the most recent', () => {
    const rows = [
      weight({ weighed_on: '2026-05-01', weight_lbs: 200 }),
      weight({ weighed_on: '2026-05-07', weight_lbs: 198 }),
      weight({ weighed_on: '2026-05-05', weight_lbs: 199 }),
    ]
    expect(latestWeight(rows)?.weighed_on).toBe('2026-05-07')
  })

  it('weightSeries sorts ascending', () => {
    const rows = [
      weight({ weighed_on: '2026-05-07', weight_lbs: 198 }),
      weight({ weighed_on: '2026-05-01', weight_lbs: 200 }),
    ]
    const out = weightSeries(rows)
    expect(out.map((r) => r.date)).toEqual(['2026-05-01', '2026-05-07'])
  })
})

describe('inventory expiration helpers', () => {
  const today = '2026-05-07'

  it('expiringSoon filters within window', () => {
    const rows = [
      inventory({ id: 'a', expires_on: '2026-05-10' }),
      inventory({ id: 'b', expires_on: '2026-05-20' }),
      inventory({ id: 'c', expires_on: '2026-04-30' }), // already expired
      inventory({ id: 'd', expires_on: null }),
    ]
    const out = expiringSoon(rows, today, 7)
    expect(out.map((r) => r.id)).toEqual(['a'])
  })

  it('alreadyExpired returns past-cutoff items', () => {
    const rows = [
      inventory({ id: 'a', expires_on: '2026-04-30' }),
      inventory({ id: 'b', expires_on: '2026-05-20' }),
      inventory({ id: 'c', expires_on: null }),
    ]
    const out = alreadyExpired(rows, today)
    expect(out.map((r) => r.id)).toEqual(['a'])
  })
})

describe('deriveBiomarkerStatus', () => {
  it('returns unknown when no ref range', () => {
    expect(deriveBiomarkerStatus(50, null, null)).toBe('unknown')
  })

  it('returns low when below ref_low', () => {
    expect(deriveBiomarkerStatus(20, 30, 100)).toBe('low')
  })

  it('returns high when above ref_high', () => {
    expect(deriveBiomarkerStatus(150, 30, 100)).toBe('high')
  })

  it('returns normal when in range', () => {
    expect(deriveBiomarkerStatus(50, 30, 100)).toBe('normal')
    expect(deriveBiomarkerStatus(30, 30, 100)).toBe('normal') // boundary inclusive
    expect(deriveBiomarkerStatus(100, 30, 100)).toBe('normal') // boundary inclusive
  })

  it('handles only ref_low', () => {
    expect(deriveBiomarkerStatus(20, 30, null)).toBe('low')
    expect(deriveBiomarkerStatus(40, 30, null)).toBe('normal')
  })

  it('handles only ref_high', () => {
    expect(deriveBiomarkerStatus(150, null, 100)).toBe('high')
    expect(deriveBiomarkerStatus(50, null, 100)).toBe('normal')
  })
})

describe('latestBiomarkerByMarker', () => {
  it('keeps only the most recent row per marker', () => {
    const rows = [
      biomarker({ id: 'a', marker: 'Vitamin D', recorded_on: '2026-04-01', value: 25 }),
      biomarker({ id: 'b', marker: 'Vitamin D', recorded_on: '2026-05-01', value: 35 }),
      biomarker({ id: 'c', marker: 'HbA1c', recorded_on: '2026-05-01', value: 5.4 }),
    ]
    const out = latestBiomarkerByMarker(rows)
    expect(out).toHaveLength(2)
    const vitD = out.find((r) => r.marker === 'Vitamin D')
    expect(vitD?.value).toBe(35)
  })
})

describe('rowsToCsv', () => {
  it('returns empty string for empty', () => {
    expect(rowsToCsv([])).toBe('')
  })

  it('escapes commas and quotes', () => {
    expect(rowsToCsv([{ a: 'hello, "world"' }])).toBe('a\n"hello, ""world"""')
  })
})
