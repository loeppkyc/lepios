// Assumes $5 shipping charged to buyer = $5 shipping cost to seller (breakeven on shipping).
// FVF applies to total incl. shipping per eBay managed payments.
const EBAY_FVF_RATE = 0.1325 // 13.25% final value fee for books, Canada managed payments
const EBAY_PER_ORDER_FEE = 0.3
const EBAY_SHIPPING_COST = 5.0 // seller pays $5 to ship
const EBAY_SHIPPING_CHARGED = 5.0 // buyer pays $5 shipping; FVF applies to this amount too

export interface EbayFeeBreakdown {
  finalValueFee: number
  perOrderFee: number
  totalFees: number
  shippingCost: number
}

export function estimateEbayFees(itemPrice: number): EbayFeeBreakdown {
  const finalValueFee = round((itemPrice + EBAY_SHIPPING_CHARGED) * EBAY_FVF_RATE)
  const perOrderFee = EBAY_PER_ORDER_FEE
  return {
    finalValueFee,
    perOrderFee,
    totalFees: round(finalValueFee + perOrderFee),
    shippingCost: EBAY_SHIPPING_COST,
  }
}

export function estimateEbayProfit(itemPrice: number, costPaid: number): number {
  const { totalFees, shippingCost } = estimateEbayFees(itemPrice)
  return round(itemPrice - totalFees - shippingCost - costPaid)
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
