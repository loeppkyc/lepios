'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AccountsResponse } from '@/app/api/quickbooks/accounts/route'
import type { AccountBalance } from '@/lib/quickbooks/types'

function fmt(amount: number, currency: string) {
  return amount.toLocaleString('en-CA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  })
}

function AccountRow({ account }: { account: AccountBalance }) {
  const isCredit = account.type === 'credit_card'
  const balanceColor =
    isCredit && account.balance > 0
      ? 'text-red-400'
      : account.balance < 0
        ? 'text-red-400'
        : 'text-green-400'

  return (
    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-white">{account.name}</span>
        <span className="text-xs text-white/40">
          {isCredit ? 'Credit Card' : 'Bank'} · {account.subType}
        </span>
      </div>
      <span className={`font-mono text-sm font-semibold ${balanceColor}`}>
        {fmt(account.balance, account.currency)}
      </span>
    </div>
  )
}

function AccountGroup({ title, accounts }: { title: string; accounts: AccountBalance[] }) {
  if (accounts.length === 0) return null
  const total = accounts.reduce((sum, a) => sum + a.balance, 0)
  const currency = accounts[0]?.currency ?? 'CAD'
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold tracking-wider text-white/50 uppercase">{title}</h2>
        <span className="font-mono text-xs text-white/50">{fmt(total, currency)} total</span>
      </div>
      {accounts.map((a) => (
        <AccountRow key={a.id} account={a} />
      ))}
    </div>
  )
}

// Read URL params once at mount — lazy initializer avoids setState in effects.
function getInitialUrlState() {
  if (typeof window === 'undefined') return { urlError: null, wasConnected: false }
  const params = new URLSearchParams(window.location.search)
  return {
    urlError: params.get('error'),
    wasConnected: params.get('connected') === '1',
  }
}

export function QuickBooksPage() {
  const [{ urlError, wasConnected }] = useState(getInitialUrlState)
  const [data, setData] = useState<AccountsResponse | null>(null)
  const [loading, setLoading] = useState(!urlError)
  const [error, setError] = useState<string | null>(urlError)
  const [disconnecting, setDisconnecting] = useState(false)

  // Clean URL on mount (connected=1 or error param)
  useEffect(() => {
    if (wasConnected || urlError) {
      window.history.replaceState({}, '', '/quickbooks')
    }
  }, [wasConnected, urlError])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/quickbooks/accounts')
      if (res.status === 503) {
        setError('not_connected')
      } else if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        setError(body.error ?? 'Failed to load accounts')
      } else {
        setData((await res.json()) as AccountsResponse)
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch on mount only when there's no URL error to show
  useEffect(() => {
    if (!urlError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load()
    }
  }, [load, urlError])

  async function handleDisconnect() {
    if (!confirm('Disconnect QuickBooks? LepiOS will lose access to your account balances.')) return
    setDisconnecting(true)
    await fetch('/api/quickbooks/disconnect', { method: 'POST' })
    setDisconnecting(false)
    setData(null)
    setError('not_connected')
  }

  const bankAccounts = data?.accounts.filter((a) => a.type === 'bank') ?? []
  const creditCards = data?.accounts.filter((a) => a.type === 'credit_card') ?? []

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">QuickBooks Accounts</h1>
          {data?.fetchedAt && (
            <p className="mt-0.5 text-xs text-white/40">
              Updated {new Date(data.fetchedAt).toLocaleTimeString('en-CA')}
            </p>
          )}
        </div>
        {data && (
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-white/50 transition hover:border-red-500/50 hover:text-red-400 disabled:opacity-50"
          >
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-white/40">
          Loading accounts…
        </div>
      )}

      {!loading && error === 'not_connected' && (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-white/10 bg-white/5 py-16">
          <p className="text-sm text-white/60">QuickBooks is not connected.</p>
          <a
            href="/api/quickbooks/connect"
            className="rounded-lg bg-[#2CA01C] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#248518]"
          >
            Connect QuickBooks
          </a>
        </div>
      )}

      {!loading && error && error !== 'not_connected' && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
          <button onClick={load} className="ml-3 underline hover:no-underline">
            Retry
          </button>
        </div>
      )}

      {!loading && data && (
        <div className="flex flex-col gap-6">
          <AccountGroup title="Bank Accounts" accounts={bankAccounts} />
          <AccountGroup title="Credit Cards" accounts={creditCards} />
          {bankAccounts.length === 0 && creditCards.length === 0 && (
            <p className="text-center text-sm text-white/40">
              No active bank or credit card accounts found in QuickBooks.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
