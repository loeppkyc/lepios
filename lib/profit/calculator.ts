// Decision gates — defaults used when no DB settings are available.
// Actual thresholds are stored in scanner_settings table and read at scan time.
// TODO: move person_handle='colin' to profiles FK when SPRINT5-GATE lands.
export const DEFAULT_MIN_PROFIT_CAD = 3.0
export const DEFAULT_MIN_ROI_PCT = 50
export const DEFAULT_MAX_BSR = 0 // 0 = no BSR gate

// Backward-compat aliases — existing imports continue to work.
export const MIN_PROFIT_CAD = DEFAULT_MIN_PROFIT_CAD
export const MIN_ROI_PCT = DEFAULT_MIN_ROI_PCT

export interface ScanSettings {
  min_profit_cad: number
  min_roi_pct: number
  max_bsr: number
}

export function calcProfit(buyBoxPrice: number, fbaFees: number, costPaid: number): number {
  return Math.round((buyBoxPrice - fbaFees - costPaid) * 100) / 100
}

export function calcRoi(profit: number, costPaid: number): number {
  if (costPaid === 0) return 0
  return Math.round((profit / costPaid) * 100 * 100) / 100
}

export function getDecision(
  profit: number,
  roi: number,
  bsr: number | null = null,
  settings?: ScanSettings
): 'buy' | 'skip' {
  const minProfit = settings?.min_profit_cad ?? DEFAULT_MIN_PROFIT_CAD
  const minRoi = settings?.min_roi_pct ?? DEFAULT_MIN_ROI_PCT
  const maxBsr = settings?.max_bsr ?? DEFAULT_MAX_BSR

  if (profit < minProfit) return 'skip'
  if (roi < minRoi) return 'skip'
  if (maxBsr > 0 && bsr !== null && bsr > maxBsr) return 'skip'
  return 'buy'
}
