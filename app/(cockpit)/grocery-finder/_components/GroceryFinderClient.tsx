'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { GroceryProductRow } from '@/lib/diet/types'
import { GROCERY_STORES, GROCERY_STORE_LABELS } from '@/lib/diet/types'
import { triggerFlippSync } from '../actions'
import type { FlippSyncResult } from '@/lib/scraper/flipp-sync'

const PRICE = (v: number | null) => (v != null ? `$${v.toFixed(2)}` : '—')
const DATE = (v: string | null) => {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

export function GroceryFinderClient({
  initialProducts,
  priceHistory = {},
}: {
  initialProducts: GroceryProductRow[]
  priceHistory?: Record<string, Array<{ price: number; recorded_at: string }>>
}) {
  const [store, setStore] = useState<string>('All')
  const [search, setSearch] = useState('')
  const [flyerOnly, setFlyerOnly] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [syncResult, setSyncResult] = useState<FlippSyncResult | null>(null)
  const [syncError, setSyncError] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSync() {
    setSyncError(false)
    startTransition(async () => {
      try {
        const result = await triggerFlippSync()
        setSyncResult(result)
        router.refresh()
      } catch {
        setSyncError(true)
      }
    })
  }

  const filtered = useMemo(() => {
    return initialProducts.filter((p) => {
      if (flyerOnly && !p.in_flyer) return false
      if (store !== 'All' && p.store !== store) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          p.name.toLowerCase().includes(q) ||
          (p.food_catalog?.brand ?? '').toLowerCase().includes(q) ||
          (p.food_catalog?.name ?? '').toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [initialProducts, store, search, flyerOnly])

  // Compute best-price product IDs across stores (per food_catalog_id, 2+ rows required)
  const bestPriceIds = useMemo(() => {
    const groups: Record<string, GroceryProductRow[]> = {}
    for (const p of initialProducts) {
      if (!p.food_catalog_id) continue
      if (!groups[p.food_catalog_id]) groups[p.food_catalog_id] = []
      groups[p.food_catalog_id].push(p)
    }
    const result = new Set<string>()
    for (const rows of Object.values(groups)) {
      if (rows.length < 2) continue
      const minPrice = Math.min(
        ...rows.map((r) => (r.sale_price != null ? r.sale_price : (r.regular_price ?? Infinity)))
      )
      for (const r of rows) {
        const effective = r.sale_price != null ? r.sale_price : (r.regular_price ?? null)
        if (effective === minPrice) result.add(r.id)
      }
    }
    return result
  }, [initialProducts])

  const inputStyle = {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    background: 'var(--color-surface-2)',
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '6px 10px',
  }

  const thStyle = {
    fontFamily: 'var(--font-ui)',
    fontSize: '0.65rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: 'var(--color-text-muted)',
    padding: '8px 10px',
    textAlign: 'left' as const,
    whiteSpace: 'nowrap' as const,
    borderBottom: '1px solid var(--color-border)',
  }

  const tdStyle = {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    color: 'var(--color-text-primary)',
    padding: '8px 10px',
    borderBottom: '1px solid var(--color-border)',
    whiteSpace: 'nowrap' as const,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters + actions */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="search"
          placeholder="Search product or brand…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, width: 220 }}
        />
        <select value={store} onChange={(e) => setStore(e.target.value)} style={inputStyle}>
          <option value="All">All stores</option>
          {GROCERY_STORES.map((s) => (
            <option key={s} value={s}>
              {GROCERY_STORE_LABELS[s]}
            </option>
          ))}
        </select>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
          }}
        >
          <input
            type="checkbox"
            checked={flyerOnly}
            onChange={(e) => setFlyerOnly(e.target.checked)}
            style={{ accentColor: 'var(--color-pillar-money)', cursor: 'pointer' }}
          />
          Flyer deals only
        </label>
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
          }}
        >
          {filtered.length} listing{filtered.length !== 1 ? 's' : ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={handleSync}
            disabled={isPending}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              fontWeight: 600,
              padding: '6px 14px',
              background: isPending ? 'var(--color-surface-2)' : 'transparent',
              color: isPending ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              cursor: isPending ? 'default' : 'pointer',
              opacity: isPending ? 0.6 : 1,
            }}
          >
            {isPending ? 'Syncing...' : 'Sync Flyer Deals'}
          </button>
          <button
            onClick={() => setAddOpen(true)}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              fontWeight: 600,
              padding: '6px 14px',
              background: 'var(--color-pillar-money)',
              color: '#000',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            + Add Product
          </button>
        </div>
      </div>

      {/* Sync result / error feedback */}
      {syncError && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '0.7rem',
            color: 'var(--color-text-muted)',
          }}
        >
          Sync failed — check console for details
        </div>
      )}
      {syncResult && !syncError && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '0.7rem',
            color: 'var(--color-text-muted)',
          }}
        >
          Sync complete: {syncResult.products_upserted} products updated, {syncResult.not_found}/
          {syncResult.staples_checked} staples not in Edmonton flyers
        </div>
      )}

      {/* Store coverage summary */}
      {initialProducts.length > 0 && <StoreSummary products={initialProducts} />}

      {/* Product table */}
      {initialProducts.length === 0 ? (
        <EmptyState />
      ) : filtered.length === 0 ? (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            padding: '24px 0',
            textAlign: 'center',
          }}
        >
          No products match your filters
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', borderSpacing: 0 }}>
            <thead>
              <tr>
                <th style={thStyle}>Product</th>
                <th style={thStyle}>Store</th>
                <th style={thStyle}>Size</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Reg Price</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Sale Price</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>$/100g</th>
                <th style={thStyle}>Last Checked</th>
                <th style={thStyle}>Flyer</th>
                <th style={thStyle}>Best</th>
                <th style={thStyle}>Trend</th>
                <th style={thStyle}>Link</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td style={tdStyle}>
                    <div>
                      <div>{p.name}</div>
                      {p.food_catalog?.brand && (
                        <div
                          style={{
                            fontSize: '0.7rem',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          {p.food_catalog.brand}
                        </div>
                      )}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--color-text-muted)' }}>
                    {GROCERY_STORE_LABELS[p.store] ?? p.store}
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--color-text-muted)' }}>
                    {p.unit_size ?? '—'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{PRICE(p.regular_price)}</td>
                  <td
                    style={{
                      ...tdStyle,
                      textAlign: 'right',
                      color: p.sale_price ? 'var(--color-pillar-money)' : 'var(--color-text-muted)',
                      fontWeight: p.sale_price ? 600 : 400,
                    }}
                  >
                    {PRICE(p.sale_price)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--color-text-muted)' }}>
                    {p.price_per_100g != null ? `$${p.price_per_100g.toFixed(3)}` : '—'}
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--color-text-muted)' }}>
                    {DATE(p.last_scraped_at)}
                  </td>
                  <td style={tdStyle}>
                    {p.in_flyer ? (
                      <span
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          color: 'var(--color-pillar-money)',
                          letterSpacing: '0.06em',
                        }}
                      >
                        FLYER
                      </span>
                    ) : (
                      <span style={{ color: 'var(--color-text-disabled)' }}>—</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {bestPriceIds.has(p.id) ? (
                      <span
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          color: 'var(--color-accent-gold)',
                          letterSpacing: '0.06em',
                        }}
                      >
                        BEST
                      </span>
                    ) : (
                      <span style={{ color: 'var(--color-text-disabled)' }}>—</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <Sparkline data={priceHistory[p.id] ?? []} />
                  </td>
                  <td style={tdStyle}>
                    {p.store_url ? (
                      <a
                        href={p.store_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontFamily: 'var(--font-ui)',
                          fontSize: 'var(--text-small)',
                          color: 'var(--color-accent-gold)',
                          textDecoration: 'none',
                        }}
                      >
                        View →
                      </a>
                    ) : (
                      <span style={{ color: 'var(--color-text-disabled)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Product modal stub */}
      {addOpen && <AddProductModal onClose={() => setAddOpen(false)} />}
    </div>
  )
}

function StoreSummary({ products }: { products: GroceryProductRow[] }) {
  const byStore = GROCERY_STORES.reduce(
    (acc, s) => {
      acc[s] = products.filter((p) => p.store === s).length
      return acc
    },
    {} as Record<string, number>
  )

  const active = Object.entries(byStore).filter(([, count]) => count > 0)
  if (active.length === 0) return null

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {active.map(([s, count]) => (
        <div
          key={s}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '0.7rem',
            padding: '3px 8px',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-muted)',
          }}
        >
          {GROCERY_STORE_LABELS[s as keyof typeof GROCERY_STORE_LABELS]} · {count}
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div
      style={{
        padding: '48px 24px',
        textAlign: 'center',
        border: '1px dashed var(--color-border)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-muted)',
          marginBottom: 8,
        }}
      >
        No store listings yet
      </div>
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: '0.7rem',
          color: 'var(--color-text-disabled)',
        }}
      >
        Add products manually, or wait for the Edmonton scraper to run
      </div>
    </div>
  )
}

function Sparkline({ data }: { data: Array<{ price: number }> }) {
  if (data.length < 2) return <span style={{ color: 'var(--color-text-disabled)' }}>—</span>
  const W = 60,
    H = 20,
    pad = 2
  const prices = data.map((d) => d.price)
  const min = Math.min(...prices),
    max = Math.max(...prices)
  const range = max - min || 1
  const pts = prices
    .map((p, i) => {
      const x = pad + (i / (prices.length - 1)) * (W - pad * 2)
      const y = pad + ((max - p) / range) * (H - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke="var(--color-accent-gold)" strokeWidth="1.5" />
    </svg>
  )
}

function AddProductModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 24,
          minWidth: 340,
          maxWidth: 480,
          width: '100%',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-heading)',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            marginBottom: 16,
          }}
        >
          Add Store Product
        </div>
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            marginBottom: 24,
          }}
        >
          Manual entry is available now. The Edmonton scraper (Superstore, Save-On, Walmart) will
          auto-populate prices when built.
        </div>
        <button
          onClick={onClose}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            fontWeight: 600,
            padding: '6px 16px',
            background: 'none',
            color: 'var(--color-text-muted)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>
    </div>
  )
}
