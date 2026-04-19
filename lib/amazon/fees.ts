import { spFetch } from './client'

const MARKETPLACE_CA = 'A2EUQ1WTGCTBG2'

type FeesResponse = {
  payload?: {
    FeesEstimateResult?: {
      FeesEstimate?: {
        TotalFeesEstimate?: { Amount: number }
      }
    }
  }
}

// Port of amazon.py:get_fba_fees + 21_PageProfit.py:958-960 secondary fallback.
// If SP-API returns exactly 40% (its own fallback), use 15% + $5.50 (more accurate for books).
// If SP-API call fails entirely, fall back to flat 40%.
export async function getFbaFees(asin: string, price: number): Promise<number> {
  try {
    const data = await spFetch<FeesResponse>(`/products/fees/v0/items/${asin}/feesEstimate`, {
      method: 'POST',
      body: {
        FeesEstimateRequest: {
          MarketplaceId: MARKETPLACE_CA,
          IsAmazonFulfilled: true,
          PriceToEstimateFees: {
            ListingPrice: { CurrencyCode: 'CAD', Amount: price },
            Shipping: { CurrencyCode: 'CAD', Amount: 0 },
          },
          Identifier: asin,
        },
      },
    })

    const amount = data.payload?.FeesEstimateResult?.FeesEstimate?.TotalFeesEstimate?.Amount
    if (amount != null) {
      const fees = Number(amount)
      const flat40 = Math.round(price * 0.4 * 100) / 100
      // If API returned its own 40% fallback, use the more accurate book estimate
      if (Math.abs(fees - flat40) < 0.01) {
        return Math.round((price * 0.15 + 5.5) * 100) / 100
      }
      return fees
    }
  } catch {
    // fall through
  }
  return Math.round(price * 0.4 * 100) / 100
}
