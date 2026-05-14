import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchAccounts } from '@/lib/quickbooks/client'
import { logEvent } from '@/lib/knowledge/client'
import type { AccountBalance } from '@/lib/quickbooks/types'

export interface AccountsResponse {
  accounts: AccountBalance[]
  fetchedAt: string
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const accounts = await fetchAccounts()
    const bankTotal = accounts.filter((a) => a.type === 'bank').reduce((s, a) => s + a.balance, 0)
    const ccTotal = accounts
      .filter((a) => a.type === 'credit_card')
      .reduce((s, a) => s + a.balance, 0)
    void logEvent('quickbooks', 'accounts.fetch', {
      actor: 'user',
      status: 'success',
      outputSummary: `${accounts.length} accounts fetched`,
      meta: { account_count: accounts.length },
    })
    return NextResponse.json({
      accounts,
      fetchedAt: new Date().toISOString(),
    } satisfies AccountsResponse)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const status = message.includes('not connected') ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
