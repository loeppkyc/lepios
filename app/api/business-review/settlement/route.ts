import { NextResponse } from 'next/server'
import { spApiConfigured } from '@/lib/amazon/client'
import {
  fetchSettlementBalance,
  fetchAllFinancialEventGroups,
  type SettlementBalance,
} from '@/lib/amazon/finances'

// Constraint B-9: fast route — no caching; finances returns one page (~82 groups), sub-second
export const dynamic = 'force-dynamic'

export interface SettlementResponse extends SettlementBalance {}

export async function GET(request: Request) {
  if (!spApiConfigured()) {
    return NextResponse.json({ error: 'SP-API credentials not configured' }, { status: 503 })
  }

  const url = new URL(request.url)
  const debug = url.searchParams.get('debug') === '1'

  try {
    if (debug) {
      // Return raw groups so we can diagnose filter issues
      const groups = await fetchAllFinancialEventGroups(180)
      return NextResponse.json({
        total_groups: groups.length,
        groups: groups.map((g) => ({
          id: g.FinancialEventGroupId,
          status: g.FundTransferStatus ?? null,
          currency: g.OriginalTotal?.CurrencyCode ?? null,
          amount: g.OriginalTotal?.CurrencyAmount ?? null,
          start: g.FinancialEventGroupStart ?? null,
          end: g.FinancialEventGroupEnd ?? null,
        })),
      })
    }

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
