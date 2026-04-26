import { createServiceClient } from '@/lib/supabase/service'
import { checkTaxProjection } from '@/lib/tax/sanity-check'

export async function buildTaxSanityLine(): Promise<string> {
  try {
    const db = createServiceClient()

    const { data } = await db
      .from('tax_sanity_inputs')
      .select('total_sales, gst_net_of_itcs, cpp_income_tax')
      .order('recorded_at', { ascending: false })
      .limit(1)
      .single()

    if (!data) return 'Tax sanity: no snapshot yet'

    const result = checkTaxProjection({
      totalSales: data.total_sales,
      gstNetOfItcs: data.gst_net_of_itcs,
      cppIncomeTax: data.cpp_income_tax,
    })

    if (result.warnings.length === 0) {
      const gstPct =
        result.ratios.gstRatio != null
          ? `GST ${(result.ratios.gstRatio * 100).toFixed(2)}%`
          : 'GST n/a'
      const cppPct =
        result.ratios.cppTaxRatio != null
          ? `CPP+tax ${(result.ratios.cppTaxRatio * 100).toFixed(3)}%`
          : 'CPP+tax n/a'
      return `Tax sanity: clean ✅ | ${gstPct} | ${cppPct}`
    }

    const lines = [`Tax sanity: ${result.warnings.length} warning(s) ⚠️`]
    for (const w of result.warnings) {
      lines.push(`  • ${w}`)
    }
    return lines.join('\n')
  } catch {
    return 'Tax sanity: unavailable'
  }
}
