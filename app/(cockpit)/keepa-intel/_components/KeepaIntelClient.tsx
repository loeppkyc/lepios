'use client'

import { useState, useEffect, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TokenStatus {
  tokensLeft: number
  refillRate: number
  refillIn: number
  estimates: {
    scan50WithHistory: number
    scan50StatsOnly: number
    scan100StatsOnly: number
  }
}

interface KeepaDeal {
  id: string
  asin: string
  title: string
  category: string
  current_price_cad: number | null
  avg_90d_price_cad: number | null
  discount_pct: number | null
  bsr: number | null
  domain: number
  saved_at: string
}

interface LiveDeal {
  asin: string
  title: string
  currentPriceCad: number | null
  avg90dPriceCad: number | null
  discountPct: number | null
  bsr: number | null
  category: string
  domain: number
}

interface PriceAlert {
  id: string
  asin: string
  title: string | null
  alert_type: 'price_below' | 'price_above' | 'rank_below' | 'rank_above'
  threshold: number
  current_value: number | null
  last_checked_at: string | null
  triggered: boolean
  notes: string | null
  created_at: string
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--color-surface-1)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px 20px',
}

const label: React.CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-nano)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  color: 'var(--color-text-disabled)',
  display: 'block',
  marginBottom: 4,
}

const btn = (disabled: boolean, variant: 'primary' | 'ghost' = 'primary'): React.CSSProperties => ({
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-body)',
  fontWeight: 600,
  padding: '8px 20px',
  background: disabled
    ? 'var(--color-surface-2)'
    : variant === 'ghost'
      ? 'transparent'
      : 'var(--color-accent-gold)',
  color: disabled
    ? 'var(--color-text-disabled)'
    : variant === 'ghost'
      ? 'var(--color-text-muted)'
      : 'var(--color-base)',
  border: variant === 'ghost' ? '1px solid var(--color-border)' : 'none',
  borderRadius: 'var(--radius-md)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  flexShrink: 0,
})

const input: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-body)',
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text-primary)',
  padding: '8px 12px',
  width: '100%',
}

const select: React.CSSProperties = {
  ...input,
  cursor: 'pointer',
}

const TABS = ['Token Status', 'Deal Finder', 'Price Alerts', 'Data Explorer'] as const
type Tab = (typeof TABS)[number]

const CA_CATEGORIES = [
  'Books',
  'Toys',
  'Electronics',
  'VideoGames',
  'Sports',
  'Tools',
  'Clothing',
  'Baby',
]
const ALERT_TYPES = ['price_below', 'price_above', 'rank_below', 'rank_above'] as const

// ── Token Status ──────────────────────────────────────────────────────────────

function TokenStatusTab() {
  const [status, setStatus] = useState<TokenStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/keepa/tokens')
      .then((r) => r.json())
      .then((d) => setStatus(d))
      .catch(() => setError('Failed to load token status'))
      .finally(() => setLoading(false))
  }, [])

  if (loading)
    return (
      <p
        style={{
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-body)',
        }}
      >
        Loading…
      </p>
    )
  if (error)
    return (
      <p
        style={{
          color: 'var(--color-negative)',
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-body)',
        }}
      >
        {error}
      </p>
    )
  if (!status) return null

  const tokenPct = Math.min(100, Math.round((status.tokensLeft / 60000) * 100))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <div style={card}>
          <span style={label}>Tokens Left</span>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xl)',
              fontWeight: 700,
              color: tokenPct > 20 ? 'var(--color-positive)' : 'var(--color-negative)',
              margin: 0,
            }}
          >
            {status.tokensLeft.toLocaleString()}
          </p>
        </div>
        <div style={card}>
          <span style={label}>Refill Rate / min</span>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xl)',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              margin: 0,
            }}
          >
            {status.refillRate}
          </p>
        </div>
        <div style={card}>
          <span style={label}>Full Refill In</span>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xl)',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              margin: 0,
            }}
          >
            {Math.round(status.refillIn / 60)}h
          </p>
        </div>
      </div>

      <div style={card}>
        <span style={label}>Token Estimates</span>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-body)',
          }}
        >
          <tbody>
            {[
              ['50 ASINs — stats only', status.estimates.scan50StatsOnly],
              ['50 ASINs — with history', status.estimates.scan50WithHistory],
              ['100 ASINs — stats only', status.estimates.scan100StatsOnly],
            ].map(([label, cost]) => (
              <tr key={String(label)} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: '8px 0', color: 'var(--color-text-muted)' }}>{label}</td>
                <td
                  style={{
                    padding: '8px 0',
                    textAlign: 'right',
                    fontFamily: 'var(--font-mono)',
                    color:
                      Number(cost) > status.tokensLeft
                        ? 'var(--color-negative)'
                        : 'var(--color-text-primary)',
                  }}
                >
                  {cost} tokens
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Deal Finder ───────────────────────────────────────────────────────────────

function DealFinderTab() {
  const [category, setCategory] = useState('Books')
  const [minDiscount, setMinDiscount] = useState(20)
  const [maxBsr, setMaxBsr] = useState(500000)
  const [limit, setLimit] = useState(50)
  const [save, setSave] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deals, setDeals] = useState<LiveDeal[]>([])
  const [error, setError] = useState<string | null>(null)

  async function runScan() {
    setLoading(true)
    setError(null)
    setDeals([])
    try {
      const r = await fetch('/api/keepa/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          domain: 6,
          minDiscountPct: minDiscount,
          maxBsr,
          limit,
          save,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Scan failed')
      setDeals(d.deals ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' as const, alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 140px' }}>
          <span style={label}>Category</span>
          <select style={select} value={category} onChange={(e) => setCategory(e.target.value)}>
            {CA_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: '1 1 100px' }}>
          <span style={label}>Min Discount %</span>
          <input
            style={input}
            type="number"
            value={minDiscount}
            min={5}
            max={90}
            onChange={(e) => setMinDiscount(Number(e.target.value))}
          />
        </div>
        <div style={{ flex: '1 1 120px' }}>
          <span style={label}>Max BSR</span>
          <input
            style={input}
            type="number"
            value={maxBsr}
            min={1000}
            onChange={(e) => setMaxBsr(Number(e.target.value))}
          />
        </div>
        <div style={{ flex: '1 1 80px' }}>
          <span style={label}>Limit</span>
          <input
            style={input}
            type="number"
            value={limit}
            min={10}
            max={100}
            onChange={(e) => setLimit(Number(e.target.value))}
          />
        </div>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-body)',
            color: 'var(--color-text-muted)',
            paddingBottom: 2,
            cursor: 'pointer',
          }}
        >
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
          Save to DB
        </label>
        <button style={btn(loading)} disabled={loading} onClick={runScan}>
          {loading ? 'Scanning…' : 'Scan'}
        </button>
      </div>

      {error && (
        <p
          style={{
            color: 'var(--color-negative)',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-body)',
            margin: 0,
          }}
        >
          {error}
        </p>
      )}

      {deals.length > 0 && (
        <div style={{ overflowX: 'auto' as const }}>
          <p
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
              margin: '0 0 8px',
            }}
          >
            {deals.length} deals found
          </p>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-body)',
            }}
          >
            <thead>
              <tr>
                {['ASIN', 'Title', 'Current', '90d Avg', 'Discount', 'BSR'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '6px 8px',
                      color: 'var(--color-text-disabled)',
                      fontSize: 'var(--text-nano)',
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      borderBottom: '1px solid var(--color-border)',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.asin} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td
                    style={{
                      padding: '8px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-accent-gold)',
                      fontSize: 'var(--text-sm)',
                    }}
                  >
                    {d.asin}
                  </td>
                  <td
                    style={{
                      padding: '8px',
                      color: 'var(--color-text-primary)',
                      maxWidth: 240,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap' as const,
                    }}
                  >
                    {d.title}
                  </td>
                  <td
                    style={{
                      padding: '8px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    {d.currentPriceCad != null ? `$${d.currentPriceCad.toFixed(2)}` : '—'}
                  </td>
                  <td
                    style={{
                      padding: '8px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {d.avg90dPriceCad != null ? `$${d.avg90dPriceCad.toFixed(2)}` : '—'}
                  </td>
                  <td
                    style={{
                      padding: '8px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-positive)',
                      fontWeight: 700,
                    }}
                  >
                    {d.discountPct != null ? `${d.discountPct.toFixed(1)}%` : '—'}
                  </td>
                  <td
                    style={{
                      padding: '8px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {d.bsr?.toLocaleString() ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Price Alerts ──────────────────────────────────────────────────────────────

function PriceAlertsTab() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkResult, setCheckResult] = useState<string | null>(null)

  const [asin, setAsin] = useState('')
  const [title, setTitle] = useState('')
  const [alertType, setAlertType] = useState<(typeof ALERT_TYPES)[number]>('price_below')
  const [threshold, setThreshold] = useState('')
  const [notes, setNotes] = useState('')
  const [adding, setAdding] = useState(false)

  const loadAlerts = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/keepa/alerts')
      setAlerts(await r.json())
    } catch {
      setError('Failed to load alerts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch('/api/keepa/alerts')
      .then((r) => r.json())
      .then((d: PriceAlert[]) => setAlerts(d))
      .catch(() => setError('Failed to load alerts'))
      .finally(() => setLoading(false))
  }, [])

  async function addAlert() {
    if (!asin.trim() || !threshold) return
    setAdding(true)
    setError(null)
    try {
      const r = await fetch('/api/keepa/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asin: asin.trim().toUpperCase(),
          title,
          alertType,
          threshold: Number(threshold),
          notes,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setAsin('')
      setTitle('')
      setThreshold('')
      setNotes('')
      await loadAlerts()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add failed')
    } finally {
      setAdding(false)
    }
  }

  async function deleteAlert(id: string) {
    await fetch(`/api/keepa/alerts?id=${id}`, { method: 'DELETE' })
    await loadAlerts()
  }

  async function checkAll() {
    setChecking(true)
    setCheckResult(null)
    try {
      const r = await fetch('/api/keepa/alerts/check', { method: 'POST' })
      const d = await r.json()
      setCheckResult(`Checked ${d.checked} alerts — ${d.triggered?.length ?? 0} triggered`)
      await loadAlerts()
    } catch {
      setError('Check failed')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Add form */}
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ ...label, marginBottom: 0 }}>New Alert</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
          <input
            style={{ ...input, flex: '1 1 120px' }}
            placeholder="ASIN"
            value={asin}
            onChange={(e) => setAsin(e.target.value)}
          />
          <input
            style={{ ...input, flex: '2 1 200px' }}
            placeholder="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <select
            style={{ ...select, flex: '1 1 130px' }}
            value={alertType}
            onChange={(e) => setAlertType(e.target.value as (typeof ALERT_TYPES)[number])}
          >
            {ALERT_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input
            style={{ ...input, flex: '1 1 90px' }}
            placeholder="Threshold"
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
          <input
            style={{ ...input, flex: '2 1 200px' }}
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button
            style={btn(adding || !asin.trim() || !threshold)}
            disabled={adding || !asin.trim() || !threshold}
            onClick={addAlert}
          >
            {adding ? 'Adding…' : 'Add Alert'}
          </button>
        </div>
        {error && (
          <p
            style={{
              color: 'var(--color-negative)',
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-sm)',
              margin: 0,
            }}
          >
            {error}
          </p>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button style={btn(checking)} disabled={checking} onClick={checkAll}>
          {checking ? 'Checking…' : 'Check All Prices'}
        </button>
        {checkResult && (
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-muted)',
            }}
          >
            {checkResult}
          </span>
        )}
      </div>

      {/* Alert list */}
      {loading ? (
        <p
          style={{
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-body)',
          }}
        >
          Loading…
        </p>
      ) : alerts.length === 0 ? (
        <p
          style={{
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-body)',
          }}
        >
          No alerts set.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {alerts.map((a) => (
            <div
              key={a.id}
              style={{
                ...card,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                borderLeft: a.triggered
                  ? '3px solid var(--color-positive)'
                  : '3px solid var(--color-border)',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--color-accent-gold)',
                    }}
                  >
                    {a.asin}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      background: 'var(--color-surface-2)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '2px 6px',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {a.alert_type}
                  </span>
                  {a.triggered && (
                    <span
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-nano)',
                        color: 'var(--color-positive)',
                        fontWeight: 700,
                      }}
                    >
                      TRIGGERED
                    </span>
                  )}
                </div>
                {a.title && (
                  <p
                    style={{
                      margin: '4px 0 0',
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {a.title}
                  </p>
                )}
                <p
                  style={{
                    margin: '4px 0 0',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  Threshold: {a.threshold}
                  {a.current_value != null && ` · Current: ${a.current_value}`}
                  {a.last_checked_at &&
                    ` · Checked: ${new Date(a.last_checked_at).toLocaleDateString()}`}
                </p>
              </div>
              <button style={btn(false, 'ghost')} onClick={() => deleteAlert(a.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Data Explorer ─────────────────────────────────────────────────────────────

function DataExplorerTab() {
  const [deals, setDeals] = useState<KeepaDeal[]>([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('')
  const [limit, setLimit] = useState(100)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(limit) })
      if (category) params.set('category', category)
      const r = await fetch(`/api/keepa/deals?${params}`)
      setDeals(await r.json())
    } finally {
      setLoading(false)
    }
  }, [category, limit])

  useEffect(() => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (category) params.set('category', category)
    fetch(`/api/keepa/deals?${params}`)
      .then((r) => r.json())
      .then((d: KeepaDeal[]) => setDeals(d))
      .finally(() => setLoading(false))
  }, [category, limit])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' as const }}>
        <div style={{ flex: '1 1 140px' }}>
          <span style={label}>Category Filter</span>
          <select style={select} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {CA_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: '0 0 80px' }}>
          <span style={label}>Limit</span>
          <input
            style={input}
            type="number"
            value={limit}
            min={10}
            max={500}
            onChange={(e) => setLimit(Number(e.target.value))}
          />
        </div>
        <button style={btn(loading)} disabled={loading} onClick={load}>
          Refresh
        </button>
      </div>

      {loading ? (
        <p
          style={{
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-body)',
          }}
        >
          Loading…
        </p>
      ) : deals.length === 0 ? (
        <p
          style={{
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-body)',
          }}
        >
          No saved deals. Run a scan in Deal Finder with &quot;Save to DB&quot; checked.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' as const }}>
          <p
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
              margin: '0 0 8px',
            }}
          >
            {deals.length} saved deals
          </p>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-body)',
            }}
          >
            <thead>
              <tr>
                {[
                  'Saved',
                  'ASIN',
                  'Title',
                  'Category',
                  'Current',
                  '90d Avg',
                  'Discount',
                  'BSR',
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '6px 8px',
                      color: 'var(--color-text-disabled)',
                      fontSize: 'var(--text-nano)',
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      borderBottom: '1px solid var(--color-border)',
                      whiteSpace: 'nowrap' as const,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td
                    style={{
                      padding: '8px',
                      color: 'var(--color-text-muted)',
                      whiteSpace: 'nowrap' as const,
                    }}
                  >
                    {new Date(d.saved_at).toLocaleDateString()}
                  </td>
                  <td
                    style={{
                      padding: '8px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-accent-gold)',
                      fontSize: 'var(--text-sm)',
                    }}
                  >
                    {d.asin}
                  </td>
                  <td
                    style={{
                      padding: '8px',
                      color: 'var(--color-text-primary)',
                      maxWidth: 200,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap' as const,
                    }}
                  >
                    {d.title}
                  </td>
                  <td style={{ padding: '8px', color: 'var(--color-text-muted)' }}>{d.category}</td>
                  <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>
                    {d.current_price_cad != null ? `$${d.current_price_cad.toFixed(2)}` : '—'}
                  </td>
                  <td
                    style={{
                      padding: '8px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {d.avg_90d_price_cad != null ? `$${d.avg_90d_price_cad.toFixed(2)}` : '—'}
                  </td>
                  <td
                    style={{
                      padding: '8px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-positive)',
                      fontWeight: 700,
                    }}
                  >
                    {d.discount_pct != null ? `${d.discount_pct.toFixed(1)}%` : '—'}
                  </td>
                  <td
                    style={{
                      padding: '8px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {d.bsr?.toLocaleString() ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function KeepaIntelClient() {
  const [tab, setTab] = useState<Tab>('Token Status')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '24px 28px' }}>
      <div>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-2xl)',
            fontWeight: 700,
            color: 'var(--color-text-primary)',
            margin: 0,
          }}
        >
          Keepa Intel
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-muted)',
            margin: '4px 0 0',
          }}
        >
          Deal finder · price alerts · token budget
        </p>
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--color-border)',
          paddingBottom: 0,
        }}
      >
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-sm)',
              fontWeight: tab === t ? 700 : 500,
              color: tab === t ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              background: 'none',
              border: 'none',
              borderBottom:
                tab === t ? '2px solid var(--color-accent-gold)' : '2px solid transparent',
              padding: '8px 16px',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'Token Status' && <TokenStatusTab />}
      {tab === 'Deal Finder' && <DealFinderTab />}
      {tab === 'Price Alerts' && <PriceAlertsTab />}
      {tab === 'Data Explorer' && <DataExplorerTab />}
    </div>
  )
}
