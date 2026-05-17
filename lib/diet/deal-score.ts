import { createServiceClient } from '@/lib/supabase/service'

export type DealLabel = 'NEW_LOW' | 'GREAT_DEAL' | 'GOOD_DEAL' | 'FAIR' | 'SKIP' | 'FIRST_SEEN'

export interface DealScore {
  label: DealLabel
  score: number // 0–100
  verdict: string // plain English: "Best price ever seen", "Top 15% deal", etc.
  history_count: number // how many price observations we have
  price_min: number | null
  price_avg: number | null
  resale_opportunity: boolean
  resale_margin_pct: number | null // (amazon_price - sale_price) / sale_price * 100
  buy_recommendation: 'BUY_NOW' | 'GOOD' | 'WAIT' | 'SKIP' | 'NEW'
}

const FIRST_SEEN_SCORE: DealScore = {
  label: 'FIRST_SEEN',
  score: 50,
  verdict: 'First time tracked — buying now adds a data point',
  history_count: 0,
  price_min: null,
  price_avg: null,
  resale_opportunity: false,
  resale_margin_pct: null,
  buy_recommendation: 'NEW',
}

async function fetchResaleMargin(
  supabase: ReturnType<typeof createServiceClient>,
  foodCatalogId: string,
  currentPrice: number
): Promise<{ resale_opportunity: boolean; resale_margin_pct: number | null }> {
  try {
    // Step 1: get the ASIN from food_catalog
    const { data: catalogRow } = await supabase
      .from('food_catalog')
      .select('amazon_asin')
      .eq('id', foodCatalogId)
      .maybeSingle()

    if (!catalogRow?.amazon_asin) return { resale_opportunity: false, resale_margin_pct: null }

    // Step 2: look up current Amazon price in keepa_price_alerts
    const { data: alertRow } = await supabase
      .from('keepa_price_alerts')
      .select('current_value')
      .eq('asin', catalogRow.amazon_asin)
      .not('current_value', 'is', null)
      .limit(1)
      .maybeSingle()

    if (!alertRow?.current_value) return { resale_opportunity: false, resale_margin_pct: null }

    const amazonPrice = Number(alertRow.current_value)
    const margin = (amazonPrice - currentPrice) / currentPrice
    const marginPct = Math.round(margin * 100 * 10) / 10

    return {
      resale_opportunity: margin >= 0.3,
      resale_margin_pct: marginPct,
    }
  } catch {
    return { resale_opportunity: false, resale_margin_pct: null }
  }
}

export async function computeDealScore(
  supabase: ReturnType<typeof createServiceClient>,
  groceryProductId: string,
  currentPrice: number,
  foodCatalogId?: string
): Promise<DealScore> {
  try {
    // Fetch last 52 weeks of price history
    const oneYearAgo = new Date()
    oneYearAgo.setDate(oneYearAgo.getDate() - 364)

    const { data: historyRows, error: histErr } = await supabase
      .from('grocery_price_history')
      .select('price, scraped_at')
      .eq('grocery_product_id', groceryProductId)
      .gte('scraped_at', oneYearAgo.toISOString())
      .order('scraped_at', { ascending: true })
      .limit(500)

    if (histErr) throw histErr

    const prices = (historyRows ?? []).map((r) => Number(r.price))

    // Kick off resale check in parallel while we compute scoring
    const resalePromise = foodCatalogId
      ? fetchResaleMargin(supabase, foodCatalogId, currentPrice)
      : Promise.resolve({ resale_opportunity: false, resale_margin_pct: null })

    if (prices.length === 0) {
      const resale = await resalePromise
      return { ...FIRST_SEEN_SCORE, ...resale }
    }

    // Compute stats
    const sorted = [...prices].sort((a, b) => a - b)
    const priceMin = sorted[0]
    const priceAvg = Math.round((prices.reduce((s, v) => s + v, 0) / prices.length) * 100) / 100

    // Percentile rank: what % of historical prices does currentPrice beat?
    // i.e. how many past prices were higher than currentPrice
    const countBeaten = sorted.filter((p) => p > currentPrice).length
    const percentile = Math.round((countBeaten / prices.length) * 100)

    let label: DealLabel
    let score: number
    let verdict: string
    let buy_recommendation: DealScore['buy_recommendation']

    if (currentPrice < priceMin) {
      label = 'NEW_LOW'
      score = 100
      verdict = 'Best price ever seen'
      buy_recommendation = 'BUY_NOW'
    } else if (percentile >= 85) {
      label = 'GREAT_DEAL'
      // scale 85–99 within the 85–99 score band
      score = Math.min(99, Math.round(85 + ((percentile - 85) / 15) * 14))
      verdict = `Top ${100 - percentile}% deal`
      buy_recommendation = 'BUY_NOW'
    } else if (percentile >= 65) {
      label = 'GOOD_DEAL'
      score = Math.round(65 + ((percentile - 65) / 20) * 19)
      verdict = `Better than ${percentile}% of historical prices`
      buy_recommendation = 'GOOD'
    } else if (percentile >= 40) {
      label = 'FAIR'
      score = Math.round(40 + ((percentile - 40) / 25) * 24)
      verdict = 'Average deal — been cheaper before'
      buy_recommendation = 'WAIT'
    } else {
      label = 'SKIP'
      score = Math.max(0, Math.round((percentile / 40) * 39))
      verdict = 'Seen significantly cheaper — wait if possible'
      buy_recommendation = 'SKIP'
    }

    const resale = await resalePromise

    return {
      label,
      score,
      verdict,
      history_count: prices.length,
      price_min: priceMin,
      price_avg: priceAvg,
      buy_recommendation,
      ...resale,
    }
  } catch {
    return FIRST_SEEN_SCORE
  }
}
