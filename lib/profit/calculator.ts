// Decision gates — port from sourcing.py:DEFAULT_SETTINGS.
// TODO: move to user settings (these are tuning parameters, not constants)
export const MIN_PROFIT_CAD = 3.0
export const MIN_ROI_PCT = 50

export function calcProfit(buyBoxPrice: number, fbaFees: number, costPaid: number): number {
  return Math.round((buyBoxPrice - fbaFees - costPaid) * 100) / 100
}

export function calcRoi(profit: number, costPaid: number): number {
  if (costPaid === 0) return 0
  return Math.round((profit / costPaid) * 100 * 100) / 100
}

export function getDecision(profit: number, roi: number): 'buy' | 'skip' {
  return profit >= MIN_PROFIT_CAD && roi >= MIN_ROI_PCT ? 'buy' : 'skip'
}
