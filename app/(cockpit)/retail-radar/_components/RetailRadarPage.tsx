'use client'

import { useEffect, useState, useCallback } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import type { RetailWatchlistItem, RetailWatchlistStatus } from '@/lib/retail/types'
import { STATUS_LABELS, STATUS_COLORS } from '@/lib/retail/types'

function roi(item: RetailWatchlistItem) {
  return item.roi_pct ?? 0
}

function DealRow({ item }: { item: RetailWatchlistItem }) {
  const isGood = roi(item) >= 30
  return (
    <div className="border-border flex flex-wrap items-center gap-3 rounded-lg border bg-[var(--color-cockpit-surface)] p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-[var(--color-text-primary)]">{item.product}</span>
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_COLORS[item.status]}`}>
            {STATUS_LABELS[item.status]}
          </span>
          {isGood && (
            <span className="rounded bg-green-900/60 px-1.5 py-0.5 text-xs font-medium text-green-300">
              DEAL
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
          {item.store}
          {item.category && ` · ${item.category}`}
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        {item.buy_price != null && (
          <span className="text-[var(--color-text-secondary)]">
            Buy <strong className="text-[var(--color-text-primary)]">${item.buy_price.toFixed(2)}</strong>
          </span>
        )}
        {item.amazon_price != null && (
          <span className="text-[var(--color-text-secondary)]">
            Sell <strong className="text-[var(--color-text-primary)]">${item.amazon_price.toFixed(2)}</strong>
          </span>
        )}
        {item.est_profit != null && (
          <span className={item.est_profit >= 0 ? 'text-green-400' : 'text-red-400'}>
            <strong>${item.est_profit.toFixed(2)}</strong>
          </span>
        )}
        {item.roi_pct != null && (
          <span className={isGood ? 'text-green-400 font-semibold' : 'text-[var(--color-text-secondary)]'}>
            {item.roi_pct.toFixed(1)}% ROI
          </span>
        )}
      </div>
    </div>
  )
}

export function RetailRadarPage() {
  const [items, setItems] = useState<RetailWatchlistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<RetailWatchlistStatus | 'all'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/retail/watchlist')
      if (!res.ok) throw new Error('Failed to load')
      const data = (await res.json()) as { items: RetailWatchlistItem[] }
      setItems(data.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = items
    .filter((i) => statusFilter === 'all' || i.status === statusFilter)
    .sort((a, b) => roi(b) - roi(a))

  const deals = items.filter((i) => i.roi_pct != null && i.roi_pct >= 30)
  const totalPotentialProfit = deals.reduce((s, i) => s + (i.est_profit ?? 0), 0)
  const avgRoi = deals.length > 0
    ? deals.reduce((s, i) => s + (i.roi_pct ?? 0), 0) / deals.length
    : 0

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Retail Radar</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Deal signals across your watchlist — sorted by ROI
        </p>
      </div>

      {items.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {[
            { label: 'Total Tracked', value: items.length, fmt: (v: number) => String(v) },
            { label: 'Good Deals (≥30% ROI)', value: deals.length, fmt: (v: number) => String(v), highlight: deals.length > 0 },
            { label: 'Potential Profit', value: totalPotentialProfit, fmt: (v: number) => `$${v.toFixed(2)}`, highlight: totalPotentialProfit > 0 },
            { label: 'Avg ROI (deals)', value: avgRoi, fmt: (v: number) => `${v.toFixed(1)}%` },
          ].map(({ label, value, fmt, highlight }) => (
            <div key={label} className="border-border rounded-lg border bg-[var(--color-cockpit-surface)] px-4 py-2">
              <div className={`text-lg font-bold ${highlight ? 'text-green-400' : 'text-[var(--color-text-primary)]'}`}>
                {fmt(value)}
              </div>
              <div className="text-xs text-[var(--color-text-secondary)]">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Label className="text-xs text-[var(--color-text-secondary)] whitespace-nowrap">Filter status</Label>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as RetailWatchlistStatus | 'all')}
        >
          <SelectTrigger className="h-8 w-40 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {(['watching', 'active', 'passed', 'sold'] as const).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-[var(--color-text-secondary)]">
          {filtered.length} item{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {loading && <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!loading && filtered.length === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)]">
          No items match. Add deals in Retail Monitor.
        </p>
      )}

      <div className="space-y-2">
        {filtered.map((item) => (
          <DealRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}
