/**
 * Tax projection sanity-check guard-rails.
 *
 * F18 benchmark anchors — Colin's last full year:
 *   - Total sales:        ~$800,000
 *   - GST net of ITCs:    ~$20,000  (2.50% of sales)
 *   - CPP + income tax:   ~$2,100   (0.2625% of sales)
 *
 * A warning fires when any ratio drifts >25% from its baseline,
 * or when a value is zero/null while others are populated.
 */

export const BASELINE_SALES = 800_000
export const BASELINE_GST_NET_OF_ITCS = 20_000
export const BASELINE_CPP_INCOME_TAX = 2_100

export const BASELINE_GST_RATIO = BASELINE_GST_NET_OF_ITCS / BASELINE_SALES // 0.025
export const BASELINE_CPP_TAX_RATIO = BASELINE_CPP_INCOME_TAX / BASELINE_SALES // 0.002625
export const DRIFT_THRESHOLD = 0.25 // 25%

export interface TaxProjectionInput {
  totalSales: number
  gstNetOfItcs: number
  cppIncomeTax: number
}

export interface TaxProjectionResult {
  warnings: string[]
  ratios: {
    gstRatio: number | null
    cppTaxRatio: number | null
  }
}

export function checkTaxProjection(input: TaxProjectionInput): TaxProjectionResult {
  const { totalSales, gstNetOfItcs, cppIncomeTax } = input
  const warnings: string[] = []

  // All-zero → no data state, nothing to check
  if (totalSales === 0 && gstNetOfItcs === 0 && cppIncomeTax === 0) {
    return { warnings: [], ratios: { gstRatio: null, cppTaxRatio: null } }
  }

  // Null/zero checks: warn when one value is missing while siblings are populated
  if (totalSales === 0 && (gstNetOfItcs > 0 || cppIncomeTax > 0)) {
    warnings.push('Sales are zero but tax values are populated — check data source')
  }

  if (totalSales > 0 && gstNetOfItcs === 0) {
    warnings.push('GST net of ITCs is zero but sales are populated — check GST data')
  }

  if (totalSales > 0 && cppIncomeTax === 0) {
    warnings.push('CPP/income tax is zero but sales are populated — check CPP data')
  }

  if (totalSales === 0) {
    // Cannot compute ratios without sales
    return { warnings, ratios: { gstRatio: null, cppTaxRatio: null } }
  }

  const gstRatio = gstNetOfItcs / totalSales
  const cppTaxRatio = cppIncomeTax / totalSales

  // Ratio drift checks (only when the value is non-zero — zero already warned above)
  if (gstNetOfItcs > 0) {
    const gstDrift = Math.abs(gstRatio - BASELINE_GST_RATIO) / BASELINE_GST_RATIO
    if (gstDrift > DRIFT_THRESHOLD) {
      const pct = (gstRatio * 100).toFixed(2)
      const dir = gstRatio > BASELINE_GST_RATIO ? 'above' : 'below'
      warnings.push(
        `GST ratio ${pct}% is ${dir} baseline ${(BASELINE_GST_RATIO * 100).toFixed(2)}% by ${(gstDrift * 100).toFixed(0)}%`
      )
    }
  }

  if (cppIncomeTax > 0) {
    const cppDrift = Math.abs(cppTaxRatio - BASELINE_CPP_TAX_RATIO) / BASELINE_CPP_TAX_RATIO
    if (cppDrift > DRIFT_THRESHOLD) {
      const pct = (cppTaxRatio * 100).toFixed(4)
      const dir = cppTaxRatio > BASELINE_CPP_TAX_RATIO ? 'above' : 'below'
      warnings.push(
        `CPP/income tax ratio ${pct}% is ${dir} baseline ${(BASELINE_CPP_TAX_RATIO * 100).toFixed(4)}% by ${(cppDrift * 100).toFixed(0)}%`
      )
    }
  }

  return {
    warnings,
    ratios: { gstRatio, cppTaxRatio },
  }
}
