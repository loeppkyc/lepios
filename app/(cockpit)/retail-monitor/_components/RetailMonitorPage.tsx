'use client'

import { useEffect, useState, useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { RetailWatchlistItem, RetailWatchlistCreate } from '@/lib/retail/types'
import {
  RETAIL_STORES,
  RETAIL_CATEGORIES,
  STATUS_LABELS,
  STATUS_COLORS,
  type RetailWatchlistStatus,
} from '@/lib/retail/types'

// ── Flip profit calculator ────────────────────────────────────────────────────

function calcProfit(buyPrice: number, amazonPrice: number, fbaFees: number): {
  profit: number
  roi: number
} {
  const referral = amazonPrice * 0.15
  const profit = amazonPrice - buyPrice - fbaFees - referral
  const roi = buyPrice > 0 ? (profit / buyPrice) * 100 : 0
  return { profit, roi }
}

// ── Item card ────────────────────────────────────────────────────────────────

function WatchlistCard({
  item,
  onStatusChange,
  onDelete,
}: {
  item: RetailWatchlistItem
  onStatusChange: (id: string, status: RetailWatchlistStatus) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const isGoodDeal = item.roi_pct != null && item.roi_pct >= 30
  const hasDeal = item.current_price != null &&
    item.target_buy_price != null &&
    item.current_price <= item.target_buy_price

  return (
    <div className="border-border rounded-lg border bg-[var(--color-cockpit-surface)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[var(--color-text-primary)] hover:underline"
              >
                {item.product}
              </a>
            ) : (
              <span className="font-medium text-[var(--color-text-primary)]">{item.product}</span>
            )}
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_COLORS[item.status]}`}>
              {STATUS_LABELS[item.status]}
            </span>
            {hasDeal && (
              <span className="rounded bg-green-900/60 px-1.5 py-0.5 text-xs font-medium text-green-300">
                AT TARGET
              </span>
            )}
          </div>

          <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
            {item.store}
            {item.brand && ` · ${item.brand}`}
            {item.category && ` · ${item.category}`}
          </div>

          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            {item.buy_price != null && (
              <span className="text-[var(--color-text-secondary)]">
                Buy <strong className="text-[var(--color-text-primary)]">${item.buy_price.toFixed(2)}</strong>
              </span>
            )}
            {item.amazon_price != null && (
              <span className="text-[var(--color-text-secondary)]">
                Amazon <strong className="text-[var(--color-text-primary)]">${item.amazon_price.toFixed(2)}</strong>
              </span>
            )}
            {item.est_profit != null && (
              <span className={item.est_profit >= 0 ? 'text-green-400' : 'text-red-400'}>
                Profit <strong>${item.est_profit.toFixed(2)}</strong>
              </span>
            )}
            {item.roi_pct != null && (
              <span className={isGoodDeal ? 'text-green-400' : 'text-[var(--color-text-secondary)]'}>
                ROI <strong>{item.roi_pct.toFixed(1)}%</strong>
              </span>
            )}
          </div>

          {item.notes && (
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{item.notes}</p>
          )}
        </div>

        <button
          onClick={() => onDelete(item.id)}
          className="shrink-0 text-xs text-[var(--color-text-secondary)] hover:text-red-400"
        >
          ✕
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(['watching', 'active', 'passed', 'sold'] as const).map((s) => (
          <button
            key={s}
            onClick={() => onStatusChange(item.id, s)}
            disabled={item.status === s}
            className={`rounded px-2 py-1 text-xs transition-colors ${
              item.status === s
                ? STATUS_COLORS[s]
                : 'bg-[var(--color-cockpit-bg)] text-[var(--color-text-secondary)] hover:bg-[var(--color-cockpit-surface)]'
            }`}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Add item form ─────────────────────────────────────────────────────────────

const EMPTY_FORM: RetailWatchlistCreate = {
  product: '',
  brand: '',
  category: '',
  upc: '',
  asin: '',
  store: 'Walmart',
  buy_price: undefined,
  regular_price: undefined,
  amazon_price: undefined,
  est_fba_fees: undefined,
  target_buy_price: undefined,
  url: '',
  notes: '',
  status: 'watching',
}

function AddItemForm({ onAdded }: { onAdded: () => void }) {
  const [form, setForm] = useState<RetailWatchlistCreate>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fNum = (v: string) => (v === '' ? undefined : parseFloat(v))

  const derived = (() => {
    if (!form.buy_price || !form.amazon_price) return null
    return calcProfit(form.buy_price, form.amazon_price, form.est_fba_fees ?? 0)
  })()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.product.trim()) return
    setSaving(true)
    setError(null)
    try {
      const payload: RetailWatchlistCreate = {
        ...form,
        est_profit: derived?.profit,
        roi_pct: derived?.roi,
        pct_off:
          form.buy_price && form.regular_price && form.regular_price > 0
            ? ((form.regular_price - form.buy_price) / form.regular_price) * 100
            : undefined,
      }
      const res = await fetch('/api/retail/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
      setForm(EMPTY_FORM)
      onAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  const field = (key: keyof RetailWatchlistCreate, label: string, type = 'text', placeholder = '') => (
    <div className="space-y-1">
      <Label className="text-xs text-[var(--color-text-secondary)]">{label}</Label>
      <Input
        type={type}
        placeholder={placeholder}
        value={(form[key] as string | number | undefined) ?? ''}
        onChange={(e) =>
          setForm((f) => ({
            ...f,
            [key]: type === 'number' ? fNum(e.target.value) : e.target.value,
          }))
        }
        className="h-8 text-sm"
      />
    </div>
  )

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {field('product', 'Product *', 'text', 'LEGO Technic 42195…')}
        {field('brand', 'Brand', 'text', 'LEGO')}
        <div className="space-y-1">
          <Label className="text-xs text-[var(--color-text-secondary)]">Category</Label>
          <Select
            value={form.category ?? ''}
            onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {RETAIL_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-[var(--color-text-secondary)]">Store</Label>
          <Select
            value={form.store ?? 'Walmart'}
            onValueChange={(v) => setForm((f) => ({ ...f, store: v }))}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RETAIL_STORES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {field('upc', 'UPC', 'text', '0673419376648')}
        {field('asin', 'ASIN', 'text', 'B0CXXXXXXX')}
      </div>

      <div className="border-border rounded-lg border bg-[var(--color-cockpit-bg)] p-3">
        <p className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">Flip Profit</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {field('buy_price', 'Buy Price ($)', 'number', '24.97')}
          {field('regular_price', 'Regular Price ($)', 'number', '39.99')}
          {field('amazon_price', 'Amazon Price ($)', 'number', '59.99')}
          {field('est_fba_fees', 'Est FBA Fees ($)', 'number', '8.50')}
        </div>
        {derived && (
          <div className="mt-2 flex gap-4 text-sm">
            <span className={derived.profit >= 0 ? 'text-green-400' : 'text-red-400'}>
              Est Profit: <strong>${derived.profit.toFixed(2)}</strong>
            </span>
            <span className={derived.roi >= 30 ? 'text-green-400' : 'text-[var(--color-text-secondary)]'}>
              ROI: <strong>{derived.roi.toFixed(1)}%</strong>
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field('target_buy_price', 'Target Buy Price ($)', 'number', '19.97')}
        {field('url', 'Product URL', 'text', 'https://www.walmart.ca/…')}
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-[var(--color-text-secondary)]">Notes</Label>
        <textarea
          placeholder="Clearance tag spotted, check back in 2 weeks…"
          value={form.notes ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          className="border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring/50 flex min-h-16 w-full rounded-md border px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Button type="submit" disabled={saving || !form.product.trim()} size="sm">
        {saving ? 'Saving…' : 'Add to Watchlist'}
      </Button>
    </form>
  )
}

// ── Standalone flip calculator ───────────────────────────────────────────────

function FlipCalculator() {
  const [buy, setBuy] = useState('')
  const [sell, setSell] = useState('')
  const [fees, setFees] = useState('')

  const result = (() => {
    const b = parseFloat(buy)
    const s = parseFloat(sell)
    const f = parseFloat(fees) || 0
    if (!b || !s) return null
    return calcProfit(b, s, f)
  })()

  return (
    <div className="max-w-sm space-y-4">
      <div className="grid grid-cols-1 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-[var(--color-text-secondary)]">Buy Price ($)</Label>
          <Input type="number" placeholder="24.97" value={buy} onChange={(e) => setBuy(e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-[var(--color-text-secondary)]">Amazon Sell Price ($)</Label>
          <Input type="number" placeholder="59.99" value={sell} onChange={(e) => setSell(e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-[var(--color-text-secondary)]">Est FBA Fees ($)</Label>
          <Input type="number" placeholder="8.50" value={fees} onChange={(e) => setFees(e.target.value)} className="h-8 text-sm" />
        </div>
      </div>

      {result && (
        <div className="border-border rounded-lg border bg-[var(--color-cockpit-bg)] p-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-[var(--color-text-secondary)]">Amazon referral (15%)</span>
            <span>${(parseFloat(sell) * 0.15).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--color-text-secondary)]">FBA fees</span>
            <span>${(parseFloat(fees) || 0).toFixed(2)}</span>
          </div>
          <div className="border-border my-1 border-t" />
          <div className="flex justify-between font-medium">
            <span>Est Profit</span>
            <span className={result.profit >= 0 ? 'text-green-400' : 'text-red-400'}>
              ${result.profit.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between font-medium">
            <span>ROI</span>
            <span className={result.roi >= 30 ? 'text-green-400' : 'text-[var(--color-text-secondary)]'}>
              {result.roi.toFixed(1)}%
            </span>
          </div>
          {result.roi >= 30 && (
            <p className="mt-1 text-xs text-green-400">Good deal — ROI ≥ 30%</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function RetailMonitorPage() {
  const [items, setItems] = useState<RetailWatchlistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/retail/watchlist')
      if (!res.ok) throw new Error('Failed to load watchlist')
      const data = (await res.json()) as { items: RetailWatchlistItem[] }
      setItems(data.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const handleStatusChange = async (id: string, status: RetailWatchlistStatus) => {
    await fetch(`/api/retail/watchlist/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    await load()
  }

  const handleDelete = async (id: string) => {
    await fetch(`/api/retail/watchlist/${id}`, { method: 'DELETE' })
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  const activeDeals = items.filter((i) => i.roi_pct != null && i.roi_pct >= 30)
  const watching = items.filter((i) => i.status === 'watching')
  const active = items.filter((i) => i.status === 'active')

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Retail Monitor</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Watchlist · flip profit calculator · deal pipeline
        </p>
      </div>

      {items.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {[
            { label: 'Watching', value: watching.length },
            { label: 'Active', value: active.length },
            { label: 'Good Deals', value: activeDeals.length, highlight: activeDeals.length > 0 },
          ].map(({ label, value, highlight }) => (
            <div key={label} className="border-border rounded-lg border bg-[var(--color-cockpit-surface)] px-4 py-2">
              <div className={`text-lg font-bold ${highlight ? 'text-green-400' : 'text-[var(--color-text-primary)]'}`}>
                {value}
              </div>
              <div className="text-xs text-[var(--color-text-secondary)]">{label}</div>
            </div>
          ))}
        </div>
      )}

      <Tabs defaultValue="watchlist">
        <TabsList>
          <TabsTrigger value="watchlist">Watchlist ({items.length})</TabsTrigger>
          <TabsTrigger value="add">Add Item</TabsTrigger>
          <TabsTrigger value="calc">Calculator</TabsTrigger>
        </TabsList>

        <TabsContent value="watchlist" className="mt-4">
          {loading && <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
          {!loading && items.length === 0 && (
            <p className="text-sm text-[var(--color-text-secondary)]">
              No items yet. Use the Add Item tab to track your first deal.
            </p>
          )}
          <div className="space-y-3">
            {items.map((item) => (
              <WatchlistCard
                key={item.id}
                item={item}
                onStatusChange={handleStatusChange}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="add" className="mt-4">
          <AddItemForm onAdded={load} />
        </TabsContent>

        <TabsContent value="calc" className="mt-4">
          <FlipCalculator />
        </TabsContent>
      </Tabs>
    </div>
  )
}
