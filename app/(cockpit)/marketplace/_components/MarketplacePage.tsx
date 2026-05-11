'use client'

import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { MarketplaceListing, ChannelStatus } from '@/lib/reselling/types'

const STATUS_LABELS: Record<ChannelStatus, string> = {
  none: 'Not listed',
  active: 'Active',
  sold: 'Sold',
  ended: 'Ended',
}

const STATUS_CLASSES: Record<ChannelStatus, string> = {
  none: 'bg-[var(--color-cockpit-bg)] text-[var(--color-text-secondary)]',
  active: 'bg-green-900/40 text-green-300',
  sold: 'bg-blue-900/40 text-blue-300',
  ended: 'bg-[var(--color-cockpit-surface)] text-[var(--color-text-secondary)]',
}

function ChannelBadge({ status }: { status: ChannelStatus }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}

function ListingRow({
  listing,
  onStatusChange,
  onDelete,
}: {
  listing: MarketplaceListing
  onStatusChange: (
    id: string,
    channel: 'ebay' | 'fb' | 'kijiji',
    status: ChannelStatus
  ) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  async function handleStatusChange(channel: 'ebay' | 'fb' | 'kijiji', status: ChannelStatus) {
    await onStatusChange(listing.id, channel, status)
  }

  return (
    <div className="border-border rounded-lg border bg-[var(--color-cockpit-surface)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-[var(--color-text-primary)]">{listing.title}</p>
          <div className="mt-0.5 flex gap-3 text-xs text-[var(--color-text-secondary)]">
            {listing.sku && <span>SKU: {listing.sku}</span>}
            {listing.asin && <span className="font-mono">{listing.asin}</span>}
            {listing.isbn && <span>ISBN: {listing.isbn}</span>}
            {listing.list_price != null && <span>${listing.list_price.toFixed(2)}</span>}
            <span className="capitalize">{listing.source}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            {(['ebay', 'fb', 'kijiji'] as const).map((ch) => (
              <div key={ch} className="flex items-center gap-1.5">
                <span className="text-xs text-[var(--color-text-secondary)] uppercase">{ch}</span>
                <ChannelBadge status={listing[`${ch}_status`] as ChannelStatus} />
                <Select
                  value={listing[`${ch}_status`]}
                  onValueChange={(v) => handleStatusChange(ch, v as ChannelStatus)}
                >
                  <SelectTrigger className="h-6 w-24 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['none', 'active', 'sold', 'ended'] as ChannelStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          {listing.notes && (
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{listing.notes}</p>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 text-red-400 hover:text-red-300"
          onClick={async () => {
            if (!confirm(`Delete "${listing.title}"?`)) return
            await onDelete(listing.id)
          }}
        >
          Delete
        </Button>
      </div>
    </div>
  )
}

function AddListingForm({ onAdded }: { onAdded: () => void }) {
  const [form, setForm] = useState({
    title: '',
    source: 'amazon' as MarketplaceListing['source'],
    sku: '',
    asin: '',
    isbn: '',
    list_price: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.title) {
      setError('Title is required.')
      return
    }
    setSaving(true)
    const res = await fetch('/api/marketplace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: form.title,
        source: form.source,
        sku: form.sku || undefined,
        asin: form.asin || undefined,
        isbn: form.isbn || undefined,
        list_price: form.list_price ? parseFloat(form.list_price) : undefined,
        notes: form.notes || undefined,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const j = await res.json()
      setError(j.error ?? 'Failed')
      return
    }
    setForm({ title: '', source: 'amazon', sku: '', asin: '', isbn: '', list_price: '', notes: '' })
    onAdded()
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-border space-y-4 rounded-lg border bg-[var(--color-cockpit-surface)] p-4"
    >
      <h3 className="font-medium text-[var(--color-text-primary)]">Add Listing</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-2">
          <Label>Title</Label>
          <Input
            placeholder="Product name"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label>Source</Label>
          <Select
            value={form.source}
            onValueChange={(v) => setForm({ ...form, source: v as MarketplaceListing['source'] })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="amazon">Amazon</SelectItem>
              <SelectItem value="books">Books</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>SKU (optional)</Label>
          <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>ASIN (optional)</Label>
          <Input
            placeholder="B0XXXXXXXX"
            value={form.asin}
            onChange={(e) => setForm({ ...form, asin: e.target.value.toUpperCase() })}
          />
        </div>
        <div className="space-y-1">
          <Label>List price ($)</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={form.list_price}
            onChange={(e) => setForm({ ...form, list_price: e.target.value })}
          />
        </div>
        <div className="space-y-1 sm:col-span-3">
          <Label>Notes (optional)</Label>
          <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Add Listing'}
      </Button>
    </form>
  )
}

export function MarketplacePage() {
  const [listings, setListings] = useState<MarketplaceListing[]>([])
  const [loading, setLoading] = useState(true)

  async function fetchListings() {
    setLoading(true)
    const res = await fetch('/api/marketplace')
    const j = await res.json()
    setListings(j.listings ?? [])
    setLoading(false)
  }

  useEffect(() => {
    fetch('/api/marketplace')
      .then((r) => r.json())
      .then((j) => {
        setListings(j.listings ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function handleStatusChange(
    id: string,
    channel: 'ebay' | 'fb' | 'kijiji',
    status: ChannelStatus
  ) {
    const field = `${channel}_status`
    const timeField =
      status === 'active' ? `${channel}_listed_at` : status === 'sold' ? `${channel}_sold_at` : null
    const patch: Record<string, unknown> = { [field]: status }
    if (timeField) patch[timeField] = new Date().toISOString()

    await fetch(`/api/marketplace/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    await fetchListings()
  }

  async function deleteListing(id: string) {
    await fetch(`/api/marketplace/${id}`, { method: 'DELETE' })
    await fetchListings()
  }

  const active = listings.filter(
    (l) => l.ebay_status === 'active' || l.fb_status === 'active' || l.kijiji_status === 'active'
  )
  const sold = listings.filter(
    (l) => l.ebay_status === 'sold' || l.fb_status === 'sold' || l.kijiji_status === 'sold'
  )

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Marketplace Hub</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Cross-channel listing tracker (eBay / Facebook / Kijiji) — ported from
          64_Marketplace_Hub.py
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total listings', value: listings.length },
          { label: 'Active listings', value: active.length },
          { label: 'Sold', value: sold.length },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="border-border rounded-lg border bg-[var(--color-cockpit-surface)] p-4"
          >
            <p className="text-xs text-[var(--color-text-secondary)]">{kpi.label}</p>
            <p className="mt-1 text-2xl font-semibold text-[var(--color-text-primary)]">
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All ({listings.length})</TabsTrigger>
          <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
          <TabsTrigger value="sold">Sold ({sold.length})</TabsTrigger>
          <TabsTrigger value="add">Add Listing</TabsTrigger>
        </TabsList>

        {(['all', 'active', 'sold'] as const).map((tab) => {
          const filtered = tab === 'all' ? listings : tab === 'active' ? active : sold
          return (
            <TabsContent key={tab} value={tab} className="space-y-3 pt-4">
              {loading && <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>}
              {!loading && filtered.length === 0 && (
                <p className="text-sm text-[var(--color-text-secondary)]">
                  No {tab === 'all' ? '' : tab + ' '}listings yet.
                </p>
              )}
              {filtered.map((l) => (
                <ListingRow
                  key={l.id}
                  listing={l}
                  onStatusChange={handleStatusChange}
                  onDelete={deleteListing}
                />
              ))}
            </TabsContent>
          )
        })}

        <TabsContent value="add" className="pt-4">
          <AddListingForm onAdded={fetchListings} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
