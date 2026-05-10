'use client'

import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { DealTrackerItem, DealPriceHistory } from '@/lib/deal-tracker/types'

const STORES = ['Amazon.ca', 'Walmart.ca', 'Costco', 'Canadian Tire', 'Best Buy', 'Other']

function badge(label: string, cls: string) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
}

function ItemRow({
  item,
  onUpdatePrice,
  onDelete,
}: {
  item: DealTrackerItem
  onUpdatePrice: (id: string, price: number) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [inputPrice, setInputPrice] = useState('')
  const [saving, setSaving] = useState(false)
  const isDeal = item.current_price != null && item.current_price <= item.target_price

  return (
    <div className="border-border rounded-lg border bg-[var(--color-cockpit-surface)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
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
          {item.store && (
            <span className="ml-2 text-xs text-[var(--color-text-secondary)]">{item.store}</span>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-[var(--color-text-secondary)]">
              Target: <strong>${item.target_price.toFixed(2)}</strong>
            </span>
            {item.current_price != null && (
              <span className="text-[var(--color-text-secondary)]">
                Current: <strong>${item.current_price.toFixed(2)}</strong>
              </span>
            )}
            {isDeal && badge('DEAL', 'bg-green-900/50 text-green-300')}
            {item.alert_sent && badge('Alerted', 'bg-blue-900/50 text-blue-300')}
          </div>
        </div>
        <button
          onClick={() => onDelete(item.id)}
          className="text-xs text-[var(--color-text-secondary)] hover:text-red-400"
        >
          ✕
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Input
          type="number"
          step="0.01"
          min="0"
          placeholder="Update price"
          value={inputPrice}
          onChange={(e) => setInputPrice(e.target.value)}
          className="h-8 w-32 text-sm"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!inputPrice || saving}
          onClick={async () => {
            const p = parseFloat(inputPrice)
            if (isNaN(p)) return
            setSaving(true)
            await onUpdatePrice(item.id, p)
            setInputPrice('')
            setSaving(false)
          }}
        >
          {saving ? 'Saving…' : 'Update'}
        </Button>
      </div>
    </div>
  )
}

function AddItemForm({ onAdd }: { onAdd: () => void }) {
  const [form, setForm] = useState({
    product: '',
    url: '',
    store: 'Amazon.ca',
    target_price: '',
    current_price: '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.product || !form.target_price) {
      setErr('Product name and target price are required.')
      return
    }
    setSaving(true)
    setErr('')
    const res = await fetch('/api/deal-tracker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: form.product,
        url: form.url || null,
        store: form.store,
        target_price: parseFloat(form.target_price),
        current_price: form.current_price ? parseFloat(form.current_price) : null,
      }),
    })
    if (!res.ok) {
      const d = await res.json()
      setErr(d.error ?? 'Failed to add item.')
    } else {
      setForm({ product: '', url: '', store: 'Amazon.ca', target_price: '', current_price: '' })
      onAdd()
    }
    setSaving(false)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Product Name</Label>
          <Input
            value={form.product}
            onChange={(e) => setForm((f) => ({ ...f, product: e.target.value }))}
            placeholder="Lego Technic Set"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Store</Label>
          <Select value={form.store} onValueChange={(v) => setForm((f) => ({ ...f, store: v }))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STORES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Target Price ($)</Label>
          <Input
            type="number"
            step="0.01"
            min="0.01"
            value={form.target_price}
            onChange={(e) => setForm((f) => ({ ...f, target_price: e.target.value }))}
            placeholder="29.99"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Current Price ($) — optional</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={form.current_price}
            onChange={(e) => setForm((f) => ({ ...f, current_price: e.target.value }))}
            placeholder="49.99"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Product URL — optional</Label>
          <Input
            type="url"
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            placeholder="https://www.amazon.ca/..."
          />
        </div>
      </div>
      {err && <p className="text-sm text-red-400">{err}</p>}
      <Button type="submit" disabled={saving}>
        {saving ? 'Adding…' : 'Add to Watchlist'}
      </Button>
    </form>
  )
}

function PriceHistoryTab({ items }: { items: DealTrackerItem[] }) {
  const [selectedId, setSelectedId] = useState<string>(items[0]?.id ?? '')
  const [history, setHistory] = useState<DealPriceHistory[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!selectedId) return
    setLoading(true)
    fetch(`/api/deal-tracker/history?item_id=${selectedId}`)
      .then((r) => r.json())
      .then((d) => setHistory(d.history ?? []))
      .finally(() => setLoading(false))
  }, [selectedId])

  if (!items.length) return <p className="text-sm text-[var(--color-text-secondary)]">No items tracked yet.</p>

  const selectedItem = items.find((i) => i.id === selectedId)

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Select Product</Label>
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-full max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((i) => (
              <SelectItem key={i.id} value={i.id}>
                {i.product}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading && <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>}

      {!loading && history.length === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)]">No price history yet for this item.</p>
      )}

      {!loading && history.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-[var(--color-text-secondary)]">
            {selectedItem?.product} — {history.length} data point{history.length !== 1 ? 's' : ''}
          </p>
          <div className="border-border overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-cockpit-bg)] text-[var(--color-text-secondary)]">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-right">Price</th>
                  <th className="px-4 py-2 text-right">vs Target</th>
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map((h) => {
                  const diff = selectedItem ? h.price - selectedItem.target_price : 0
                  return (
                    <tr key={h.id} className="border-border border-t">
                      <td className="px-4 py-2 text-[var(--color-text-secondary)]">
                        {new Date(h.recorded_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2 text-right font-medium">${h.price.toFixed(2)}</td>
                      <td
                        className={`px-4 py-2 text-right text-xs ${diff <= 0 ? 'text-green-400' : 'text-[var(--color-text-secondary)]'}`}
                      >
                        {diff <= 0 ? `−$${Math.abs(diff).toFixed(2)}` : `+$${diff.toFixed(2)}`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export function DealTrackerPage() {
  const [items, setItems] = useState<DealTrackerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  async function load() {
    setLoading(true)
    const res = await fetch('/api/deal-tracker')
    const d = await res.json()
    if (!res.ok) setErr(d.error ?? 'Failed to load.')
    else setItems(d.items ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleUpdatePrice(id: string, price: number) {
    await fetch('/api/deal-tracker', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, current_price: price }),
    })
    await load()
  }

  async function handleDelete(id: string) {
    await fetch(`/api/deal-tracker?id=${id}`, { method: 'DELETE' })
    await load()
  }

  const activeDeals = items.filter(
    (i) => i.current_price != null && i.current_price <= i.target_price,
  )
  const savingsAvailable = activeDeals.reduce(
    (acc, i) => acc + (i.target_price - (i.current_price ?? 0)),
    0,
  )

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Deal Tracker</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Price watchlist — get alerted when items drop to your target
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          ['Tracked', items.length],
          ['Active Deals', activeDeals.length],
          ['Savings', `$${savingsAvailable.toFixed(2)}`],
        ].map(([label, val]) => (
          <div key={label as string} className="border-border rounded-lg border bg-[var(--color-cockpit-surface)] p-3 text-center">
            <div className="text-lg font-semibold text-[var(--color-text-primary)]">{val}</div>
            <div className="text-xs text-[var(--color-text-secondary)]">{label}</div>
          </div>
        ))}
      </div>

      {err && <p className="text-sm text-red-400">{err}</p>}

      <Tabs defaultValue="watchlist">
        <TabsList>
          <TabsTrigger value="watchlist">Watchlist</TabsTrigger>
          <TabsTrigger value="add">Add Product</TabsTrigger>
          <TabsTrigger value="history">Price History</TabsTrigger>
        </TabsList>

        <TabsContent value="watchlist" className="mt-4 space-y-3">
          {loading && <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>}
          {!loading && items.length === 0 && (
            <p className="text-sm text-[var(--color-text-secondary)]">
              No products tracked yet. Add one in the Add Product tab.
            </p>
          )}
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              onUpdatePrice={handleUpdatePrice}
              onDelete={handleDelete}
            />
          ))}
        </TabsContent>

        <TabsContent value="add" className="mt-4">
          <AddItemForm onAdd={load} />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <PriceHistoryTab items={items} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
