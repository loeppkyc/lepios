/**
 * F18 benchmark for the Amazon Payouts module.
 *
 * Source: explicit Colin target — minimum monthly net payout the business
 * should clear in CAD. Tune by editing this constant directly. The pace
 * calculation in `computePace()` is what the surfacing widget uses to color
 * the YTD-vs-target indicator on the payouts page.
 *
 * To recalibrate: pick the trailing-12-month average net payout from the
 * bookkeeper sign-off, set this to that value, and commit. Each retrofit
 * iteration should look at last quarter's actual numbers and either confirm
 * the target still represents Colin's floor expectation, or update it.
 */
export const BENCHMARK_MONTHLY_NET_CAD = 10_000

export type PaceStatus = 'ahead' | 'on_pace' | 'behind'

export interface PaceResult {
  monthlyTargetCad: number
  expectedYtdCad: number
  ytdPacePct: number // 100 = exactly on pace; 110 = 10% ahead; 80 = 20% behind
  status: PaceStatus
}

/**
 * Compare YTD net payout against a linearly-prorated annual target.
 *
 * @param ytdNetCad — actual YTD net payout in CAD
 * @param year — year being viewed
 * @param now — current Date (injectable for tests)
 * @param monthlyTargetCad — defaults to BENCHMARK_MONTHLY_NET_CAD
 */
export function computePace(
  ytdNetCad: number,
  year: number,
  now: Date = new Date(),
  monthlyTargetCad: number = BENCHMARK_MONTHLY_NET_CAD
): PaceResult {
  const currentYear = now.getUTCFullYear()
  // For past years: full 12 months are accountable. For current year: months
  // elapsed (1-12). For future years: 0 (no expectation yet).
  let monthsElapsed: number
  if (year < currentYear) monthsElapsed = 12
  else if (year > currentYear) monthsElapsed = 0
  else monthsElapsed = now.getUTCMonth() + 1

  const expectedYtdCad = monthlyTargetCad * monthsElapsed
  const ytdPacePct = expectedYtdCad === 0 ? 100 : Math.round((ytdNetCad / expectedYtdCad) * 100)

  let status: PaceStatus
  if (ytdPacePct >= 110) status = 'ahead'
  else if (ytdPacePct >= 90) status = 'on_pace'
  else status = 'behind'

  return { monthlyTargetCad, expectedYtdCad, ytdPacePct, status }
}
