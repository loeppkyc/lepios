'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

interface ScanResult {
  id: string
  store_code: string
  store_label: string
  product_name: string
  sku: string | null
  current_price: number | null
  regular_price: number | null
  discount_pct: number | null
  in_stock: boolean
  scanned_at: string
}

interface ResultsResponse {
  results: ScanResult[]
  total: number
  stores_present: string[]
  latest_scan_at: string | null
}

const DAYS_OPTIONS = [
  { value: '1', label: 'Today' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
]

const DISCOUNT_STEPS = [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80]

function formatPrice(n: number | null): string {
  if (n == null) return '—'
  return `$${n.toFixed(2)}`
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function ScanResultsTab() {
  const [results, setResults] = useState<ScanResult[]>([])
  const [storesPresent, setStoresPresent] = useState<string[]>([])
  const [latestScanAt, setLatestScanAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [selectedStore, setSelectedStore] = useState('all')
  const [minDiscount, setMinDiscount] = useState(0)
  const [days, setDays] = useState('7')

  // Per-row UI state
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set())
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set())
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set())
  const [addErrors, setAddErrors] = useState<Record<string, string>>({})

  const fetchResults = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ days })
      if (selectedStore !== 'all') params.set('store', selectedStore)
      const res = await fetch(`/api/stocktrack/results?${params}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError((body as { error?: string }).error ?? `Error ${res.status}`)
        return
      }
      const data: ResultsResponse = await res.json()
      setResults(data.results)
      setStoresPresent(data.stores_present)
      setLatestScanAt(data.latest_scan_at)
    } catch {
      setError('Network error — could not load scan results')
    } finally {
      setLoading(false)
    }
  }, [days, selectedStore])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchResults()
  }, [fetchResults])

  async function handleAddToWatchlist(result: ScanResult) {
    setAddingIds((prev) => new Set(prev).add(result.id))
    setAddErrors((prev) => {
      const n = { ...prev }
      delete n[result.id]
      return n
    })
    try {
      const res = await fetch('/api/retail/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: result.product_name,
          store: result.store_label,
          buy_price: result.current_price ?? undefined,
          regular_price: result.regular_price ?? undefined,
          pct_off: result.discount_pct ?? undefined,
          status: 'watching',
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setAddErrors((prev) => ({
          ...prev,
          [result.id]: (body as { error?: string }).error ?? 'Failed to add',
        }))
        return
      }
      setWatchedIds((prev) => new Set(prev).add(result.id))
    } catch {
      setAddErrors((prev) => ({ ...prev, [result.id]: 'Network error' }))
    } finally {
      setAddingIds((prev) => {
        const n = new Set(prev)
        n.delete(result.id)
        return n
      })
    }
  }

  async function handleSkip(result: ScanResult) {
    setSkippedIds((prev) => new Set(prev).add(result.id))
    // F18 observability — fire-and-forget, non-blocking
    fetch('/api/stocktrack/results/skip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_name: result.product_name,
        store_code: result.store_code,
        discount_pct: result.discount_pct,
      }),
    }).catch(() => {})
  }

  // Client-side min_discount filter (acceptable for <=200 rows per acceptance doc)
  const visible = results.filter(
    (r) => !skippedIds.has(r.id) && (minDiscount === 0 || (r.discount_pct ?? 0) >= minDiscount)
  )

  const scanFreshnessLabel =
    latestScanAt && storesPresent.length > 0
      ? `Last scan: ${timeAgo(latestScanAt)} — ${results.length} deals from ${storesPresent.join(', ').toUpperCase()}`
      : null

  return (
    <div className="flex flex-col gap-4 pt-2">
      {/* Filter row */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
            Store
          </span>
          <Select value={selectedStore} onValueChange={setSelectedStore}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All stores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stores</SelectItem>
              {storesPresent.map((code) => (
                <SelectItem key={code} value={code}>
                  {code.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
            Min discount: {minDiscount}%
          </span>
          <input
            type="range"
            min={0}
            max={80}
            step={5}
            value={minDiscount}
            onChange={(e) => setMinDiscount(Number(e.target.value))}
            className="w-36 accent-[var(--color-accent-gold)]"
            list="discount-steps"
          />
          <datalist id="discount-steps">
            {DISCOUNT_STEPS.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
            Period
          </span>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAYS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {scanFreshnessLabel && (
          <span className="text-muted-foreground ml-auto pb-1.5 text-xs">{scanFreshnessLabel}</span>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-md border border-[var(--color-critical)] bg-[var(--color-critical-dim)] px-4 py-3 text-sm text-[var(--color-critical)]">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && <p className="text-muted-foreground text-sm">Loading scan results…</p>}

      {/* Empty state */}
      {!loading && !error && visible.length === 0 && (
        <p className="text-muted-foreground text-sm">
          {results.length === 0
            ? 'No scan results in the last 7 days — run a StockTrack scan from the Retail Monitor page'
            : 'No results match the current filters'}
        </p>
      )}

      {/* Results table */}
      {!loading && !error && visible.length > 0 && (
        <div className="w-full overflow-x-auto rounded-lg border border-[var(--color-border-accent)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                <th className="text-muted-foreground px-3 py-2 text-left text-xs font-semibold tracking-widest uppercase">
                  Product
                </th>
                <th className="text-muted-foreground px-3 py-2 text-left text-xs font-semibold tracking-widest uppercase">
                  Store
                </th>
                <th className="text-muted-foreground px-3 py-2 text-right text-xs font-semibold tracking-widest uppercase">
                  Price
                </th>
                <th className="text-muted-foreground px-3 py-2 text-right text-xs font-semibold tracking-widest uppercase">
                  Was
                </th>
                <th className="text-muted-foreground px-3 py-2 text-right text-xs font-semibold tracking-widest uppercase">
                  Discount
                </th>
                <th className="text-muted-foreground px-3 py-2 text-center text-xs font-semibold tracking-widest uppercase">
                  In Stock
                </th>
                <th className="text-muted-foreground px-3 py-2 text-right text-xs font-semibold tracking-widest uppercase">
                  Scanned
                </th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const isWatched = watchedIds.has(row.id)
                const isAdding = addingIds.has(row.id)
                const addErr = addErrors[row.id]

                return (
                  <tr
                    key={row.id}
                    className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]/50"
                  >
                    <td
                      className="text-foreground max-w-xs truncate px-3 py-2 font-medium"
                      title={row.product_name}
                    >
                      {row.product_name}
                    </td>
                    <td className="text-muted-foreground px-3 py-2 whitespace-nowrap">
                      {row.store_label}
                    </td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                      {formatPrice(row.current_price)}
                    </td>
                    <td className="text-muted-foreground px-3 py-2 text-right font-mono whitespace-nowrap">
                      {formatPrice(row.regular_price)}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {row.discount_pct != null ? (
                        <Badge
                          variant="outline"
                          className={
                            row.discount_pct >= 40
                              ? 'border-transparent bg-green-900/40 text-green-300'
                              : row.discount_pct >= 20
                                ? 'border-transparent bg-amber-900/40 text-amber-300'
                                : 'border-transparent bg-zinc-800 text-zinc-400'
                          }
                        >
                          {Math.round(row.discount_pct)}% off
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      {row.in_stock ? (
                        <span className="text-xs font-semibold text-green-400">Yes</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">No</span>
                      )}
                    </td>
                    <td className="text-muted-foreground px-3 py-2 text-right text-xs whitespace-nowrap">
                      {timeAgo(row.scanned_at)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        {addErr && (
                          <span className="text-xs text-[var(--color-critical)]">{addErr}</span>
                        )}
                        <button
                          onClick={() => handleAddToWatchlist(row)}
                          disabled={isWatched || isAdding}
                          className={
                            isWatched
                              ? 'cursor-default rounded bg-green-900/20 px-2 py-1 text-xs font-semibold text-green-400'
                              : isAdding
                                ? 'text-muted-foreground cursor-wait rounded bg-[var(--color-surface-2)] px-2 py-1 text-xs font-semibold'
                                : 'cursor-pointer rounded bg-[var(--color-accent-gold)] px-2 py-1 text-xs font-semibold text-[var(--color-base)] hover:opacity-90'
                          }
                        >
                          {isWatched ? 'In Watchlist' : isAdding ? 'Adding…' : '+ Watch'}
                        </button>
                        <button
                          onClick={() => handleSkip(row)}
                          className="text-muted-foreground hover:text-foreground cursor-pointer rounded px-2 py-1 text-xs font-semibold hover:bg-[var(--color-surface-2)]"
                        >
                          Skip
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
