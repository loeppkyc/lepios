export interface FlippFlyerItem {
  id: number
  flyer_id: number
  flyer_item_id: number
  merchant_id: number
  merchant_name: string
  name: string
  current_price: number | null
  original_price: number | null
  pre_price_text: string | null
  post_price_text: string | null
  sale_story: string | null
  valid_from: string
  valid_to: string
  score: number
  item_type: 'flyer'
  clean_image_url: string | null
}

const FLIPP_SEARCH_URL = 'https://backflipp.wishabi.com/flipp/items/search'
// Edmonton downtown postal code — returns all Edmonton-area store flyers
const EDMONTON_POSTAL = 'T5J 1A1'

export async function searchFlippItems(
  query: string,
  postalCode = EDMONTON_POSTAL
): Promise<FlippFlyerItem[]> {
  const params = new URLSearchParams({ q: query, postal_code: postalCode })
  try {
    const res = await fetch(`${FLIPP_SEARCH_URL}?${params}`, {
      headers: {
        'User-Agent': 'LepiOS/1.0 (loeppkycolin@gmail.com)',
        Accept: 'application/json',
      },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data.items ?? []) as FlippFlyerItem[]
  } catch {
    return []
  }
}

// Maps Flipp merchant_name values to our grocery_products store enum.
// Chains not in this map (Freson Bros, Wholesale Club, President's Choice, etc.)
// are skipped — they're not in Colin's primary Edmonton store list.
const MERCHANT_STORE_MAP: Record<string, string> = {
  'Real Canadian Superstore': 'superstore',
  'No Frills': 'no-frills',
  'Save-On-Foods': 'save-on',
  Walmart: 'walmart',
  Costco: 'costco',
  Safeway: 'safeway',
  Sobeys: 'sobeys',
}

export function mapMerchantToStore(merchantName: string): string | null {
  return MERCHANT_STORE_MAP[merchantName] ?? null
}
