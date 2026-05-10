import { createServiceClient } from '@/lib/supabase/service'

/**
 * F18 digest line for OSS audit step 3.
 * Format while in-progress: "OSS audit: 47/233 audited · 186 remaining"
 * Format when complete:     "OSS audit: 233/233 · keep=70 absorb-patterns=120 complement-with=43 [done]"
 */
export async function buildOssAuditDigestLine(): Promise<string> {
  try {
    const db = createServiceClient()

    const { data, error } = await db
      .from('streamlit_modules')
      .select('oss_audit_status')

    if (error || !data) return 'OSS audit: stats unavailable'

    const total = data.length
    const unaudited = data.filter((r) => r.oss_audit_status === 'unaudited').length
    const audited = total - unaudited

    if (unaudited > 0) {
      return `OSS audit: ${audited}/${total} audited · ${unaudited} remaining`
    }

    const keep = data.filter((r) => r.oss_audit_status === 'keep').length
    const absorb = data.filter((r) => r.oss_audit_status === 'absorb-patterns').length
    const complement = data.filter((r) => r.oss_audit_status === 'complement-with').length

    return `OSS audit: ${total}/${total} · keep=${keep} absorb-patterns=${absorb} complement-with=${complement} [done]`
  } catch {
    return 'OSS audit: stats unavailable'
  }
}
