#!/usr/bin/env node
/**
 * seed-food-catalog.mjs
 *
 * Seeds food_catalog from Colin's Grocery Inventory sheet via Open Food Facts.
 * Run once after migration 0227 is applied:
 *
 *   node scripts/seed-food-catalog.mjs
 *
 * Requires .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.local manually
const envPath = resolve(__dirname, '../.env.local')
let envVars = {}
try {
  const raw = readFileSync(envPath, 'utf-8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
    envVars[key] = val
  }
} catch {
  console.error('Could not read .env.local — ensure it exists at project root')
  process.exit(1)
}

const SUPABASE_URL = (
  envVars.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ''
).trim()
const SERVICE_ROLE_KEY = (
  envVars.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  ''
).trim()

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// Colin's household grocery items (sourced from Grocery Inventory sheet, Apr 2026)
const HOUSEHOLD_ITEMS = [
  { name: "Earth's Own Oat Milk - Cinnamon Biscuit", brand: "Earth's Own", category: 'Beverage' },
  {
    name: 'Silk Protein Almond & Cashew - Unsweetened Vanilla',
    brand: 'Silk',
    category: 'Beverage',
  },
  { name: 'Nespresso Pods', brand: 'Nespresso', category: 'Beverage' },
  { name: 'Premier Protein Shake - Vanilla 30g', brand: 'Premier Protein', category: 'Beverage' },
  { name: 'Greenhouse Organic Fiery Ginger Shots', brand: 'Greenhouse', category: 'Beverage' },
  { name: 'Lipton Tea Bags', brand: 'Lipton', category: 'Beverage' },
  { name: 'Oikos Greek Yogurt', brand: 'Oikos', category: 'Dairy' },
  { name: 'Dairyland Whipping Cream 33%', brand: 'Dairyland', category: 'Dairy' },
  { name: 'Dairyland 3.25% Milk', brand: 'Dairyland', category: 'Dairy' },
  { name: 'Eggs', brand: null, category: 'Dairy' },
  { name: 'Tre Stelle Bocconcini', brand: 'Tre Stelle', category: 'Dairy' },
  { name: 'Castello Havarti', brand: 'Castello', category: 'Dairy' },
  { name: 'Ritz Rounds', brand: 'Ritz', category: 'Snack' },
  { name: 'Kirkland Salted Cashews', brand: 'Kirkland', category: 'Snack' },
  { name: 'Oreo Cookies', brand: 'Oreo', category: 'Snack' },
  { name: 'Deglet Noor Pitted Dates', brand: null, category: 'Snack' },
  { name: 'Fruit Snacks', brand: null, category: 'Snack' },
  { name: 'Rice Cakes', brand: null, category: 'Snack' },
  { name: 'Cinnamon Crisps', brand: 'Hawa', category: 'Snack' },
  { name: 'Goldfish Crackers', brand: 'Pepperidge Farm', category: 'Snack' },
  { name: "Rao's Marinara Sauce", brand: "Rao's", category: 'Pantry' },
  { name: 'Alfredo Sauce', brand: null, category: 'Pantry' },
  { name: "Hellmann's Mayo", brand: "Hellmann's", category: 'Pantry' },
  { name: 'Pickles', brand: null, category: 'Pantry' },
  { name: 'Soy Sauce', brand: null, category: 'Pantry' },
  { name: 'Hot Sauce', brand: null, category: 'Pantry' },
  { name: 'No Name Ranch Dressing', brand: 'No Name', category: 'Pantry' },
  { name: "King's Marinade", brand: "King's", category: 'Pantry' },
  { name: 'Ketchup', brand: 'Heinz', category: 'Pantry' },
  { name: 'Mustard', brand: null, category: 'Pantry' },
  { name: "Campbell's Soup", brand: "Campbell's", category: 'Pantry' },
  { name: 'Heinz Beans', brand: 'Heinz', category: 'Pantry' },
  { name: 'Spaghetti Pasta', brand: null, category: 'Pantry' },
  { name: 'Barilla Fettuccine', brand: 'Barilla', category: 'Pantry' },
  { name: 'Honey Cheerios', brand: 'General Mills', category: 'Pantry' },
  { name: 'Kraft Peanut Butter', brand: 'Kraft', category: 'Pantry' },
  { name: 'Kraft Dinner (KD)', brand: 'Kraft', category: 'Pantry' },
  { name: 'Prana Granolove Granola', brand: 'Prana', category: 'Pantry' },
  { name: 'Wow Butter', brand: 'Wow Butter', category: 'Pantry' },
  { name: 'Ground Cinnamon', brand: null, category: 'Pantry' },
  { name: 'Pink Himalayan Salt', brand: null, category: 'Pantry' },
  { name: 'Beef Tortellini', brand: "Giorgio's", category: 'Frozen' },
  { name: 'Cheese & Spinach Tortellini', brand: null, category: 'Frozen' },
  { name: 'Frozen Waffles', brand: null, category: 'Frozen' },
  { name: 'Furlani Garlic Parm Texas Toast', brand: 'Furlani', category: 'Frozen' },
  { name: 'Frozen Chicken Breasts', brand: null, category: 'Frozen' },
  { name: 'Frozen Hamburger Buns', brand: null, category: 'Bakery' },
  { name: 'Don Miguel Frozen Burritos', brand: 'Don Miguel', category: 'Frozen' },
  { name: 'Frozen Fruit Mango Peach', brand: null, category: 'Frozen' },
  { name: 'Dempsters Protein Bread', brand: "Dempster's", category: 'Bakery' },
  { name: 'Tortilla Wraps', brand: null, category: 'Bakery' },
  { name: 'Baby Carrots', brand: null, category: 'Produce' },
  { name: 'Blackberries', brand: null, category: 'Produce' },
  { name: 'Green Grapes', brand: null, category: 'Produce' },
  { name: 'Raspberries', brand: null, category: 'Produce' },
  { name: 'Strawberries', brand: null, category: 'Produce' },
  { name: 'Cherry Tomatoes', brand: 'Mucci', category: 'Produce' },
  { name: 'Salad Mix Spring Greens', brand: null, category: 'Produce' },
  { name: 'Charcuterie Salami Mix', brand: null, category: 'Meat' },
]

const OFF_SEARCH_URL = 'https://world.openfoodfacts.org/cgi/search.pl'

function buildSearchQuery(item) {
  const parts = [item.name]
  if (item.brand) parts.push(item.brand)
  return parts.join(' ')
}

async function searchOpenFoodFacts(query) {
  const params = new URLSearchParams({
    search_terms: query,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '3',
    fields: 'product_name,brands,code,serving_size,nutriments,categories_tags',
  })

  try {
    const res = await fetch(`${OFF_SEARCH_URL}?${params}`, {
      headers: { 'User-Agent': 'LepiOS/1.0 (loeppkycolin@gmail.com)' },
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.products?.[0] ?? null
  } catch {
    return null
  }
}

function extractNutrition(product) {
  if (!product) return {}
  const n = product.nutriments ?? {}

  // prefer _serving values; fall back to _100g
  const get = (key) => {
    const serving = n[`${key}_serving`]
    if (serving != null && serving !== '') return parseFloat(serving)
    const per100 = n[`${key}_100g`]
    if (per100 != null && per100 !== '') return parseFloat(per100)
    return null
  }

  // serving_size parsing — OFF returns strings like "100 g" or "1 cup (240ml)"
  let servingSize = null
  let servingUnit = 'g'
  if (product.serving_size) {
    const match = product.serving_size.match(/([\d.]+)\s*([a-zA-Z]+)/)
    if (match) {
      servingSize = parseFloat(match[1])
      servingUnit = match[2].toLowerCase()
    }
  }

  return {
    serving_size: servingSize,
    serving_unit: servingUnit,
    calories: get('energy-kcal'),
    protein_g: get('proteins'),
    fat_g: get('fat'),
    saturated_fat_g: get('saturated-fat'),
    carbs_g: get('carbohydrates'),
    sugar_g: get('sugars'),
    fiber_g: get('fiber'),
    // OFF stores sodium in grams; convert to mg
    sodium_mg: get('sodium') != null ? Math.round(get('sodium') * 1000) : null,
    cholesterol_mg: get('cholesterol') != null ? Math.round(get('cholesterol') * 1000) : null,
  }
}

async function run() {
  console.log(`Seeding food_catalog with ${HOUSEHOLD_ITEMS.length} items...\n`)

  let inserted = 0
  let skipped = 0
  let noMatch = 0

  for (const item of HOUSEHOLD_ITEMS) {
    const query = buildSearchQuery(item)
    process.stdout.write(`  Searching: "${query}"... `)

    const product = await searchOpenFoodFacts(query)

    let nutrition = {}
    let offId = null
    let source = 'manual'

    if (product) {
      nutrition = extractNutrition(product)
      offId = product.code ?? null
      source = 'open_food_facts'
      process.stdout.write(`found (${product.product_name ?? 'unnamed'})\n`)
    } else {
      noMatch++
      process.stdout.write('no match — inserting with empty nutrition\n')
    }

    const row = {
      name: item.name,
      brand: item.brand ?? null,
      category: item.category,
      is_household_staple: true,
      source,
      off_id: offId,
      verified: false,
      ...nutrition,
    }

    const { error } = await supabase
      .from('food_catalog')
      .upsert(row, { onConflict: 'name,brand' })
      .select('id')
      .single()

    if (error) {
      // upsert on conflict requires unique constraint — fall back to insert-if-not-exists
      const { error: insertError } = await supabase.from('food_catalog').insert(row)

      if (insertError) {
        console.error(`  ERROR inserting "${item.name}": ${insertError.message}`)
        skipped++
        continue
      }
    }

    inserted++

    // Rate limit: OFF asks for ~1 req/sec
    await new Promise((r) => setTimeout(r, 1100))
  }

  console.log(`\nDone.`)
  console.log(`  Inserted/updated: ${inserted}`)
  console.log(`  No OFF match (empty nutrition): ${noMatch}`)
  console.log(`  Errors skipped: ${skipped}`)
  console.log(
    `\nNext step: verify data in Supabase dashboard, then mark verified=true for confirmed rows.`
  )
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
