// Server-side queries for the Diet module.

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  BiomarkerRow,
  FoodCatalogRow,
  GroceryProductRow,
  InventoryRow,
  MealRow,
  ReceiptRow,
  WeightRow,
} from './types'

const INVENTORY_COLUMNS =
  'id, item, category, qty, unit, purchased_on, expires_on, status, notes, created_at, updated_at'
const RECEIPT_COLUMNS =
  'id, purchased_on, store, item, price, category, qty, unit, calories, protein_g, carbs_g, fat_g, notes, created_at, updated_at'
const MEAL_COLUMNS =
  'id, meal_date, meal, description, calories, protein_g, carbs_g, fat_g, notes, created_at, updated_at'
const WEIGHT_COLUMNS = 'id, weighed_on, weight_lbs, notes, created_at, updated_at'
const BIOMARKER_COLUMNS =
  'id, recorded_on, marker, value, unit, ref_low, ref_high, status, notes, created_at, updated_at'
const FOOD_CATALOG_COLUMNS =
  'id, name, brand, barcode, category, serving_size, serving_unit, calories, protein_g, fat_g, saturated_fat_g, carbs_g, sugar_g, fiber_g, sodium_mg, cholesterol_mg, is_household_staple, source, off_id, verified, notes, created_at, updated_at'
const GROCERY_PRODUCT_COLUMNS =
  'id, food_catalog_id, name, store, store_sku, store_url, unit_size, regular_price, sale_price, price_per_100g, last_scraped_at, in_flyer, is_active, created_at, updated_at'

export interface DietBundle {
  inventory: InventoryRow[]
  receipts: ReceiptRow[]
  meals: MealRow[]
  weights: WeightRow[]
  biomarkers: BiomarkerRow[]
  catalog: FoodCatalogRow[]
}

export async function fetchDietBundle(supabase: SupabaseClient): Promise<DietBundle> {
  const [inventory, receipts, meals, weights, biomarkers, catalog] = await Promise.all([
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
    supabase.from('food_catalog').select(FOOD_CATALOG_COLUMNS).order('name', { ascending: true }),
  ])

  return {
    inventory: ((inventory.data ?? []) as InventoryRow[]) ?? [],
    receipts: ((receipts.data ?? []) as ReceiptRow[]) ?? [],
    meals: ((meals.data ?? []) as MealRow[]) ?? [],
    weights: ((weights.data ?? []) as WeightRow[]) ?? [],
    biomarkers: ((biomarkers.data ?? []) as BiomarkerRow[]) ?? [],
    catalog: ((catalog.data ?? []) as FoodCatalogRow[]) ?? [],
  }
}

export async function fetchGroceryProducts(supabase: SupabaseClient): Promise<GroceryProductRow[]> {
  const { data } = await supabase
    .from('grocery_products')
    .select(`${GROCERY_PRODUCT_COLUMNS}, food_catalog(${FOOD_CATALOG_COLUMNS})`)
    .eq('is_active', true)
    .order('name', { ascending: true })
  return (data ?? []) as unknown as GroceryProductRow[]
}
