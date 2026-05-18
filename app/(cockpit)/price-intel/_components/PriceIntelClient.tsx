'use client'

import { useState, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { CA_CATEGORIES } from '@/lib/keepa/categories'

// Types inlined here (not imported from server lib) to avoid client-bundle Turbopack traversal (F11)
interface FoundProduct {
  asin: string
  title: string | null
  currentPrice: number | null
  avgPrice90d: number | null
  salesRank: number | null
  rating: number | null
  reviewCount: number | null
  discountPct: number | null
}

interface CategoryInfo {
  catId: number
  name: string
  parentId: number | null
  children: number[]
}

interface SellerInfo {
  sellerId: string
  name: string | null
  rating: number | null
  reviewCount: number | null
  country: string | null
  products: number | null
}

// ── Tab definitions ───────────────────────────────────────────────────────────

const TABS = ['Product Finder', 'Category Explorer', 'Seller Lookup'] as const
type Tab = (typeof TABS)[number]

// ── Token status bar ──────────────────────────────────────────────────────────

function TokenBar({
  tokensLeft,
  lastUpdated,
}: {
  tokensLeft: number | null
  lastUpdated: Date | null
}) {
  if (tokensLeft === null) return null
  const pct = Math.min(100, Math.round((tokensLeft / 60000) * 100))
  const color = pct > 20 ? 'text-green-500' : 'text-destructive'

  return (
    <div className="bg-muted/40 flex items-center gap-3 rounded-md px-3 py-2 text-xs">
      <span className="text-muted-foreground font-medium">Keepa tokens:</span>
      <span className={`font-mono font-bold ${color}`}>{tokensLeft.toLocaleString()}</span>
      <span className="text-muted-foreground">({pct}%)</span>
      {lastUpdated && (
        <span className="text-muted-foreground ml-auto">
          updated {lastUpdated.toLocaleTimeString()}
        </span>
      )}
    </div>
  )
}

// ── Product Finder tab ────────────────────────────────────────────────────────

const CA_CATEGORY_ENTRIES = Object.entries(CA_CATEGORIES)
const LIMIT_OPTIONS = [10, 20, 50] as const

function ProductFinderTab({ onTokensUpdate }: { onTokensUpdate: (n: number, d: Date) => void }) {
  const [categoryId, setCategoryId] = useState<string>('')
  const [minRank, setMinRank] = useState('')
  const [maxRank, setMaxRank] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [minRating, setMinRating] = useState('')
  const [minDiscount, setMinDiscount] = useState('')
  const [limit, setLimit] = useState<10 | 20 | 50>(20)
  const [loading, setLoading] = useState(false)
  const [products, setProducts] = useState<FoundProduct[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const overLimit = limit > 50

  async function runSearch() {
    setLoading(true)
    setError(null)
    setProducts([])
    try {
      const body: Record<string, unknown> = { limit }
      if (categoryId) body.categoryId = Number(categoryId)
      if (minRank) body.minRank = Number(minRank)
      if (maxRank) body.maxRank = Number(maxRank)
      if (minPrice) body.minPriceCad = Number(minPrice)
      if (maxPrice) body.maxPriceCad = Number(maxPrice)
      if (minRating) body.minRating = Number(minRating)
      if (minDiscount) body.minDiscount = Number(minDiscount)

      const res = await fetch('/api/price-intel/finder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as {
        products?: FoundProduct[]
        tokensLeft?: number | null
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? `Request failed: ${res.status}`)
      setProducts(data.products ?? [])
      if (data.tokensLeft != null) onTokensUpdate(data.tokensLeft, new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  async function copyAsin(asin: string) {
    await navigator.clipboard.writeText(asin)
    setCopied(asin)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <h2 className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
            Filters
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {/* Category */}
            <div className="col-span-2 sm:col-span-1">
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                Category
              </label>
              <select
                className="border-input bg-background text-foreground focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-1 text-sm focus-visible:ring-1 focus-visible:outline-none"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">All categories</option>
                {CA_CATEGORY_ENTRIES.map(([name, id]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            {/* Min Rank */}
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                Min Rank
              </label>
              <Input
                type="number"
                placeholder="e.g. 1"
                value={minRank}
                onChange={(e) => setMinRank(e.target.value)}
              />
            </div>

            {/* Max Rank */}
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                Max Rank
              </label>
              <Input
                type="number"
                placeholder="e.g. 100000"
                value={maxRank}
                onChange={(e) => setMaxRank(e.target.value)}
              />
            </div>

            {/* Min Price */}
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                Min Price (CAD)
              </label>
              <Input
                type="number"
                step="0.01"
                placeholder="e.g. 10.00"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
              />
            </div>

            {/* Max Price */}
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                Max Price (CAD)
              </label>
              <Input
                type="number"
                step="0.01"
                placeholder="e.g. 200.00"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
              />
            </div>

            {/* Min Rating */}
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                Min Rating (0–5)
              </label>
              <Input
                type="number"
                step="0.5"
                min="0"
                max="5"
                placeholder="e.g. 4.0"
                value={minRating}
                onChange={(e) => setMinRating(e.target.value)}
              />
            </div>

            {/* Min Discount */}
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                Min Discount %
              </label>
              <Input
                type="number"
                min="0"
                max="90"
                placeholder="e.g. 20"
                value={minDiscount}
                onChange={(e) => setMinDiscount(e.target.value)}
              />
            </div>

            {/* Limit */}
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                Results
              </label>
              <div className="flex gap-1">
                {LIMIT_OPTIONS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setLimit(n)}
                    className={`h-9 flex-1 rounded-md border text-sm font-medium transition-colors ${
                      limit === n
                        ? 'bg-foreground text-background border-transparent'
                        : 'border-input text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {overLimit && (
            <p className="text-muted-foreground text-xs">
              Requesting &gt;50 results costs extra Keepa tokens.
            </p>
          )}

          <Button onClick={runSearch} disabled={loading} className="w-full sm:w-auto">
            {loading ? 'Searching…' : 'Find Products'}
          </Button>

          {error && <p className="text-destructive text-sm">{error}</p>}
        </CardContent>
      </Card>

      {/* Results */}
      {products.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <h2 className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
              {products.length} products found — click ASIN to copy
            </h2>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    {[
                      'ASIN',
                      'Title',
                      'Current',
                      '90d Avg',
                      'Discount',
                      'Rank',
                      'Rating',
                      'Reviews',
                    ].map((h) => (
                      <th
                        key={h}
                        className="text-muted-foreground px-3 py-2 text-left text-xs font-semibold tracking-wide"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.asin} className="hover:bg-muted/40 border-b transition-colors">
                      <td className="px-3 py-2">
                        <button
                          onClick={() => copyAsin(p.asin)}
                          title="Click to copy"
                          className="font-mono text-xs text-amber-500 hover:underline"
                        >
                          {copied === p.asin ? 'Copied!' : p.asin}
                        </button>
                      </td>
                      <td
                        className="text-foreground max-w-[200px] truncate px-3 py-2 text-xs"
                        title={p.title ?? undefined}
                      >
                        {p.title ?? '—'}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {p.currentPrice != null ? `$${p.currentPrice.toFixed(2)}` : '—'}
                      </td>
                      <td className="text-muted-foreground px-3 py-2 font-mono text-xs">
                        {p.avgPrice90d != null ? `$${p.avgPrice90d.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {p.discountPct != null ? (
                          <Badge
                            className={`text-xs ${p.discountPct > 0 ? 'border-transparent bg-green-600 text-white' : 'bg-muted text-muted-foreground border-transparent'}`}
                          >
                            {p.discountPct > 0 ? `${p.discountPct}%` : `${p.discountPct}%`}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="text-muted-foreground px-3 py-2 font-mono text-xs">
                        {p.salesRank?.toLocaleString() ?? '—'}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {p.rating != null ? p.rating.toFixed(1) : '—'}
                      </td>
                      <td className="text-muted-foreground px-3 py-2 font-mono text-xs">
                        {p.reviewCount?.toLocaleString() ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && products.length === 0 && error === null && (
        <p className="text-muted-foreground text-sm">Set filters above and click Find Products.</p>
      )}
    </div>
  )
}

// ── Category Explorer tab ─────────────────────────────────────────────────────

function CategoryExplorerTab({ onTokensUpdate }: { onTokensUpdate: (n: number, d: Date) => void }) {
  const [categoryIdInput, setCategoryIdInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [category, setCategory] = useState<CategoryInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  const lookupCategory = useCallback(
    async (id: number) => {
      setLoading(true)
      setError(null)
      setCategory(null)
      try {
        const res = await fetch(`/api/price-intel/category?categoryId=${id}&domain=6`)
        const data = (await res.json()) as {
          category?: CategoryInfo | null
          tokensLeft?: number | null
          error?: string
        }
        if (!res.ok) throw new Error(data.error ?? `Request failed: ${res.status}`)
        setCategory(data.category ?? null)
        if (data.tokensLeft != null) onTokensUpdate(data.tokensLeft, new Date())
        if (!data.category) setError(`Category ID ${id} not found`)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Lookup failed')
      } finally {
        setLoading(false)
      }
    },
    [onTokensUpdate]
  )

  function handleLookup() {
    const id = Number(categoryIdInput)
    if (!id) return
    lookupCategory(id)
  }

  return (
    <div className="space-y-4">
      {/* Quick-select grid */}
      <Card>
        <CardHeader className="pb-3">
          <h2 className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
            Quick-select — Canadian categories
          </h2>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {CA_CATEGORY_ENTRIES.map(([name, id]) => (
              <Button
                key={id}
                variant="outline"
                size="sm"
                onClick={() => {
                  setCategoryIdInput(String(id))
                  lookupCategory(id)
                }}
                disabled={loading}
                className="text-xs"
              >
                {name}
                <span className="text-muted-foreground ml-1 font-mono">{id}</span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Manual lookup */}
      <Card>
        <CardHeader className="pb-3">
          <h2 className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
            Look up by ID
          </h2>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              type="number"
              placeholder="Category ID, e.g. 927726"
              value={categoryIdInput}
              onChange={(e) => setCategoryIdInput(e.target.value)}
              className="max-w-xs"
            />
            <Button
              onClick={handleLookup}
              disabled={loading || !categoryIdInput}
              className="shrink-0"
            >
              {loading ? 'Looking up…' : 'Look up'}
            </Button>
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}
        </CardContent>
      </Card>

      {/* Result */}
      {category && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-lg font-semibold">{category.name}</h2>
              <span className="text-muted-foreground font-mono text-xs">ID {category.catId}</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {category.parentId != null && (
              <div>
                <span className="text-muted-foreground mb-1 block text-xs font-medium">
                  Parent category
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCategoryIdInput(String(category.parentId))
                    lookupCategory(category.parentId!)
                  }}
                  disabled={loading}
                  className="font-mono text-xs"
                >
                  {category.parentId}
                </Button>
              </div>
            )}

            {category.children.length > 0 && (
              <div>
                <span className="text-muted-foreground mb-2 block text-xs font-medium">
                  {category.children.length} sub-categories — click to explore
                </span>
                <div className="flex flex-wrap gap-2">
                  {category.children.map((childId) => (
                    <Button
                      key={childId}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCategoryIdInput(String(childId))
                        lookupCategory(childId)
                      }}
                      disabled={loading}
                      className="font-mono text-xs"
                    >
                      {childId}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {category.children.length === 0 && category.parentId === null && (
              <p className="text-muted-foreground text-sm">Leaf category — no sub-categories.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ── Seller Lookup tab ─────────────────────────────────────────────────────────

function SellerLookupTab({ onTokensUpdate }: { onTokensUpdate: (n: number, d: Date) => void }) {
  const [sellerIdInput, setSellerIdInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [seller, setSeller] = useState<SellerInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleLookup() {
    const sid = sellerIdInput.trim().toUpperCase()
    if (!sid) return
    setLoading(true)
    setError(null)
    setSeller(null)
    try {
      const res = await fetch(
        `/api/price-intel/seller?sellerId=${encodeURIComponent(sid)}&domain=6`
      )
      const data = (await res.json()) as {
        seller?: SellerInfo | null
        tokensLeft?: number | null
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? `Request failed: ${res.status}`)
      setSeller(data.seller ?? null)
      if (data.tokensLeft != null) onTokensUpdate(data.tokensLeft, new Date())
      if (!data.seller) setError(`Seller ID "${sid}" not found on Amazon CA`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <h2 className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
            Look up seller
          </h2>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-medium">
              Seller ID
            </label>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. A2L77EE7U53NWQ"
                value={sellerIdInput}
                onChange={(e) => setSellerIdInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleLookup()
                }}
                className="max-w-xs font-mono"
              />
              <Button
                onClick={handleLookup}
                disabled={loading || !sellerIdInput.trim()}
                className="shrink-0"
              >
                {loading ? 'Looking up…' : 'Look up'}
              </Button>
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              Find the Seller ID on any Amazon listing under &quot;Sold by&quot;.
            </p>
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}
        </CardContent>
      </Card>

      {seller && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-baseline gap-2">
              <h2 className="text-lg font-semibold">{seller.name ?? seller.sellerId}</h2>
              {seller.name && (
                <span className="text-muted-foreground font-mono text-xs">{seller.sellerId}</span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground text-xs font-medium">Estimated Rating</dt>
                <dd className="font-mono text-sm font-semibold">
                  {seller.rating != null ? `${seller.rating}/50` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs font-medium">Reviews</dt>
                <dd className="font-mono text-sm font-semibold">
                  {seller.reviewCount?.toLocaleString() ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs font-medium">Country</dt>
                <dd className="text-sm font-semibold">{seller.country ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs font-medium">Listed Products</dt>
                <dd className="font-mono text-sm font-semibold">
                  {seller.products?.toLocaleString() ?? '—'}
                </dd>
              </div>
            </dl>
            <p className="text-muted-foreground mt-3 text-xs">
              Rating is Keepa&apos;s estimated seller feedback score (0–50 scale). &quot;Listed
              Products&quot; is the estimated storefront count.
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && !seller && !error && (
        <p className="text-muted-foreground text-sm">
          Enter a seller ID above to check their competition profile.
        </p>
      )}
    </div>
  )
}

// ── Root component ────────────────────────────────────────────────────────────

export function PriceIntelClient() {
  const [tab, setTab] = useState<Tab>('Product Finder')
  const [tokensLeft, setTokensLeft] = useState<number | null>(null)
  const [tokensUpdatedAt, setTokensUpdatedAt] = useState<Date | null>(null)

  const handleTokensUpdate = useCallback((n: number, d: Date) => {
    setTokensLeft(n)
    setTokensUpdatedAt(d)
  }, [])

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Price Intel</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Product finder · category explorer · seller lookup
        </p>
      </div>

      {/* Token status bar — shown once a tab makes its first request */}
      <TokenBar tokensLeft={tokensLeft} lastUpdated={tokensUpdatedAt} />

      {/* Tab bar */}
      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? 'border-foreground text-foreground'
                : 'text-muted-foreground hover:text-foreground border-transparent'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'Product Finder' && <ProductFinderTab onTokensUpdate={handleTokensUpdate} />}
      {tab === 'Category Explorer' && <CategoryExplorerTab onTokensUpdate={handleTokensUpdate} />}
      {tab === 'Seller Lookup' && <SellerLookupTab onTokensUpdate={handleTokensUpdate} />}
    </div>
  )
}
