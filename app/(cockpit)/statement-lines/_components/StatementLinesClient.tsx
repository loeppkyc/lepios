'use client'

import { useState, useRef, useEffect } from 'react'
import type {
  StatementLinesResponse,
  StatementImport,
  StatementLine,
} from '@/app/api/statement-lines/route'

const ACCOUNTS = [
  'TD Chequing (9150)',
  'Amex Business Platinum',
  'Capital One Visa',
  'Canadian Tire MC',
  'TD Visa',
  'TD USD Chequing',
  'PayPal',
  'Amex Bonvoy',
]

const MONTHS = [
  { value: '2026-04', label: 'April 2026' },
  { value: '2026-03', label: 'March 2026' },
  { value: '2026-02', label: 'February 2026' },
  { value: '2026-01', label: 'January 2026' },
  { value: '2025-12', label: 'December 2025' },
]

const mono = (extra?: React.CSSProperties): React.CSSProperties => ({
  fontFamily: 'var(--font-mono)',
  fontSize: '0.75rem',
  ...extra,
})

const pill = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 7px',
  borderRadius: 4,
  fontSize: '0.65rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  background:
    color === 'green'
      ? 'rgba(63,185,80,0.12)'
      : color === 'red'
        ? 'rgba(229,83,75,0.12)'
        : 'rgba(255,255,255,0.06)',
  color: color === 'green' ? '#3fb950' : color === 'red' ? '#e5534b' : 'var(--color-text-disabled)',
  border: `1px solid ${color === 'green' ? 'rgba(63,185,80,0.25)' : color === 'red' ? 'rgba(229,83,75,0.25)' : 'var(--color-border)'}`,
})

interface ImportResult {
  import_id: string
  account: string
  rows_total: number
  truncated: boolean
  source_file: string
}

export function StatementLinesClient() {
  const [month, setMonth] = useState('2026-04')
  const [data, setData] = useState<StatementLinesResponse | null>(null)
  const [loading, setLoading] = useState(true)

  // Upload state
  const [account, setAccount] = useState(ACCOUNTS[0])
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const r = await fetch(`/api/statement-lines?month=${month}`)
        const j = (await r.json()) as StatementLinesResponse
        if (!cancelled) setData(j)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [month])

  async function handleUpload() {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setUploadErr('Choose a CSV file first')
      return
    }
    setUploadErr(null)
    setResult(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('account', account)
      const r = await fetch('/api/statement-lines/import', { method: 'POST', body: fd })
      const j = (await r.json()) as ImportResult & { error?: string }
      if (!r.ok) throw new Error(j.error ?? 'Import failed')
      setResult(j)
      if (fileRef.current) fileRef.current.value = ''
      const refresh = await fetch(`/api/statement-lines?month=${month}`)
      setData((await refresh.json()) as StatementLinesResponse)
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  // Group lines by account
  const byAccount = new Map<string, StatementLine[]>()
  for (const line of data?.lines ?? []) {
    const key = line.source_account
    if (!byAccount.has(key)) byAccount.set(key, [])
    byAccount.get(key)!.push(line)
  }

  return (
    <div style={{ padding: '24px 32px', fontFamily: 'var(--font-ui)' }}>
      {/* Header */}
      <div
        style={{
          marginBottom: 28,
          display: 'flex',
          alignItems: 'baseline',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <h1
          style={{
            fontFamily: 'var(--font-display, var(--font-ui))',
            fontSize: '1.15rem',
            fontWeight: 800,
            letterSpacing: '0.06em',
            color: 'var(--color-text-primary)',
            textTransform: 'uppercase',
            margin: 0,
          }}
        >
          Statement Lines
        </h1>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            color: 'var(--color-text-primary)',
            padding: '4px 8px',
            cursor: 'pointer',
          }}
        >
          {MONTHS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        {data && (
          <span style={mono({ color: 'var(--color-text-disabled)' })}>
            {data.debit_count} debits · {data.credit_count} credits · {data.receipt_count} receipts
            · {data.invoice_count} invoices in Gmail
          </span>
        )}
      </div>

      {/* Upload section */}
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          padding: '20px 24px',
          marginBottom: 28,
          maxWidth: 580,
        }}
      >
        <div
          style={{
            fontSize: '0.7rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: 'var(--color-text-disabled)',
            textTransform: 'uppercase',
            marginBottom: 14,
          }}
        >
          Import Statement CSV
        </div>

        {uploadErr && (
          <div
            style={{
              background: '#2a1a1a',
              border: '1px solid #e5534b',
              borderRadius: 4,
              padding: '8px 12px',
              color: '#e5534b',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              marginBottom: 14,
            }}
          >
            {uploadErr}
          </div>
        )}

        {result && (
          <div
            style={{
              background: 'rgba(63,185,80,0.07)',
              border: '1px solid rgba(63,185,80,0.25)',
              borderRadius: 4,
              padding: '10px 14px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              color: '#3fb950',
              marginBottom: 14,
            }}
          >
            Imported {result.rows_total} lines from {result.source_file}
            {result.truncated && ' (CSV was large — first 80K chars parsed)'}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <div
              style={{ fontSize: '0.68rem', color: 'var(--color-text-disabled)', marginBottom: 4 }}
            >
              Account
            </div>
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 4,
                color: 'var(--color-text-primary)',
                padding: '6px 8px',
                cursor: 'pointer',
              }}
            >
              {ACCOUNTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div
              style={{ fontSize: '0.68rem', color: 'var(--color-text-disabled)', marginBottom: 4 }}
            >
              CSV File
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
                color: 'var(--color-text-muted)',
                width: '100%',
              }}
            />
          </div>
          <button
            onClick={() => void handleUpload()}
            disabled={uploading}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: '0.75rem',
              fontWeight: 700,
              letterSpacing: '0.06em',
              padding: '8px 18px',
              background: uploading ? 'var(--color-surface-2)' : 'var(--color-accent-gold)',
              color: uploading ? 'var(--color-text-disabled)' : '#000',
              border: 'none',
              borderRadius: 4,
              cursor: uploading ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {uploading ? 'Importing…' : 'Import'}
          </button>
        </div>
        <div style={{ fontSize: '0.65rem', color: 'var(--color-text-disabled)', marginTop: 8 }}>
          Export CSV from your bank portal: TD → Activity, Capital One → Transactions, Amex →
          Download Statement
        </div>
      </div>

      {/* Account coverage for selected month */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: '0.7rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: 'var(--color-text-disabled)',
            textTransform: 'uppercase',
            marginBottom: 10,
          }}
        >
          Account Coverage — {MONTHS.find((m) => m.value === month)?.label}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ACCOUNTS.map((acct) => {
            const hasLines = byAccount.has(acct)
            const lineCount = byAccount.get(acct)?.length ?? 0
            return (
              <div
                key={acct}
                style={{
                  padding: '6px 12px',
                  borderRadius: 4,
                  border: `1px solid ${hasLines ? 'rgba(63,185,80,0.25)' : 'var(--color-border)'}`,
                  background: hasLines ? 'rgba(63,185,80,0.06)' : 'var(--color-surface)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.72rem',
                  color: hasLines ? '#3fb950' : 'var(--color-text-disabled)',
                }}
              >
                {hasLines ? '✓' : '✗'} {acct} {hasLines ? `(${lineCount})` : ''}
              </div>
            )
          })}
        </div>
      </div>

      {/* Transactions by account */}
      {loading ? (
        <div style={mono({ color: 'var(--color-text-disabled)' })}>Loading…</div>
      ) : byAccount.size === 0 ? (
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            padding: '28px 24px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8rem',
            color: 'var(--color-text-disabled)',
            textAlign: 'center',
          }}
        >
          No statement lines for {MONTHS.find((m) => m.value === month)?.label}. Import a CSV above
          to get started.
        </div>
      ) : (
        Array.from(byAccount.entries()).map(([acct, lines]) => (
          <AccountBlock key={acct} account={acct} lines={lines} />
        ))
      )}

      {/* Import history */}
      {(data?.imports?.length ?? 0) > 0 && (
        <div style={{ marginTop: 32 }}>
          <div
            style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: 'var(--color-text-disabled)',
              textTransform: 'uppercase',
              marginBottom: 10,
            }}
          >
            Import History
          </div>
          <div
            style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 6 }}
          >
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.72rem',
              }}
            >
              <thead>
                <tr
                  style={{
                    background: 'var(--color-surface-2)',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  {['Account', 'File', 'Rows', 'Status', 'Date'].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '8px 12px',
                        textAlign: 'left',
                        fontSize: '0.62rem',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        color: 'var(--color-text-disabled)',
                        textTransform: 'uppercase',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.imports ?? []).map((imp: StatementImport) => (
                  <tr key={imp.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '7px 12px', color: 'var(--color-text-primary)' }}>
                      {imp.source_account}
                    </td>
                    <td style={{ padding: '7px 12px', color: 'var(--color-text-muted)' }}>
                      {imp.source_file}
                    </td>
                    <td style={{ padding: '7px 12px', color: 'var(--color-text-muted)' }}>
                      {imp.total_rows}
                    </td>
                    <td style={{ padding: '7px 12px' }}>
                      <span
                        style={pill(
                          imp.status === 'completed'
                            ? 'green'
                            : imp.status === 'error'
                              ? 'red'
                              : 'grey'
                        )}
                      >
                        {imp.status}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: '7px 12px',
                        color: 'var(--color-text-disabled)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {new Date(imp.imported_at).toLocaleDateString('en-CA')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function AccountBlock({ account, lines }: { account: string; lines: StatementLine[] }) {
  const debits = lines.filter((l) => l.is_debit)
  const credits = lines.filter((l) => !l.is_debit)
  const totalDebits = debits.reduce((s, l) => s + Math.abs(l.amount_signed), 0)
  const [showCredits, setShowCredits] = useState(false)

  const displayLines = showCredits ? lines : debits

  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          marginBottom: 8,
          padding: '6px 0',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontWeight: 700,
            fontSize: '0.85rem',
            color: 'var(--color-text-primary)',
          }}
        >
          {account}
        </span>
        <span style={mono({ color: 'var(--color-text-disabled)' })}>
          {debits.length} debits · ${totalDebits.toFixed(2)} · {credits.length} credits
        </span>
        <button
          onClick={() => setShowCredits((v) => !v)}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '0.68rem',
            background: 'none',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            color: 'var(--color-text-disabled)',
            padding: '2px 8px',
            cursor: 'pointer',
            marginLeft: 'auto',
          }}
        >
          {showCredits ? 'Debits only' : 'Show all'}
        </button>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 6 }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.73rem',
          }}
        >
          <thead>
            <tr
              style={{
                background: 'var(--color-surface-2)',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              {['Date', 'Description', 'Vendor', 'Amount', 'Type'].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '6px 10px',
                    textAlign: 'left',
                    fontSize: '0.6rem',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    color: 'var(--color-text-disabled)',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayLines.map((line) => (
              <tr key={line.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td
                  style={{
                    padding: '5px 10px',
                    color: 'var(--color-text-muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {line.txn_date}
                </td>
                <td
                  style={{ padding: '5px 10px', color: 'var(--color-text-primary)', maxWidth: 280 }}
                >
                  <span
                    style={{
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {line.description}
                  </span>
                </td>
                <td style={{ padding: '5px 10px', color: 'var(--color-text-muted)' }}>
                  {line.vendor_extracted ?? '—'}
                </td>
                <td
                  style={{
                    padding: '5px 10px',
                    textAlign: 'right',
                    whiteSpace: 'nowrap',
                    color: line.is_debit ? '#e5534b' : '#3fb950',
                    fontWeight: 600,
                  }}
                >
                  {line.is_debit ? '-' : '+'}${Math.abs(line.amount_signed).toFixed(2)}
                </td>
                <td style={{ padding: '5px 10px' }}>
                  <span style={pill(line.is_debit ? 'red' : 'green')}>
                    {line.is_debit ? 'debit' : 'credit'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
