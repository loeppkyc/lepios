import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'
import { createServiceClient } from '@/lib/supabase/service'

// POST /api/stocktrack/results/skip
// Body: { product_name, store_code, discount_pct? }
// Logs a deal_skip event to agent_events for F18 skip-rate tracking.
// The actual dismiss is client-side state; this is observability-only.
export async function POST(request: Request) {
  const gate = await requireUser()
  if (!gate.ok) return gate.response

  const body = await request.json().catch(() => ({}))
  const { product_name, store_code, discount_pct } = body as {
    product_name?: string
    store_code?: string
    discount_pct?: number | null
  }

  const db = createServiceClient()
  await db.from('agent_events').insert({
    domain: 'retail',
    action: 'deal_skip',
    status: 'success',
    output_summary: `Skipped "${product_name ?? 'unknown'}" from ${store_code ?? 'unknown'}`,
    metadata: { product_name, store_code, discount_pct: discount_pct ?? null },
  })

  return NextResponse.json({ ok: true })
}
