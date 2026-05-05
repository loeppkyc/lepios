'use client'

import { useEffect, useState, useCallback } from 'react'

interface SummaryRow {
  id: string
  je_number: string
  je_date: string
  name: string | null
  description: string | null
  total_debit: number
  total_credit: number
  exported_to_qb_at: string | null
}

interface Summary {
  unexportedCount: number
  unexportedTotal: number
  earliestDate: string | null
  latestDate: string | null
  jes: SummaryRow[]
}

function fmt(n: number): string {
  return n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const s = {
  card: {
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    padding: '20px 24px',
  } as React.CSSProperties,
  metricLabel: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-nano)',
    color: 'var(--color-text-disabled)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 3,
  } as React.CSSProperties,
  metricValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: '1.3rem',
    fontWeight: 700,
    color: 'var(--color-text-primary)',
  } as React.CSSProperties,
  th: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-nano)',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--color-text-disabled)',
    padding: '0 10px 8px 0',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'left',
  } as React.CSSProperties,
  thRight: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-nano)',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--color-text-disabled)',
    padding: '0 0 8px 10px',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'right',
  } as React.CSSProperties,
  td: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    color: 'var(--color-text-secondary)',
    padding: '7px 10px 7px 0',
    borderBottom: '1px solid var(--color-border)',
  } as React.CSSProperties,
  tdMono: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-small)',
    color: 'var(--color-text-primary)',
    padding: '7px 0 7px 10px',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'right',
  } as React.CSSProperties,
  btnPrimary: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    fontWeight: 600,
    letterSpacing: '0.06em',
    padding: '8px 18px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-pillar-money)',
    background: 'var(--color-pillar-money)',
    color: 'var(--color-bg)',
    cursor: 'pointer',
  } as React.CSSProperties,
  btnSecondary: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    fontWeight: 600,
    letterSpacing: '0.06em',
    padding: '8px 18px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-border)',
    background: 'none',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
  } as React.CSSProperties,
}

export function QbExportPage() {
  const [data, setData] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [downloaded, setDownloaded] = useState<{ ids: string[]; at: string } | null>(null)
  const [marking, setMarking] = useState(false)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const [refetchKey, setRefetchKey] = useState(0)

  const reload = useCallback(() => setRefetchKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setFetchError(null)
      try {
        const res = await fetch('/api/bookkeeping/qb-export', { cache: 'no-store' })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        const j = (await res.json()) as Summary
        if (!cancelled) setData(j)
      } catch (e: unknown) {
        if (!cancelled) setFetchError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [refetchKey])

  async function handleDownload() {
    setFlash(null)
    if (!data || data.unexportedCount === 0) return
    try {
      const res = await fetch('/api/bookkeeping/qb-export?format=csv', { cache: 'no-store' })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const idHeader = res.headers.get('X-Lepios-Je-Ids') ?? ''
      const ids = idHeader.split(',').filter(Boolean)
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const m = /filename="([^"]+)"/.exec(cd)
      const filename = m?.[1] ?? `lepios-qb-export-${new Date().toISOString().slice(0, 10)}.csv`

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)

      setDownloaded({ ids, at: new Date().toISOString() })
      setFlash({ kind: 'ok', msg: `Downloaded ${ids.length} JEs (${filename})` })
    } catch (e: unknown) {
      setFlash({ kind: 'err', msg: e instanceof Error ? e.message : String(e) })
    }
  }

  async function handleMarkExported() {
    if (!downloaded || downloaded.ids.length === 0) return
    setMarking(true)
    setFlash(null)
    try {
      const res = await fetch('/api/bookkeeping/qb-export/mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ je_ids: downloaded.ids }),
      })
      const body = (await res.json()) as {
        error?: string
        marked?: number
        skipped?: number
        batch?: string
      }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setFlash({
        kind: 'ok',
        msg: `Marked ${body.marked ?? 0} JEs as exported${body.skipped ? ` (${body.skipped} already exported, skipped)` : ''}`,
      })
      setDownloaded(null)
      reload()
    } catch (e: unknown) {
      setFlash({ kind: 'err', msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setMarking(false)
    }
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--color-pillar-money)',
          }}
        >
          QB Export
          {data && data.unexportedCount > 0 && (
            <span style={{ marginLeft: 8, color: 'var(--color-text-muted)' }}>
              ({data.unexportedCount} pending)
            </span>
          )}
        </span>
        <button onClick={reload} style={s.btnSecondary}>
          Refresh
        </button>
      </div>

      {loading && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
          }}
        >
          Loading…
        </div>
      )}
      {fetchError && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-critical)',
          }}
        >
          Error: {fetchError}
        </div>
      )}

      {!loading && !fetchError && data && (
        <>
          {/* Summary cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div style={s.card}>
              <div style={s.metricLabel}>Pending JEs</div>
              <div style={s.metricValue}>{data.unexportedCount}</div>
            </div>
            <div style={s.card}>
              <div style={s.metricLabel}>Total (Debits)</div>
              <div style={s.metricValue}>${fmt(data.unexportedTotal)}</div>
            </div>
            <div style={s.card}>
              <div style={s.metricLabel}>Date Range</div>
              <div style={{ ...s.metricValue, fontSize: '0.95rem' }}>
                {data.earliestDate ? `${data.earliestDate} → ${data.latestDate}` : '—'}
              </div>
            </div>
          </div>

          {/* Action area */}
          <div style={{ ...s.card, marginBottom: 16 }}>
            <div
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <button
                onClick={handleDownload}
                disabled={data.unexportedCount === 0}
                style={s.btnPrimary}
              >
                Download CSV ({data.unexportedCount})
              </button>
              {downloaded && (
                <button onClick={handleMarkExported} disabled={marking} style={s.btnPrimary}>
                  {marking ? 'Marking…' : `Mark ${downloaded.ids.length} as exported`}
                </button>
              )}
              {downloaded && (
                <span
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-nano)',
                    color: 'var(--color-text-disabled)',
                  }}
                >
                  Import the CSV in QB Online (Banking → Receipts → Upload, or via Saasant
                  Transactions / Transaction Pro), then mark as exported.
                </span>
              )}
              {flash && (
                <span
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-small)',
                    color:
                      flash.kind === 'ok'
                        ? 'var(--color-positive, #4caf50)'
                        : 'var(--color-critical)',
                  }}
                >
                  {flash.msg}
                </span>
              )}
            </div>
          </div>

          {/* JE table */}
          {data.jes.length === 0 ? (
            <div style={s.card}>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-positive, #4caf50)',
                }}
              >
                No JEs pending export. Everything is in sync with QB.
              </div>
            </div>
          ) : (
            <div style={s.card}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={s.th}>Date</th>
                    <th style={s.th}>JE #</th>
                    <th style={s.th}>Vendor / Name</th>
                    <th style={s.th}>Description</th>
                    <th style={{ ...s.thRight, textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jes.map((j) => (
                    <tr key={j.id}>
                      <td style={{ ...s.td, fontFamily: 'var(--font-mono)' }}>{j.je_date}</td>
                      <td
                        style={{
                          ...s.td,
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        {j.je_number}
                      </td>
                      <td style={s.td}>{j.name ?? '—'}</td>
                      <td style={{ ...s.td, color: 'var(--color-text-muted)' }}>
                        {j.description ?? ''}
                      </td>
                      <td style={s.tdMono}>${fmt(j.total_debit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
