'use client'

import { useEffect, useState, useCallback } from 'react'
import type { BankRegisterResponse, AccountListResponse } from '@/app/api/bank-register/route'

function fmt(n: number) {
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 })
}

const inputStyle: React.CSSProperties = {
  fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', padding: '6px 10px',
  borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)',
  background: 'var(--color-surface-2)', color: 'var(--color-text-primary)', outline: 'none',
}

export function BankRegisterPage() {
  const [accounts, setAccounts] = useState<AccountListResponse['accounts']>([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [startDate, setStartDate] = useState(`${new Date().getFullYear()}-01-01`)
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10))
  const [data, setData] = useState<BankRegisterResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openingBalance, setOpeningBalance] = useState('0')
  const [openingDate, setOpeningDate] = useState(`${new Date().getFullYear()}-01-01`)
  const [savingOB, setSavingOB] = useState(false)

  // Load account list
  useEffect(() => {
    fetch('/api/bank-register')
      .then(r => r.json())
      .then((d: AccountListResponse) => {
        setAccounts(d.accounts)
        if (d.accounts.length > 0 && !selectedAccount) setSelectedAccount(d.accounts[0].name)
      })
      .catch(() => {})
  }, [selectedAccount])

  const loadRegister = useCallback(() => {
    if (!selectedAccount) return
    setLoading(true)
    setError(null)
    fetch(`/api/bank-register?account=${encodeURIComponent(selectedAccount)}&start=${startDate}&end=${endDate}`)
      .then(r => r.json())
      .then((d: BankRegisterResponse & { error?: string }) => {
        if (d.error) { setError(d.error); setLoading(false); return }
        setData(d)
        setOpeningBalance(String(d.openingBalance))
        setOpeningDate(d.openingDate)
        setLoading(false)
      })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [selectedAccount, startDate, endDate])

  useEffect(() => { loadRegister() }, [loadRegister])

  async function saveOpeningBalance() {
    setSavingOB(true)
    await fetch('/api/bank-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_name: selectedAccount, opening_balance: parseFloat(openingBalance) || 0, opening_date: openingDate }),
    })
    setSavingOB(false)
    loadRegister()
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-pillar-money)' }}>
          Bank Register
        </span>
        <select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)} style={inputStyle}>
          {accounts.map(a => (
            <option key={a.name} value={a.name}>{a.name} ({a.count} txn)</option>
          ))}
        </select>
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ ...inputStyle, width: 140 }} />
        <span style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--text-nano)' }}>to</span>
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ ...inputStyle, width: 140 }} />
      </div>

      {/* Opening balance setup */}
      <div style={{
        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)', padding: '14px 18px', marginBottom: 20,
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }}>
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-disabled)' }}>
          Opening Balance
        </span>
        <input
          type="number"
          value={openingBalance}
          onChange={e => setOpeningBalance(e.target.value)}
          style={{ ...inputStyle, width: 120, textAlign: 'right' }}
          placeholder="0.00"
        />
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)' }}>as of</span>
        <input type="date" value={openingDate} onChange={e => setOpeningDate(e.target.value)} style={{ ...inputStyle, width: 140 }} />
        <button onClick={saveOpeningBalance} disabled={savingOB} style={{
          fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', fontWeight: 600,
          padding: '5px 14px', background: 'var(--color-accent-gold)', border: 'none',
          borderRadius: 'var(--radius-sm)', color: '#000', cursor: 'pointer',
        }}>
          {savingOB ? 'Saving…' : 'Set'}
        </button>
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)' }}>
          Pull this from your bank statement. Expenses reduce the balance; deposits are not yet tracked.
        </span>
      </div>

      {/* Summary */}
      {data && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          {[
            { label: 'Opening Balance', value: data.openingBalance, color: 'var(--color-text-primary)' },
            { label: 'Expenses Logged', value: -data.transactions.reduce((s, t) => s + t.total, 0), color: '#e5534b' },
            { label: 'Closing Balance', value: data.closingBalance, color: data.closingBalance >= 0 ? 'var(--color-pillar-health)' : '#e5534b' },
            { label: 'Transactions', value: data.transactionCount, isCount: true, color: 'var(--color-text-primary)' },
          ].map(({ label, value, color, isCount }) => (
            <div key={label} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', flex: 1, minWidth: 130 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 700, color }}>
                {isCount ? value : fmt(value as number)}
              </div>
              <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-disabled)', marginTop: 2 }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      )}

      {loading && <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)' }}>Loading…</div>}
      {error && <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: '#e5534b' }}>{error}</div>}

      {data && !loading && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)', fontFamily: 'var(--font-ui)', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-text-disabled)', textTransform: 'uppercase' }}>
            {selectedAccount} — {data.startDate} to {data.endDate}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Date', 'Vendor', 'Category', 'Amount', 'Tax', 'Balance'].map((h, i) => (
                    <th key={h} style={{
                      fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', fontWeight: 700,
                      letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-disabled)',
                      padding: '8px 10px 8px 0', textAlign: i >= 3 ? 'right' : 'left',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.transactions.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)', padding: '20px 0', textAlign: 'center' }}>
                      No transactions for this account in the selected range.
                    </td>
                  </tr>
                )}
                {data.transactions.map((tx, i) => (
                  <tr key={tx.id} style={{ borderBottom: '1px solid var(--color-border)', background: i % 2 === 0 ? 'transparent' : 'var(--color-surface-2)' }}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)', color: 'var(--color-text-muted)', padding: '7px 10px 7px 0', whiteSpace: 'nowrap' }}>{tx.date}</td>
                    <td style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-primary)', padding: '7px 10px 7px 0' }}>{tx.vendor || '—'}</td>
                    <td style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-muted)', padding: '7px 10px 7px 0' }}>{tx.category}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)', color: '#e5534b', padding: '7px 10px 7px 0', textAlign: 'right' }}>{fmt(tx.pretax)}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)', padding: '7px 10px 7px 0', textAlign: 'right' }}>{tx.tax_amount > 0 ? fmt(tx.tax_amount) : '—'}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)', fontWeight: 600, color: tx.runningBalance >= 0 ? 'var(--color-text-primary)' : '#e5534b', padding: '7px 0', textAlign: 'right' }}>{fmt(tx.runningBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!selectedAccount && accounts.length === 0 && !loading && (
        <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)' }}>
          No accounts found. Import bank statements in Import Statement first.
        </div>
      )}
    </div>
  )
}
