import { GST_RATE, ZERO_GST } from './constants'

export interface GstSplit {
  pretax: number
  gst: number
  isZeroGst: boolean
}

/**
 * Backward split: GST-inclusive total → { pretax, gst }.
 *
 * Uses cents-based integer arithmetic so that pretax_cents + gst_cents === total_cents
 * exactly, with no floating-point drift. This is the property that justifies
 * gst = total - pretax instead of pretax * GST_RATE.
 *
 * If category is in ZERO_GST: pretax = total, gst = 0, isZeroGst = true.
 * Negative totals (refunds) are supported — signs are preserved.
 *
 * Ported from utils/email_invoices.py:299-300 and utils/__init__.py GST_RATE.
 */
export function splitGst(total: number, category?: string): GstSplit {
  if (category !== undefined && ZERO_GST.has(category)) {
    return { pretax: total, gst: 0, isZeroGst: true }
  }
  const totalCents = Math.round(total * 100)
  const pretaxCents = Math.round(totalCents / (1 + GST_RATE))
  const gstCents = totalCents - pretaxCents
  return {
    pretax: pretaxCents / 100,
    gst: gstCents / 100,
    isZeroGst: false,
  }
}

/**
 * Forward split: GST-exclusive pretax → { pretax, gst, total }.
 * F19 (20% Better): not in Streamlit baseline. Prevents ad-hoc pretax * 0.05 math
 * at call sites where only the pre-tax amount is known (e.g. manual expense entry).
 *
 * Note: total = pretax + gst (rounded separately), so total may differ from
 * pretax * 1.05 by ±$0.01. This is expected and correct — it matches how CRA
 * invoices display the split (each line rounded independently).
 *
 * If category is in ZERO_GST: gst = 0, total = pretax, isZeroGst = true.
 */
export function splitGstForward(pretax: number, category?: string): GstSplit & { total: number } {
  if (category !== undefined && ZERO_GST.has(category)) {
    return { pretax, gst: 0, isZeroGst: true, total: pretax }
  }
  const gstCents = Math.round(pretax * 100 * GST_RATE)
  const gst = gstCents / 100
  const total = Math.round((pretax + gst) * 100) / 100
  return { pretax, gst, isZeroGst: false, total }
}
