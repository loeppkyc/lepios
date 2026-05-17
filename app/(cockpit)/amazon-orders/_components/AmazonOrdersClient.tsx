'use client'

import { useEffect, useState, useRef } from 'react'

// Inline types per F11
interface AmazonOrder {
  id: string
  order_date: string
  status: string
  revenue: number
  units: number
  asin: string | null
  title: string | null
}

interface AmazonOrdersResponse {
  orders: AmazonOrder[]
  total: number
  page: number
  limit: number
  month: string
  status_filter: string | null
}

const STATUS_OPTIONS = ['All', 'Shipped', 'Pending', 'Unshipped', 'Canceled', 'Returned']

const STATUS_COLORS: Record<string, string> = {
  Shipped: 'var(--color-pillar-health)',
  Pending: 'var(--color-accent-gold)',
  Unshipped: 'var(--color-accent-gold)',
  Canceled: '#e5534b',
  Returned: '#e5534b',
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

function fmtCad(n: number): string {
  return n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${y}-${m}-${d}`
}

/** Generate a CSV string from the orders array */
function exportCsv(orders: AmazonOrder[], month: string): void {
  const headers = ['Order ID', 'Date', 'Status', 'Revenue (CAD)', 'Units', 'ASIN', 'Title']
  const rows = orders.map((o) => [
    o.id,
    o.order_date,
    o.status,
    o.revenue.toFixed(2),
    String(o.units),
    o.asin ?? '',
    (o.title ?? '').replace(/"/g, '""'),
  ])
  const csv = [headers, ...rows].map((row) => row.map((v) => `"${v}"`).join(',')).join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `amazon-orders-${month}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function AmazonOrdersClient() {
  const [month, setMonth] = useState(currentMonth)
  const [status, setStatus] = useState('All')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<AmazonOrdersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  // Track previous filter values to detect filter changes vs. page changes
  const prevFilters = useRef({ month, status })

  useEffect(() => {
    // If filters changed, reset to page 1
    const filtersChanged =
      prevFilters.current.month !== month || prevFilters.current.status !== status
    prevFilters.current = { month, status }
    const activePage = filtersChanged ? 1 : page

    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      const params = new URLSearchParams({
        month,
        page: String(activePage),
        limit: '50',
      })
      if (status !== 'All') params.set('status', status)

      try {
        const r = await fetch(`/api/amazon-orders?${params.toString()}`)
        const json = (await r.json()) as AmazonOrdersResponse & { error?: string }
        if (cancelled) return
        if (json.error) setError(json.error)
        else setData(json)
      } catch (e: unknown) {
        if (!cancelled) setError(String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [month, status, page])

  async function handleExport() {
    if (!data) return
    setExporting(true)
    // Fetch all orders for the current filter (no pagination)
    const params = new URLSearchParams({ month, limit: '200' })
    if (status !== 'All') params.set('status', status)

    try {
      const r = await fetch(`/api/amazon-orders?${params.toString()}`)
      const json = (await r.json()) as AmazonOrdersResponse & { error?: string }
      if (!json.error) {
        exportCsv(json.orders, month)
      }
    } catch {
      // noop
    } finally {
      setExporting(false)
    }
  }

  const totalPages = data ? Math.ceil(data.total / 50) : 0
  const totalRevenue = data?.orders.reduce((s, o) => s + o.revenue, 0) ?? 0
  const totalUnits = data?.orders.reduce((s, o) => s + o.units, 0) ?? 0

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
          flexWrap: 'wrap',
          gap: 12,
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
          Amazon Orders
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Month picker */}
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-small)',
              padding: '4px 8px',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
            }}
          />
          {/* Status filter */}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              padding: '4px 8px',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
            }}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {/* Export */}
          <button
            onClick={handleExport}
            disabled={exporting || !data || data.orders.length === 0}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              fontWeight: 600,
              padding: '4px 12px',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color: exporting ? 'var(--color-text-disabled)' : 'var(--color-text-primary)',
              cursor: exporting || !data || data.orders.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      {data && !loading && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          {[
            { label: 'Total Orders', value: String(data.total) },
            { label: 'Revenue (page)', value: fmtCad(totalRevenue) },
            { label: 'Units (page)', value: String(totalUnits) },
          ].map(({ label, value }) => (
            <div
              key={label}
              style={{
                flex: 1,
                minWidth: 130,
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '14px 18px',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.2rem',
                  fontWeight: 700,
                  color: 'var(--color-accent-gold)',
                }}
              >
                {value}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--color-text-disabled)',
                  marginTop: 4,
                }}
              >
                {label}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* State indicators */}
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
      {error && (
        <div
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid #e5534b',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 16px',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-small)',
            color: '#e5534b',
          }}
        >
          {error}
        </div>
      )}

      {/* Orders table */}
      {!loading && data && (
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            marginBottom: 16,
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Order ID', 'Date', 'ASIN', 'Status', 'Revenue', 'Units'].map((h, i) => (
                    <th
                      key={h}
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-nano)',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: 'var(--color-text-disabled)',
                        padding: '10px 14px',
                        borderBottom: '1px solid var(--color-border)',
                        textAlign: i >= 4 ? 'right' : 'left',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.orders.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      style={{
                        padding: '24px 14px',
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-small)',
                        color: 'var(--color-text-disabled)',
                        textAlign: 'center',
                      }}
                    >
                      No orders found for {month}
                      {status !== 'All' ? ` · ${status}` : ''}
                    </td>
                  </tr>
                ) : (
                  data.orders.map((order, i) => (
                    <tr
                      key={order.id}
                      style={{
                        background: i % 2 === 0 ? 'transparent' : 'var(--color-surface-2)',
                        borderBottom: '1px solid var(--color-border)',
                      }}
                    >
                      <td
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-nano)',
                          color: 'var(--color-text-muted)',
                          padding: '8px 14px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {order.id}
                      </td>
                      <td
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-small)',
                          color: 'var(--color-text-primary)',
                          padding: '8px 14px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {fmtDate(order.order_date)}
                      </td>
                      <td
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-nano)',
                          color: 'var(--color-text-muted)',
                          padding: '8px 14px',
                        }}
                      >
                        {order.asin ?? '—'}
                      </td>
                      <td style={{ padding: '8px 14px' }}>
                        <span
                          style={{
                            fontFamily: 'var(--font-ui)',
                            fontSize: 'var(--text-nano)',
                            fontWeight: 700,
                            letterSpacing: '0.06em',
                            color: STATUS_COLORS[order.status] ?? 'var(--color-text-muted)',
                          }}
                        >
                          {order.status}
                        </span>
                      </td>
                      <td
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-small)',
                          fontWeight: 700,
                          color: 'var(--color-accent-gold)',
                          padding: '8px 14px',
                          textAlign: 'right',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {fmtCad(order.revenue)}
                      </td>
                      <td
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-small)',
                          color: 'var(--color-text-primary)',
                          padding: '8px 14px',
                          textAlign: 'right',
                        }}
                      >
                        {order.units}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {!loading && data && totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              padding: '4px 12px',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color: page <= 1 ? 'var(--color-text-disabled)' : 'var(--color-text-primary)',
              cursor: page <= 1 ? 'not-allowed' : 'pointer',
            }}
          >
            Prev
          </button>
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-text-muted)',
            }}
          >
            Page {page} of {totalPages} · {data.total} orders
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              padding: '4px 12px',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color:
                page >= totalPages ? 'var(--color-text-disabled)' : 'var(--color-text-primary)',
              cursor: page >= totalPages ? 'not-allowed' : 'pointer',
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
