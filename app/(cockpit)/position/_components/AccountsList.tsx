'use client'

import { useEffect, useState } from 'react'
import type { AccountBalance } from '@/lib/quickbooks/types'

function fmt(n: number) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(n)
}

export function AccountsList() {
  const [accounts, setAccounts] = useState<AccountBalance[]>([])
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/quickbooks/accounts')
      .then((r) => r.json())
      .then((d: { accounts: AccountBalance[]; fetchedAt: string; error?: string }) => {
        if (d.error) { setError(d.error); return }
        setAccounts(d.accounts ?? [])
        setFetchedAt(d.fetchedAt)
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const banks = accounts.filter((a) => a.type === 'bank')
  const cards = accounts.filter((a) => a.type === 'credit_card')

  const panelStyle = {
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 8,
    padding: '20px 24px',
  }

  const sectionLabelStyle = {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-label)',
    fontWeight: 600,
    color: 'var(--color-text-muted)',
    marginBottom: 14,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
  }

  const rowStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBlock: 10,
    borderBottom: '1px solid var(--color-border)',
  }

  const nameStyle = {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-body)',
    color: 'var(--color-text-primary)',
  }

  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ ...panelStyle, minHeight: 120 }} />
        <div style={{ ...panelStyle, minHeight: 120 }} />
      </div>
    )
  }

  if (error) {
    return (
      <div
        style={{
          ...panelStyle,
          color: 'var(--color-critical)',
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
        }}
      >
        {error}
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Bank accounts */}
        <div style={panelStyle}>
          <div style={sectionLabelStyle}>Bank Accounts</div>
          {banks.length === 0 ? (
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                color: 'var(--color-text-muted)',
              }}
            >
              No accounts found
            </div>
          ) : (
            banks.map((a) => (
              <div key={a.id} style={rowStyle}>
                <div style={nameStyle}>{a.name}</div>
                <div
                  style={{
                    ...nameStyle,
                    fontWeight: 600,
                    color: 'var(--color-positive)',
                  }}
                >
                  {fmt(a.balance)}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Credit cards */}
        <div style={panelStyle}>
          <div style={sectionLabelStyle}>Credit Cards</div>
          {cards.length === 0 ? (
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                color: 'var(--color-text-muted)',
              }}
            >
              No accounts found
            </div>
          ) : (
            cards.map((a) => (
              <div key={a.id} style={rowStyle}>
                <div style={nameStyle}>{a.name}</div>
                <div
                  style={{
                    ...nameStyle,
                    fontWeight: 600,
                    color: 'var(--color-critical)',
                  }}
                >
                  {fmt(a.balance)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      {fetchedAt && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            marginTop: 8,
            textAlign: 'right',
          }}
        >
          From QuickBooks ·{' '}
          {new Date(fetchedAt).toLocaleTimeString('en-CA', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      )}
    </div>
  )
}
