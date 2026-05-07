// Server-side queries for the Diet module.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BiomarkerRow, InventoryRow, MealRow, ReceiptRow, WeightRow } from './types'

const INVENTORY_COLUMNS =
  'id, item, category, qty, unit, purchased_on, expires_on, status, notes, created_at, updated_at'
const RECEIPT_COLUMNS =
  'id, purchased_on, store, item, price, category, qty, unit, calories, protein_g, carbs_g, fat_g, notes, created_at, updated_at'
const MEAL_COLUMNS =
  'id, meal_date, meal, description, calories, protein_g, carbs_g, fat_g, notes, created_at, updated_at'
const WEIGHT_COLUMNS = 'id, weighed_on, weight_lbs, notes, created_at, updated_at'
const BIOMARKER_COLUMNS =
  'id, recorded_on, marker, value, unit, ref_low, ref_high, status, notes, created_at, updated_at'

export interface DietBundle {
  inventory: InventoryRow[]
  receipts: ReceiptRow[]
  meals: MealRow[]
  weights: WeightRow[]
  biomarkers: BiomarkerRow[]
}

export async function fetchDietBundle(supabase: SupabaseClient): Promise<DietBundle> {
  const [inventory, receipts, meals, weights, biomarkers] = await Promise.all([
    supabase
      .from('grocery_inventory')
      .select(INVENTORY_COLUMNS)
      .order('purchased_on', { ascending: false }),
    supabase
      .from('grocery_receipts')
      .select(RECEIPT_COLUMNS)
      .order('purchased_on', { ascending: false }),
    supabase.from('meal_log').select(MEAL_COLUMNS).order('meal_date', { ascending: false }),
    supabase.from('weight_log').select(WEIGHT_COLUMNS).order('weighed_on', { ascending: false }),
    supabase
      .from('biomarkers')
      .select(BIOMARKER_COLUMNS)
      .order('recorded_on', { ascending: false }),
  ])

  return {
    inventory: ((inventory.data ?? []) as InventoryRow[]) ?? [],
    receipts: ((receipts.data ?? []) as ReceiptRow[]) ?? [],
    meals: ((meals.data ?? []) as MealRow[]) ?? [],
    weights: ((weights.data ?? []) as WeightRow[]) ?? [],
    biomarkers: ((biomarkers.data ?? []) as BiomarkerRow[]) ?? [],
  }
}
