/** Rolling window size for ROI signal calculation — locked per sprint2-port-plan.md */
export const SIGNAL_WINDOW = 30

/** ROI thresholds (as decimals). Tune here, nowhere else. */
export const ROI_PROFITABLE_THRESHOLD = 0.03 // > +3%
export const ROI_LOSING_THRESHOLD = -0.03 // < -3%

export type EdgeSignal = 'PROFITABLE' | 'BREAK-EVEN' | 'LOSING'

/**
 * Compute the edge signal from the last N completed bets.
 * Uses rolling ROI window — not all-time, not win-rate vs implied.
 *
 * @param bets  Completed bets (win/loss/push), most-recent first
 * @param window  Rolling window size (default: SIGNAL_WINDOW = 30)
 */
export function rollingRoiSignal(
  bets: Array<{ pnl: number | null; stake: number | null }>,
  window = SIGNAL_WINDOW,
): EdgeSignal {
  const slice = bets.slice(0, window).filter((b) => b.stake != null && b.stake > 0)
  if (slice.length === 0) return 'BREAK-EVEN'

  const totalPnl = slice.reduce((s, b) => s + (b.pnl ?? 0), 0)
  const totalStake = slice.reduce((s, b) => s + (b.stake ?? 0), 0)
  const roi = totalStake > 0 ? totalPnl / totalStake : 0

  if (roi > ROI_PROFITABLE_THRESHOLD) return 'PROFITABLE'
  if (roi < ROI_LOSING_THRESHOLD) return 'LOSING'
  return 'BREAK-EVEN'
}
