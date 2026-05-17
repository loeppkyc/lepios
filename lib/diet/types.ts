// Shared types + constants for the Diet module.
// Mirrors streamlit_app/pages/83_Grocery_Tracker.py constants.

export const RECEIPT_CATEGORIES = [
  'Produce',
  'Dairy',
  'Meat',
  'Bakery',
  'Frozen',
  'Pantry',
  'Beverage',
  'Snack',
  'Discount',
  'Other',
] as const
export type ReceiptCategory = (typeof RECEIPT_CATEGORIES)[number]

export const INVENTORY_CATEGORIES = [
  'Produce',
  'Dairy',
  'Meat',
  'Bakery',
  'Frozen',
  'Pantry',
  'Beverage',
  'Snack',
  'Other',
] as const
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number]

export const INVENTORY_STATUSES = ['On hand', 'Low', 'Out', 'Expired'] as const
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number]

export const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'] as const
export type Meal = (typeof MEALS)[number]

// Streamlit reference: line 657 — categories list used in Receipts tab.
// Streamlit reference: line 105-106 — DEFAULT_WEIGHT_LBS=197, DEFAULT_TDEE=2800.
export const DEFAULT_WEIGHT_LBS = 197

export type BiomarkerStatus = 'low' | 'normal' | 'high' | 'unknown'

export const FOOD_SOURCES = ['open_food_facts', 'manual', 'usda'] as const
export type FoodSource = (typeof FOOD_SOURCES)[number]

export const GROCERY_STORES = [
  'superstore',
  'save-on',
  'walmart',
  'costco',
  'safeway',
  'no-frills',
  'sobeys',
  'other',
] as const
export type GroceryStore = (typeof GROCERY_STORES)[number]

export const GROCERY_STORE_LABELS: Record<GroceryStore, string> = {
  superstore: 'Real Canadian Superstore',
  'save-on': 'Save-On-Foods',
  walmart: 'Walmart',
  costco: 'Costco',
  safeway: 'Safeway',
  'no-frills': 'No Frills',
  sobeys: 'Sobeys',
  other: 'Other',
}

export interface InventoryRow {
  id: string
  item: string
  category: string
  qty: number
  unit: string
  purchased_on: string
  expires_on: string | null
  status: string
  notes: string
  created_at: string
  updated_at: string
}

export interface ReceiptRow {
  id: string
  purchased_on: string
  store: string
  item: string
  price: number
  category: string
  qty: number
  unit: string
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  notes: string
  created_at: string
  updated_at: string
}

export interface MealRow {
  id: string
  meal_date: string
  meal: string
  description: string
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  notes: string
  created_at: string
  updated_at: string
}

export interface WeightRow {
  id: string
  weighed_on: string
  weight_lbs: number
  notes: string
  created_at: string
  updated_at: string
}

export interface BiomarkerRow {
  id: string
  recorded_on: string
  marker: string
  value: number
  unit: string
  ref_low: number | null
  ref_high: number | null
  status: BiomarkerStatus
  notes: string
  created_at: string
  updated_at: string
}

export interface FoodCatalogRow {
  id: string
  name: string
  brand: string | null
  barcode: string | null
  category: string
  serving_size: number | null
  serving_unit: string
  calories: number | null
  protein_g: number | null
  fat_g: number | null
  saturated_fat_g: number | null
  carbs_g: number | null
  sugar_g: number | null
  fiber_g: number | null
  sodium_mg: number | null
  cholesterol_mg: number | null
  is_household_staple: boolean
  source: FoodSource
  off_id: string | null
  verified: boolean
  notes: string
  created_at: string
  updated_at: string
}

export interface GroceryProductRow {
  id: string
  food_catalog_id: string | null
  name: string
  store: GroceryStore
  store_sku: string | null
  store_url: string | null
  unit_size: string | null
  regular_price: number | null
  sale_price: number | null
  price_per_100g: number | null
  last_scraped_at: string | null
  in_flyer: boolean
  is_active: boolean
  created_at: string
  updated_at: string
  food_catalog?: FoodCatalogRow | null
}
