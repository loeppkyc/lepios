'use client'

import { useState, useRef } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FlippItem {
  name: string
  description: string
  price: number | string
  prePrice: string
  store: string
  brand: string
  validFrom: string
  validTo: string
  imageUrl: string
  category: string
  savings: string
}

interface VisionDeal {
  name: string
  price: string
  prePrice: string
  savings: string
  store: string
  details: string
}

// ── Shared styles ─────────────────────────────────────────────────────────────

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

const input: React.CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-body)',
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text-primary)',
  padding: '8px 12px',
  width: '100%',
}

const btn = (disabled: boolean): React.CSSProperties => ({
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-body)',
  fontWeight: 600,
  padding: '8px 20px',
  background: disabled ? 'var(--color-surface-2)' : 'var(--color-accent-gold)',
  color: disabled ? 'var(--color-text-disabled)' : 'var(--color-base)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  flexShrink: 0,
})

const card: React.CSSProperties = {
  background: 'var(--color-surface-1)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  padding: '14px 16px',
}

const TABS = ['Search Flyers', 'Vision Extract'] as const
type Tab = (typeof TABS)[number]

// ── Search tab ────────────────────────────────────────────────────────────────

function SearchTab() {
  const [query, setQuery] = useState('')
  const [postal, setPostal] = useState('T6H')
  const [limit, setLimit] = useState(30)
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<FlippItem[]>([])
  const [error, setError] = useState<string | null>(null)

  async function search() {
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    setItems([])
    try {
      const params = new URLSearchParams({ q: query.trim(), postal, limit: String(limit) })
      const r = await fetch(`/api/flyer-intel/search?${params}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Search failed')
      setItems(d.items ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const, alignItems: 'flex-end' }}>
        <div style={{ flex: '3 1 200px' }}>
          <span style={label}>Search query</span>
          <input
            style={input}
            placeholder="cerave, protein powder, vitamin D…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
          />
        </div>
        <div style={{ flex: '1 1 90px' }}>
          <span style={label}>Postal prefix</span>
          <input
            style={input}
            value={postal}
            onChange={(e) => setPostal(e.target.value)}
            maxLength={6}
          />
        </div>
        <div style={{ flex: '0 0 70px' }}>
          <span style={label}>Limit</span>
          <input
            style={input}
            type="number"
            value={limit}
            min={5}
            max={100}
            onChange={(e) => setLimit(Number(e.target.value))}
          />
        </div>
        <button
          style={btn(loading || !query.trim())}
          disabled={loading || !query.trim()}
          onClick={search}
        >
          {loading ? 'Searching…' : 'Search'}
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

      {items.length > 0 && (
        <>
          <p
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
              margin: 0,
            }}
          >
            {items.length} results
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((item, i) => (
              <div key={i} style={{ ...card, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                {item.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    style={{
                      width: 64,
                      height: 64,
                      objectFit: 'contain',
                      borderRadius: 'var(--radius-sm)',
                      flexShrink: 0,
                    }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 8,
                    }}
                  >
                    <p
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-body)',
                        fontWeight: 600,
                        color: 'var(--color-text-primary)',
                        margin: 0,
                      }}
                    >
                      {item.name}
                    </p>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <p
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-lg)',
                          fontWeight: 700,
                          color: 'var(--color-accent-gold)',
                          margin: 0,
                        }}
                      >
                        {typeof item.price === 'number'
                          ? `$${item.price.toFixed(2)}`
                          : item.price || '—'}
                      </p>
                      {item.prePrice && (
                        <p
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 'var(--text-sm)',
                            color: 'var(--color-text-muted)',
                            margin: '2px 0 0',
                            textDecoration: 'line-through',
                          }}
                        >
                          {item.prePrice}
                        </p>
                      )}
                    </div>
                  </div>
                  <div
                    style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' as const }}
                  >
                    {item.store && (
                      <span
                        style={{
                          fontFamily: 'var(--font-ui)',
                          fontSize: 'var(--text-sm)',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        {item.store}
                      </span>
                    )}
                    {item.savings && (
                      <span
                        style={{
                          fontFamily: 'var(--font-ui)',
                          fontSize: 'var(--text-sm)',
                          color: 'var(--color-positive)',
                          fontWeight: 600,
                        }}
                      >
                        {item.savings}
                      </span>
                    )}
                    {item.validTo && (
                      <span
                        style={{
                          fontFamily: 'var(--font-ui)',
                          fontSize: 'var(--text-nano)',
                          color: 'var(--color-text-disabled)',
                        }}
                      >
                        valid to {new Date(item.validTo).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  {item.description && (
                    <p
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-sm)',
                        color: 'var(--color-text-muted)',
                        margin: '4px 0 0',
                      }}
                    >
                      {item.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Vision tab ────────────────────────────────────────────────────────────────

function VisionTab() {
  const [loading, setLoading] = useState(false)
  const [deals, setDeals] = useState<VisionDeal[]>([])
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [hasFile, setHasFile] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setHasFile(true)
    setPreview(URL.createObjectURL(file))
    setDeals([])
    setError(null)
  }

  async function extract() {
    const file = fileRef.current?.files?.[0]
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('image', file)
      const r = await fetch('/api/flyer-intel/vision', { method: 'POST', body: form })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Extraction failed')
      setDeals(d.deals ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Extraction failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-muted)',
          margin: 0,
        }}
      >
        Upload a flyer image — Claude Vision extracts all deals automatically (claude-haiku-4-5, 20%
        cheaper than Streamlit).
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <span style={label}>Flyer image</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onFileChange}
            style={{ ...input, cursor: 'pointer' }}
          />
        </div>
        <button style={btn(loading || !hasFile)} disabled={loading} onClick={extract}>
          {loading ? 'Extracting…' : 'Extract Deals'}
        </button>
      </div>

      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="Flyer preview"
          style={{
            maxHeight: 300,
            objectFit: 'contain',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            alignSelf: 'flex-start',
          }}
        />
      )}

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
        <>
          <p
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
              margin: 0,
            }}
          >
            {deals.length} deals extracted
          </p>
          <div style={{ overflowX: 'auto' as const }}>
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
                  {['Item', 'Sale Price', 'Reg Price', 'Savings', 'Store', 'Details'].map((h) => (
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
                {deals.map((d, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td
                      style={{
                        padding: '8px',
                        color: 'var(--color-text-primary)',
                        fontWeight: 500,
                      }}
                    >
                      {d.name}
                    </td>
                    <td
                      style={{
                        padding: '8px',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--color-accent-gold)',
                        fontWeight: 700,
                      }}
                    >
                      {d.price || '—'}
                    </td>
                    <td
                      style={{
                        padding: '8px',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--color-text-muted)',
                        textDecoration: d.prePrice ? 'line-through' : 'none',
                      }}
                    >
                      {d.prePrice || '—'}
                    </td>
                    <td
                      style={{
                        padding: '8px',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--color-positive)',
                      }}
                    >
                      {d.savings || '—'}
                    </td>
                    <td style={{ padding: '8px', color: 'var(--color-text-muted)' }}>
                      {d.store || '—'}
                    </td>
                    <td
                      style={{
                        padding: '8px',
                        color: 'var(--color-text-muted)',
                        fontSize: 'var(--text-sm)',
                      }}
                    >
                      {d.details || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function FlyerIntelClient() {
  const [tab, setTab] = useState<Tab>('Search Flyers')

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
          Flyer Intel
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-muted)',
            margin: '4px 0 0',
          }}
        >
          Canadian flyer search · vision deal extraction
        </p>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--color-border)' }}>
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

      {tab === 'Search Flyers' && <SearchTab />}
      {tab === 'Vision Extract' && <VisionTab />}
    </div>
  )
}
