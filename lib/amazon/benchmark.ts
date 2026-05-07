/**
 * F18 benchmark for the Amazon Reports module.
 *
 * Source: explicit Colin target — minimum gross revenue (CAD) the Amazon
 * channel should produce in a trailing 30-day window. Tune by editing this
 * constant directly. The pace calculation in `computeAmazonPace()` is what
 * the surfacing widget uses to color the 30d-vs-target indicator on the
 * amazon page.
 *
 * To recalibrate: pick the trailing-90-day average revenue from the
 * bookkeeper sign-off, set this to that monthly figure, and commit. Each
 * retrofit iteration should look at last quarter's actuals and either
 * confirm the target still represents Colin's floor expectation, or update
 * it.
 *
 * Companion benchmark to `lib/payouts/benchmark.ts` (BENCHMARK_MONTHLY_NET_CAD).
 * Gross revenue here is pre-fees, pre-refunds. Net payout (post-fees) is
 * tracked separately on the payouts page.
 */
export const BENCHMARK_30D_REVENUE_CAD = 30_000

export type AmazonPaceStatus = 'ahead' | 'on_pace' | 'behind'

export interface AmazonPaceResult {
  targetCad: number
  expectedCad: number
  pacePct: number // 100 = exactly on pace; 110 = 10% ahead; 80 = 20% behind
  status: AmazonPaceStatus
}

/**
 * Compare trailing-30d gross revenue against the benchmark target.
 *
 * The amazon page displays a fixed 30-day rolling window, so unlike the
 * payouts module (YTD, time-prorated) this is a single-window comparison.
 *
 * @param actualRevenue30d — last-30d gross revenue in CAD, from `kpiData.grossRevenue`
 * @param targetCad — defaults to BENCHMARK_30D_REVENUE_CAD; injectable for tests
 */
export function computeAmazonPace(
  actualRevenue30d: number,
  targetCad: number = BENCHMARK_30D_REVENUE_CAD
): AmazonPaceResult {
  const expectedCad = targetCad
  const pacePct = expectedCad === 0 ? 100 : Math.round((actualRevenue30d / expectedCad) * 100)

  let status: AmazonPaceStatus
  if (pacePct >= 110) status = 'ahead'
  else if (pacePct >= 90) status = 'on_pace'
  else status = 'behind'

  return { targetCad, expectedCad, pacePct, status }
}
