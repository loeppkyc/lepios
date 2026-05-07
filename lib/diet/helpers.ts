// Pure shaping helpers for the Diet page — exported for unit-test coverage.

import type {
  BiomarkerRow,
  BiomarkerStatus,
  InventoryRow,
  MealRow,
  ReceiptRow,
  WeightRow,
} from './types'

// ── Receipts summary ────────────────────────────────────────────────────────

export interface ReceiptsSummary {
  totalSpent: number // Sum of positive prices.
  totalSaved: number // |sum of negative prices| (Discount rows).
  netCost: number // totalSpent - totalSaved.
  itemCount: number // Rows with category != 'Discount'.
  storeCount: number // distinct stores.
  avgPerItem: number // totalSpent / max(itemCount, 1).
  byCategory: Record<string, number> // positive-price spend per category.
}

export function summarizeReceipts(rows: ReceiptRow[]): ReceiptsSummary {
  let totalSpent = 0
  let totalSaved = 0
  const stores = new Set<string>()
  const byCategory: Record<string, number> = {}
  let itemCount = 0

  for (const r of rows) {
    if (r.store) stores.add(r.store)
    if (r.price > 0) {
      totalSpent += r.price
      const cat = r.category || 'Other'
      byCategory[cat] = (byCategory[cat] ?? 0) + r.price
    }
    if (r.price < 0) totalSaved += Math.abs(r.price)
    if (r.category !== 'Discount') itemCount += 1
  }

  return {
    totalSpent: round2(totalSpent),
    totalSaved: round2(totalSaved),
    netCost: round2(totalSpent - totalSaved),
    itemCount,
    storeCount: stores.size,
    avgPerItem: round2(totalSpent / Math.max(itemCount, 1)),
    byCategory: roundMap(byCategory),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function roundMap(m: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(m)) out[k] = round2(v)
  return out
}

// ── Daily nutrition ─────────────────────────────────────────────────────────

export interface DailyNutrition {
  date: string
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  count: number
}

export function dailyNutrition(meals: MealRow[]): DailyNutrition[] {
  const byDate = new Map<string, DailyNutrition>()
  for (const m of meals) {
    const day = m.meal_date
    const existing = byDate.get(day) ?? {
      date: day,
      calories: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      count: 0,
    }
    existing.calories += m.calories ?? 0
    existing.protein_g += m.protein_g ?? 0
    existing.carbs_g += m.carbs_g ?? 0
    existing.fat_g += m.fat_g ?? 0
    existing.count += 1
    byDate.set(day, existing)
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
}

export function todaysTotals(meals: MealRow[], today: string): DailyNutrition {
  const subset = meals.filter((m) => m.meal_date === today)
  const totals: DailyNutrition = {
    date: today,
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    count: subset.length,
  }
  for (const m of subset) {
    totals.calories += m.calories ?? 0
    totals.protein_g += m.protein_g ?? 0
    totals.carbs_g += m.carbs_g ?? 0
    totals.fat_g += m.fat_g ?? 0
  }
  return totals
}

// ── Weight ──────────────────────────────────────────────────────────────────

export function latestWeight(weights: WeightRow[]): WeightRow | null {
  if (weights.length === 0) return null
  // queries return DESC by weighed_on; defensive sort.
  return [...weights].sort((a, b) => b.weighed_on.localeCompare(a.weighed_on))[0]
}

export interface WeightSeriesPoint {
  date: string
  weight_lbs: number
}

export function weightSeries(weights: WeightRow[]): WeightSeriesPoint[] {
  return [...weights]
    .sort((a, b) => a.weighed_on.localeCompare(b.weighed_on))
    .map((w) => ({ date: w.weighed_on, weight_lbs: w.weight_lbs }))
}

// ── Inventory ───────────────────────────────────────────────────────────────

export function expiringSoon(
  inventory: InventoryRow[],
  today: string,
  withinDays = 7
): InventoryRow[] {
  const cutoff = new Date(`${today}T00:00:00Z`)
  const horizon = new Date(cutoff.getTime() + withinDays * 86_400_000).toISOString().slice(0, 10)
  return inventory
    .filter((r) => r.expires_on && r.expires_on >= today && r.expires_on <= horizon)
    .sort((a, b) => (a.expires_on ?? '').localeCompare(b.expires_on ?? ''))
}

export function alreadyExpired(inventory: InventoryRow[], today: string): InventoryRow[] {
  return inventory
    .filter((r) => r.expires_on && r.expires_on < today)
    .sort((a, b) => (b.expires_on ?? '').localeCompare(a.expires_on ?? ''))
}

// ── Biomarker status (pure mirror of DB trigger; useful client-side) ────────

export function deriveBiomarkerStatus(
  value: number,
  refLow: number | null,
  refHigh: number | null
): BiomarkerStatus {
  if (refLow == null && refHigh == null) return 'unknown'
  if (refLow != null && value < refLow) return 'low'
  if (refHigh != null && value > refHigh) return 'high'
  return 'normal'
}

export function latestBiomarkerByMarker(rows: BiomarkerRow[]): BiomarkerRow[] {
  const byMarker = new Map<string, BiomarkerRow>()
  for (const r of rows) {
    const existing = byMarker.get(r.marker)
    if (!existing || r.recorded_on > existing.recorded_on) {
      byMarker.set(r.marker, r)
    }
  }
  return Array.from(byMarker.values()).sort((a, b) => a.marker.localeCompare(b.marker))
}

// ── CSV (re-export the Health helper would couple modules; copy to keep them isolated) ──

export function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const headers = Array.from(
    rows.reduce<Set<string>>((acc, r) => {
      Object.keys(r).forEach((k) => acc.add(k))
      return acc
    }, new Set())
  )
  const escape = (v: unknown): string => {
    if (v == null) return ''
    let s = String(v)
    if (Array.isArray(v)) s = v.join('; ')
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      s = `"${s.replace(/"/g, '""')}"`
    }
    return s
  }
  const headerLine = headers.map(escape).join(',')
  const bodyLines = rows.map((r) => headers.map((h) => escape(r[h])).join(','))
  return [headerLine, ...bodyLines].join('\n')
}
