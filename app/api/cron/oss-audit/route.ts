import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { auditModuleBatch } from '@/lib/oss-radar/audit'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(request: Request) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const batchStart = Date.now()

  let audited = 0
  let verdicts: Record<string, number> = {}
  let batchErrors = 0

  try {
    const result = await auditModuleBatch(40)
    audited = result.audited
    verdicts = result.verdicts
    batchErrors = result.errors
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    try {
      const db = createServiceClient()
      await db.from('agent_events').insert({
        domain: 'oss_radar',
        action: 'oss_audit_batch',
        actor: 'harness',
        status: 'error',
        output_summary: `oss_audit_batch failed: ${msg}`,
        duration_ms: Date.now() - batchStart,
        meta: { error: msg, scorer: 'rule_based_v1' },
        tags: ['oss_audit', 'cron'],
      })
    } catch {
      // non-fatal
    }

    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // Count remaining unaudited modules
  let remaining = 0
  try {
    const db = createServiceClient()
    const { count } = await db
      .from('streamlit_modules')
      .select('id', { count: 'exact', head: true })
      .eq('oss_audit_status', 'unaudited')
    remaining = count ?? 0
  } catch {
    // non-fatal — return without remaining count
  }

  const duration_ms = Date.now() - batchStart

  try {
    const db = createServiceClient()
    await db.from('agent_events').insert({
      domain: 'oss_radar',
      action: 'oss_audit_batch',
      actor: 'harness',
      status: batchErrors > 0 ? 'warning' : 'success',
      output_summary: `oss_audit_batch: ${audited} scored, ${remaining} remaining`,
      duration_ms,
      meta: {
        audited,
        verdicts,
        remaining,
        errors: batchErrors,
        tokens_used: 0,
        scorer: 'rule_based_v1',
      },
      tags: ['oss_audit', 'cron'],
    })
  } catch {
    // non-fatal
  }

  return NextResponse.json({ audited, verdicts, remaining, duration_ms })
}
