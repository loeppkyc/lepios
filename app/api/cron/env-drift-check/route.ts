import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import { upsertHeartbeat } from '@/lib/orchestrator/heartbeat'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Keys that exist in BOTH Vercel env and harness_config. If they drift, the
// autonomous cron path and the agent path will diverge silently. See
// docs/specs/env-drift-check.md.
const SHARED_KEYS = ['CRON_SECRET', 'TELEGRAM_CHAT_ID'] as const

interface KeyComparison {
  key: string
  match: boolean
  vercel_present: boolean
  harness_present: boolean
  vercel_len: number | null
  harness_len: number | null
  vercel_first4: string | null
  harness_first4: string | null
}

function mask4(value: string | null | undefined): string | null {
  if (!value) return null
  if (value.length <= 4) return '*'.repeat(value.length)
  return value.slice(0, 4)
}

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized
  void upsertHeartbeat().catch(() => {})

  const db = createServiceClient()
  const started = Date.now()

  const { data: rows, error } = await db.from('harness_config').select('key, value').in('key', [...SHARED_KEYS])
  if (error) {
    return NextResponse.json({ ok: false, error: `harness_config read: ${error.message}` }, { status: 500 })
  }

  const harnessByKey = new Map<string, string>(
    (rows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]),
  )

  const comparisons: KeyComparison[] = SHARED_KEYS.map((key) => {
    const vercelValue = process.env[key]
    const harnessValue = harnessByKey.get(key)
    const vercel_present = typeof vercelValue === 'string' && vercelValue.length > 0
    const harness_present = typeof harnessValue === 'string' && harnessValue.length > 0
    const match = vercel_present && harness_present && vercelValue === harnessValue
    return {
      key,
      match,
      vercel_present,
      harness_present,
      vercel_len: vercel_present ? vercelValue!.length : null,
      harness_len: harness_present ? harnessValue!.length : null,
      vercel_first4: vercel_present ? mask4(vercelValue) : null,
      harness_first4: harness_present ? mask4(harnessValue) : null,
    }
  })

  const mismatches = comparisons.filter((c) => !c.match)

  if (mismatches.length === 0) {
    await db.from('agent_events').insert({
      domain: 'harness',
      action: 'env.drift_check',
      actor: 'cron_env_drift_check',
      status: 'success',
      duration_ms: Date.now() - started,
      output_summary: `clean: ${comparisons.length} shared keys verified`,
      meta: { keys_checked: comparisons.map((c) => c.key), mismatches: 0 },
    })
    return NextResponse.json({ ok: true, mismatches: 0, keys_checked: comparisons.length })
  }

  await db.from('agent_events').insert({
    domain: 'harness',
    action: 'env.drift_check',
    actor: 'cron_env_drift_check',
    status: 'error',
    duration_ms: Date.now() - started,
    output_summary: `${mismatches.length} mismatch(es): ${mismatches.map((m) => m.key).join(', ')}`,
    meta: { mismatches },
  })

  const chatId = (await db.from('harness_config').select('value').eq('key', 'TELEGRAM_CHAT_ID').single()).data?.value as
    | string
    | undefined

  const lines = [
    `🚨 Env drift detected (${mismatches.length})`,
    ...mismatches.map((m) => {
      if (!m.vercel_present) return `  ${m.key}: missing in Vercel env`
      if (!m.harness_present) return `  ${m.key}: missing in harness_config`
      return `  ${m.key}: vercel(${m.vercel_first4}…/${m.vercel_len}) ≠ harness(${m.harness_first4}…/${m.harness_len})`
    }),
    `Source: /api/cron/env-drift-check`,
  ]

  await db.from('outbound_notifications').insert({
    channel: 'telegram',
    payload: { text: lines.join('\n') },
    correlation_id: `env-drift-${Date.now()}`,
    requires_response: false,
    ...(chatId ? { chat_id: chatId } : {}),
  })

  return NextResponse.json({ ok: false, mismatches: mismatches.length, comparisons })
}

export async function POST(request: Request) {
  return GET(request)
}
