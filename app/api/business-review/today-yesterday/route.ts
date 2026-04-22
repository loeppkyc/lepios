import { NextResponse } from 'next/server'
import { spApiConfigured } from '@/lib/amazon/client'
import {
  fetchOrders,
  aggregateOrders,
  todayMidnightEdmontonUTC,
  yesterdayMidnightEdmontonUTC,
  yesterdayEndEdmontonUTC,
  type DayPanelData,
} from '@/lib/amazon/orders'

export const dynamic = 'force-dynamic'

export interface TodayYesterdayResponse {
  today: DayPanelData
  yesterday: DayPanelData
  fetchedAt: string
}

export async function GET() {
  if (!spApiConfigured()) {
    return NextResponse.json({ error: 'SP-API credentials not configured' }, { status: 503 })
  }

  try {
    const todayAfter = todayMidnightEdmontonUTC()
    const yesterdayAfter = yesterdayMidnightEdmontonUTC()
    const yesterdayBefore = yesterdayEndEdmontonUTC()

    // Constraint 1 (CreatedBefore future-date rule):
    // Today query: omit CreatedBefore — today's end is in the future → HTTP 400
    // Yesterday query: both boundaries are in the past → safe to use both
    const [todayOrders, yesterdayOrders] = await Promise.all([
      fetchOrders({ createdAfter: todayAfter }),
      fetchOrders({ createdAfter: yesterdayAfter, createdBefore: yesterdayBefore }),
    ])

    const today = aggregateOrders(todayOrders)
    const yesterday = aggregateOrders(yesterdayOrders)

    const body: TodayYesterdayResponse = {
      today,
      yesterday,
      fetchedAt: new Date().toISOString(),
    }

    return NextResponse.json(body)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // Kill signal 1: 403 from SP-API Orders
    if (message.includes('403')) {
      return NextResponse.json(
        { error: `SP-API Orders returned 403 — credentials may have been revoked: ${message}` },
        { status: 502 }
      )
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
