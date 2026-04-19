import { spFetch } from './client'

const MARKETPLACE_CA = 'A2EUQ1WTGCTBG2'

type PricingResponse = {
  payload?: Array<{
    Product?: {
      CompetitivePricing?: {
        CompetitivePrices?: Array<{
          condition: string
          Price: { LandedPrice?: { Amount: number } }
        }>
      }
    }
  }>
}

// Port of amazon.py:get_used_buy_box
export async function getUsedBuyBox(asin: string): Promise<number | null> {
  try {
    const data = await spFetch<PricingResponse>('/products/pricing/v0/competitivePrice', {
      // ItemType must be explicit — SP-API returns 404 without it despite docs claiming it defaults to 'Asin'
      params: { Asins: asin, MarketplaceId: MARKETPLACE_CA, ItemType: 'Asin' },
    })
    for (const item of data.payload ?? []) {
      for (const cp of item.Product?.CompetitivePricing?.CompetitivePrices ?? []) {
        if (cp.condition.toLowerCase() === 'used') {
          const amount = cp.Price?.LandedPrice?.Amount
          if (amount) return Number(amount)
        }
      }
    }
  } catch {
    // fall through
  }
  return null
}
