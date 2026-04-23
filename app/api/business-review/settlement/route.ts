import { NextResponse } from 'next/server'
import { spApiConfigured } from '@/lib/amazon/client'
import { fetchSettlementBalance, type SettlementBalance } from '@/lib/amazon/finances'

// Constraint B-9: fast route — no caching; finances returns one page (~82 groups), sub-second
export const dynamic = 'force-dynamic'

export interface SettlementResponse extends SettlementBalance {}

export async function GET() {
  if (!spApiConfigured()) {
    return NextResponse.json({ error: 'SP-API credentials not configured' }, { status: 503 })
  }

  try {
    const balance = await fetchSettlementBalance()
    return NextResponse.json(balance satisfies SettlementResponse)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // Kill signal 1: 403 — Finances role revoked
    if (message.includes('403')) {
      return NextResponse.json(
        { error: `SP-API Finances returned 403 — role may have been revoked: ${message}` },
        { status: 502 }
      )
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
