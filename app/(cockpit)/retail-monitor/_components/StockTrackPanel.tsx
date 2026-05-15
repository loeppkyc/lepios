'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { STOCKTRACK_STORES } from '@/lib/retail/stocktrack-client'
import type { StockTrackProduct, StoreAvailability, PriceDrop, TrendingProduct } from '@/lib/retail/types'

const STORE_CODES = Object.keys(STOCKTRACK_STORES)
const PERIODS = ['today', 'yesterday', 'weekly'] as const

// ── Product Search tab ────────────────────────────────────────────────────────

function ProductSearchTab() {
  const [store, setStore] = useState(STORE_CODES[0])
  const [query, setQuery] = useState('')
  const [searchType, setSearchType] = useState<'search' | 'upc' | 'sku'>('search')
  const [products, setProducts] = useState<StockTrackProduct[]>([])
  const [availability, setAvailability] = useState<StoreAvailability[] | null>(null)
  const [availSku, setAvailSku] = useState('')
  const [loading, setLoading] = useState(false)
  const [availLoading, setAvailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    setProducts([])
    setAvailability(null)
    try {
      const res = await fetch(
        `/api/stocktrack/search?store=${store}&q=${encodeURIComponent(query)}&type=${searchType}`
      )
      const j = (await res.json()) as { products?: StockTrackProduct[]; error?: string }
      if (!res.ok) throw new Error(j.error ?? 'Search failed')
      setProducts(j.products ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  async function handleCheckStock(sku: string) {
    setAvailSku(sku)
    setAvailLoading(true)
    setAvailability(null)
    try {
      const res = await fetch(`/api/stocktrack/availability?store=${store}&sku=${encodeURIComponent(sku)}`)
      const j = (await res.json()) as { stores?: StoreAvailability[]; error?: string }
      if (!res.ok) throw new Error(j.error ?? 'Availability check failed')
      setAvailability(j.stores ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setAvailLoading(false)
    }
  }

  const inStockCount = availability?.filter((s) => s.quantity > 0).length ?? 0

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex flex-wrap gap-2">
        <div className="flex-1 min-w-40 space-y-1">
          <Label className="text-xs text-[var(--color-text-secondary)]">Query</Label>
          <Input
            placeholder="LEGO Technic, UPC, SKU…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="w-36 space-y-1">
          <Label className="text-xs text-[var(--color-text-secondary)]">Store</Label>
          <Select value={store} onValueChange={setStore}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STORE_CODES.map((c) => (
                <SelectItem key={c} value={c}>{STOCKTRACK_STORES[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-28 space-y-1">
          <Label className="text-xs text-[var(--color-text-secondary)]">Type</Label>
          <Select value={searchType} onValueChange={(v) => setSearchType(v as 'search' | 'upc' | 'sku')}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="search">Search</SelectItem>
              <SelectItem value="upc">UPC</SelectItem>
              <SelectItem value="sku">SKU</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button type="submit" size="sm" disabled={loading || !query.trim()}>
            {loading ? 'Searching…' : 'Search'}
          </Button>
        </div>
      </form>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {products.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-[var(--color-text-secondary)]">
                <th className="pb-1 pr-4">Product</th>
                <th className="pb-1 pr-4">SKU</th>
                <th className="pb-1 pr-4">Price</th>
                <th className="pb-1"></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="py-2 pr-4 text-[var(--color-text-primary)]">{p.name}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-[var(--color-text-secondary)]">{p.sku}</td>
                  <td className="py-2 pr-4 text-[var(--color-text-primary)]">
                    {p.price != null ? `$${p.price.toFixed(2)}` : '—'}
                  </td>
                  <td className="py-2">
                    {p.sku && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCheckStock(p.sku)}
                        disabled={availLoading && availSku === p.sku}
                        className="h-6 text-xs"
                      >
                        {availLoading && availSku === p.sku ? 'Checking…' : 'Check Stock'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {availability && (
        <div className="rounded-lg border border-border bg-[var(--color-cockpit-bg)] p-3">
          <p className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">
            Availability — SKU {availSku} · In stock at {inStockCount}/{availability.length} stores
          </p>
          {availability.length === 0 ? (
            <p className="text-xs text-[var(--color-text-secondary)]">No store data returned</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-[var(--color-text-secondary)]">
                    <th className="pb-1 pr-3">Store</th>
                    <th className="pb-1 pr-3">City</th>
                    <th className="pb-1 pr-3">Qty</th>
                    <th className="pb-1 pr-3">Price</th>
                    <th className="pb-1">Sale</th>
                  </tr>
                </thead>
                <tbody>
                  {availability.map((s, i) => (
                    <tr key={i} className={`border-b border-border/30 ${s.quantity > 0 ? '' : 'opacity-40'}`}>
                      <td className="py-1.5 pr-3 text-[var(--color-text-primary)]">{s.store_name}</td>
                      <td className="py-1.5 pr-3 text-[var(--color-text-secondary)]">{s.city ?? '—'}</td>
                      <td className="py-1.5 pr-3 font-medium text-[var(--color-text-primary)]">{s.quantity}</td>
                      <td className="py-1.5 pr-3 text-[var(--color-text-primary)]">
                        {s.price != null ? `$${s.price.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-1.5">
                        {s.on_sale && (
                          <span className="rounded bg-green-900/40 px-1 py-0.5 text-green-300">Sale</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Price Drops tab ───────────────────────────────────────────────────────────

function PriceDropsTab() {
  const [store, setStore] = useState(STORE_CODES[0])
  const [period, setPeriod] = useState<'today' | 'yesterday' | 'weekly'>('today')
  const [minPct, setMinPct] = useState('20')
  const [search, setSearch] = useState('')
  const [drops, setDrops] = useState<PriceDrop[]>([])
  const [cached, setCached] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFetch(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ store, period, min_pct: minPct })
      if (search) params.set('search', search)
      const res = await fetch(`/api/stocktrack/drops?${params.toString()}`)
      const j = (await res.json()) as { drops?: PriceDrop[]; cached?: boolean; error?: string }
      if (!res.ok) throw new Error(j.error ?? 'Fetch failed')
      setDrops(j.drops ?? [])
      setCached(j.cached ?? false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleFetch} className="flex flex-wrap gap-2">
        <div className="w-36 space-y-1">
          <Label className="text-xs text-[var(--color-text-secondary)]">Store</Label>
          <Select value={store} onValueChange={setStore}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STORE_CODES.map((c) => (
                <SelectItem key={c} value={c}>{STOCKTRACK_STORES[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-28 space-y-1">
          <Label className="text-xs text-[var(--color-text-secondary)]">Period</Label>
          <Select value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-24 space-y-1">
          <Label className="text-xs text-[var(--color-text-secondary)]">Min %</Label>
          <Input
            type="number"
            min="0"
            max="100"
            value={minPct}
            onChange={(e) => setMinPct(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="flex-1 min-w-32 space-y-1">
          <Label className="text-xs text-[var(--color-text-secondary)]">Filter</Label>
          <Input
            placeholder="LEGO, tool…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="flex items-end">
          <Button type="submit" size="sm" disabled={loading}>
            {loading ? 'Loading…' : 'Get Drops'}
          </Button>
        </div>
      </form>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {drops.length > 0 && (
        <>
          <p className="text-xs text-[var(--color-text-secondary)]">
            {drops.length} deal{drops.length !== 1 ? 's' : ''} · {cached ? 'cached' : 'live'}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-[var(--color-text-secondary)]">
                  <th className="pb-1 pr-4">Product</th>
                  <th className="pb-1 pr-4">Now</th>
                  <th className="pb-1 pr-4">Was</th>
                  <th className="pb-1 pr-4">Off</th>
                  <th className="pb-1">Category</th>
                </tr>
              </thead>
              <tbody>
                {drops.map((d, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-1.5 pr-4 text-[var(--color-text-primary)]">{d.product_name}</td>
                    <td className="py-1.5 pr-4 font-medium text-green-400">
                      {d.current_price != null ? `$${d.current_price.toFixed(2)}` : '—'}
                    </td>
                    <td className="py-1.5 pr-4 text-[var(--color-text-secondary)] line-through">
                      {d.regular_price != null ? `$${d.regular_price.toFixed(2)}` : '—'}
                    </td>
                    <td className="py-1.5 pr-4">
                      {d.discount_pct != null && (
                        <span className="rounded bg-green-900/40 px-1.5 py-0.5 text-xs font-medium text-green-300">
                          {d.discount_pct.toFixed(0)}%
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-xs text-[var(--color-text-secondary)]">{d.category ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!loading && drops.length === 0 && !error && (
        <p className="text-sm text-[var(--color-text-secondary)]">Select a store and period, then click Get Drops.</p>
      )}
    </div>
  )
}

// ── Trending tab ──────────────────────────────────────────────────────────────

function TrendingTab() {
  const [store, setStore] = useState(STORE_CODES[0])
  const [trending, setTrending] = useState<TrendingProduct[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFetch() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/stocktrack/trending?store=${store}`)
      const j = (await res.json()) as { trending?: TrendingProduct[]; error?: string }
      if (!res.ok) throw new Error(j.error ?? 'Fetch failed')
      setTrending(j.trending ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="w-36 space-y-1">
          <Label className="text-xs text-[var(--color-text-secondary)]">Store</Label>
          <Select value={store} onValueChange={setStore}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STORE_CODES.map((c) => (
                <SelectItem key={c} value={c}>{STOCKTRACK_STORES[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button size="sm" onClick={handleFetch} disabled={loading}>
            {loading ? 'Loading…' : 'Get Trending'}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {trending.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-[var(--color-text-secondary)]">
                <th className="pb-1 pr-4">Product</th>
                <th className="pb-1 pr-4">Price</th>
                <th className="pb-1 pr-4">Was</th>
                <th className="pb-1">In Stock</th>
              </tr>
            </thead>
            <tbody>
              {trending.map((t, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="py-1.5 pr-4 text-[var(--color-text-primary)]">{t.product_name}</td>
                  <td className="py-1.5 pr-4 text-[var(--color-text-primary)]">
                    {t.price != null ? `$${t.price.toFixed(2)}` : '—'}
                  </td>
                  <td className="py-1.5 pr-4 text-[var(--color-text-secondary)] line-through">
                    {t.regular_price != null ? `$${t.regular_price.toFixed(2)}` : '—'}
                  </td>
                  <td className="py-1.5 text-[var(--color-text-secondary)]">
                    {t.stores_in_stock}/{t.stores_total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && trending.length === 0 && !error && (
        <p className="text-sm text-[var(--color-text-secondary)]">Select a store and click Get Trending.</p>
      )}
    </div>
  )
}

// ── StockTrack panel ──────────────────────────────────────────────────────────

export function StockTrackPanel() {
  return (
    <Tabs defaultValue="search">
      <TabsList>
        <TabsTrigger value="search">Product Search</TabsTrigger>
        <TabsTrigger value="drops">Price Drops</TabsTrigger>
        <TabsTrigger value="trending">Trending</TabsTrigger>
      </TabsList>
      <TabsContent value="search" className="mt-4">
        <ProductSearchTab />
      </TabsContent>
      <TabsContent value="drops" className="mt-4">
        <PriceDropsTab />
      </TabsContent>
      <TabsContent value="trending" className="mt-4">
        <TrendingTab />
      </TabsContent>
    </Tabs>
  )
}
