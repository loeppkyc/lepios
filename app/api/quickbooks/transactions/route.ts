import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchTransactions } from '@/lib/quickbooks/client'
import { logEvent } from '@/lib/knowledge/client'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get('start') ?? '2026-04-01'
  const endDate = searchParams.get('end') ?? '2026-04-30'

  try {
    const transactions = await fetchTransactions(startDate, endDate)
    await logEvent('qbo', 'transactions_fetch', {
      entity: `${startDate}:${endDate}`,
      meta: { count: transactions.length },
    })
    return NextResponse.json({
      transactions,
      startDate,
      endDate,
      fetchedAt: new Date().toISOString(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('not connected')) {
      return NextResponse.json({ error: 'not_connected' }, { status: 503 })
    }
    await logEvent('qbo', 'transactions_error', { status: 'error', entity: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export type TransactionsResponse = {
  transactions: import('@/lib/quickbooks/types').QBOTransactionRow[]
  startDate: string
  endDate: string
  fetchedAt: string
}
