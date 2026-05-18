'use client'

import { useCallback, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface EbayListing {
  id: string
  user_id: string
  title: string
  sku: string | null
  listing_price: number | null
  buy_it_now_price: number | null
  quantity: number
  status: string
  ebay_item_id: string | null
  listed_at: string | null
  sold_at: string | null
  sold_price: number | null
  fees: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

interface Props {
  initialListings: EbayListing[]
}

const STATUSES = ['draft', 'active', 'sold', 'ended', 'relisted'] as const

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)]',
  active: 'bg-green-900/50 text-green-300',
  sold: 'bg-blue-900/50 text-blue-300',
  ended: 'bg-red-900/50 text-red-300',
  relisted: 'bg-yellow-900/50 text-yellow-300',
}

const BLANK_FORM = {
  title: '',
  sku: '',
  listing_price: '',
  buy_it_now_price: '',
  quantity: '1',
  status: 'draft',
  ebay_item_id: '',
  listed_at: '',
  sold_price: '',
  fees: '',
  notes: '',
}
const BLANK_SELL = { sold_price: '', fees: '', sold_at: '' }

const fmtCad = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`)

function netProfit(l: EbayListing): number | null {
  if (l.sold_price == null) return null
  return l.sold_price - (l.fees ?? 0)
}

function computeStats(listings: EbayListing[]) {
  const active = listings.filter((l) => l.status === 'active').length
  const sold = listings.filter((l) => l.status === 'sold')
  const totalRevenue = sold.reduce((s, l) => s + (l.sold_price ?? 0), 0)
  const totalFees = sold.reduce((s, l) => s + (l.fees ?? 0), 0)
  return {
    active,
    totalSold: sold.length,
    totalRevenue,
    totalFees,
    netProfitTotal: totalRevenue - totalFees,
  }
}

export function EbayListingsClient({ initialListings }: Props) {
  const [listings, setListings] = useState<EbayListing[]>(initialListings)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [sellDialogOpen, setSellDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<EbayListing | null>(null)
  const [sellTarget, setSellTarget] = useState<EbayListing | null>(null)
  const [form, setForm] = useState(BLANK_FORM)
  const [sellForm, setSellForm] = useState(BLANK_SELL)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch('/api/ebay-listings')
    const j = (await r.json()) as { listings: EbayListing[]; error?: string }
    if (j.error) {
      setError(j.error)
      return
    }
    setListings(j.listings)
  }, [])

  const openAdd = () => {
    setEditTarget(null)
    setForm({ ...BLANK_FORM, listed_at: new Date().toISOString().slice(0, 10) })
    setDialogOpen(true)
  }

  const openEdit = (l: EbayListing) => {
    setEditTarget(l)
    setForm({
      title: l.title,
      sku: l.sku ?? '',
      listing_price: l.listing_price?.toString() ?? '',
      buy_it_now_price: l.buy_it_now_price?.toString() ?? '',
      quantity: l.quantity.toString(),
      status: l.status,
      ebay_item_id: l.ebay_item_id ?? '',
      listed_at: l.listed_at ? l.listed_at.slice(0, 10) : '',
      sold_price: l.sold_price?.toString() ?? '',
      fees: l.fees?.toString() ?? '',
      notes: l.notes ?? '',
    })
    setDialogOpen(true)
  }

  const openMarkSold = (l: EbayListing) => {
    setSellTarget(l)
    setSellForm({ ...BLANK_SELL, sold_at: new Date().toISOString().slice(0, 10) })
    setSellDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.title.trim()) {
      setError('Title is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const body = {
        title: form.title.trim(),
        sku: form.sku.trim() || null,
        listing_price: form.listing_price ? parseFloat(form.listing_price) : null,
        buy_it_now_price: form.buy_it_now_price ? parseFloat(form.buy_it_now_price) : null,
        quantity: parseInt(form.quantity) || 1,
        status: form.status,
        ebay_item_id: form.ebay_item_id.trim() || null,
        listed_at: form.listed_at ? new Date(form.listed_at).toISOString() : null,
        sold_price: form.sold_price ? parseFloat(form.sold_price) : null,
        fees: form.fees ? parseFloat(form.fees) : null,
        notes: form.notes.trim() || null,
      }
      const r = editTarget
        ? await fetch(`/api/ebay-listings/${editTarget.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch('/api/ebay-listings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
      const j = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      setDialogOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleMarkSold = async () => {
    if (!sellTarget || !sellForm.sold_price) {
      setError('Sold price is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const r = await fetch(`/api/ebay-listings/${sellTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'sold',
          sold_price: parseFloat(sellForm.sold_price),
          fees: sellForm.fees ? parseFloat(sellForm.fees) : null,
          sold_at: new Date(sellForm.sold_at).toISOString(),
        }),
      })
      const j = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      setSellDialogOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this listing?')) return
    await fetch(`/api/ebay-listings/${id}`, { method: 'DELETE' })
    await load()
  }

  const stats = computeStats(listings)
  const TAB_FILTERS: Record<string, string[]> = {
    all: [...STATUSES],
    active: ['active'],
    sold: ['sold'],
    draft: ['draft'],
    ended: ['ended', 'relisted'],
  }
  const filtered =
    statusFilter === 'all'
      ? listings
      : listings.filter((l) => (TAB_FILTERS[statusFilter] ?? []).includes(l.status))

  return (
    <div className="mx-auto max-w-5xl px-6 py-7">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-sm font-extrabold tracking-widest text-[var(--color-text-primary)] uppercase">
            eBay Listings
          </h1>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Track active listings, sales, fees, and profit.
          </p>
        </div>
        <Button onClick={openAdd} size="sm" className="text-xs">
          + Add Listing
        </Button>
      </div>

      {error && <p className="mb-4 text-xs text-red-400">{error}</p>}

      {/* Stats row */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Active" value={String(stats.active)} />
        <StatCard label="Total Sold" value={String(stats.totalSold)} />
        <StatCard label="Revenue" value={fmtCad(stats.totalRevenue)} />
        <StatCard label="Fees" value={fmtCad(stats.totalFees)} />
        <StatCard
          label="Net Profit"
          value={fmtCad(stats.netProfitTotal)}
          color={stats.netProfitTotal >= 0 ? 'text-green-400' : 'text-red-400'}
        />
      </div>

      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList className="mb-4">
          {['all', 'active', 'sold', 'draft', 'ended'].map((tab) => (
            <TabsTrigger key={tab} value={tab} className="text-xs capitalize">
              {tab}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={statusFilter}>
          {filtered.length === 0 ? (
            <p className="py-12 text-center text-xs text-[var(--color-text-disabled)]">
              No listings in this view.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-disabled)]">
                    <th className="pr-4 pb-2 font-medium">Title</th>
                    <th className="pr-4 pb-2 font-medium">SKU</th>
                    <th className="pr-4 pb-2 text-right font-medium">Price</th>
                    <th className="pr-4 pb-2 text-right font-medium">Qty</th>
                    <th className="pr-4 pb-2 font-medium">Status</th>
                    <th className="pr-4 pb-2 font-medium">Listed</th>
                    <th className="pr-4 pb-2 font-medium">Sold</th>
                    <th className="pr-4 pb-2 text-right font-medium">Net</th>
                    <th className="pb-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => {
                    const net = netProfit(l)
                    return (
                      <tr
                        key={l.id}
                        className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                      >
                        <td className="py-2 pr-4 font-medium text-[var(--color-text-primary)]">
                          {l.title}
                        </td>
                        <td className="py-2 pr-4 font-mono text-[var(--color-text-disabled)]">
                          {l.sku ?? '—'}
                        </td>
                        <td className="py-2 pr-4 text-right font-mono">
                          {fmtCad(l.listing_price)}
                        </td>
                        <td className="py-2 pr-4 text-right font-mono">{l.quantity}</td>
                        <td className="py-2 pr-4">
                          <Badge className={`text-xs capitalize ${STATUS_COLORS[l.status] ?? ''}`}>
                            {l.status}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4 font-mono text-[var(--color-text-disabled)]">
                          {l.listed_at ? l.listed_at.slice(0, 10) : '—'}
                        </td>
                        <td className="py-2 pr-4 font-mono text-[var(--color-text-disabled)]">
                          {l.sold_at ? l.sold_at.slice(0, 10) : '—'}
                        </td>
                        <td
                          className={`py-2 pr-4 text-right font-mono ${net != null && net >= 0 ? 'text-green-400' : net != null ? 'text-red-400' : ''}`}
                        >
                          {net != null ? fmtCad(net) : '—'}
                        </td>
                        <td className="py-2">
                          <div className="flex gap-2">
                            {l.status !== 'sold' && (
                              <button
                                onClick={() => openMarkSold(l)}
                                className="text-xs text-[var(--color-text-muted)] hover:text-green-400"
                              >
                                Sold
                              </button>
                            )}
                            <button
                              onClick={() => openEdit(l)}
                              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => void handleDelete(l.id)}
                              className="text-xs text-[var(--color-text-disabled)] hover:text-red-400"
                            >
                              Del
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
        </TabsContent>
      </Tabs>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit Listing' : 'Add Listing'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="space-y-1">
              <Label className="text-xs">Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Item title"
                className="text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">SKU</Label>
                <Input
                  value={form.sku}
                  onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                  placeholder="Optional"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">eBay Item ID</Label>
                <Input
                  value={form.ebay_item_id}
                  onChange={(e) => setForm((f) => ({ ...f, ebay_item_id: e.target.value }))}
                  placeholder="Optional"
                  className="text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Listing Price</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.listing_price}
                  onChange={(e) => setForm((f) => ({ ...f, listing_price: e.target.value }))}
                  placeholder="$"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">BIN Price</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.buy_it_now_price}
                  onChange={(e) => setForm((f) => ({ ...f, buy_it_now_price: e.target.value }))}
                  placeholder="$"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Qty</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                  className="text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Listed At</Label>
                <Input
                  type="date"
                  value={form.listed_at}
                  onChange={(e) => setForm((f) => ({ ...f, listed_at: e.target.value }))}
                  className="text-sm"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="resize-none text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Add Listing'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark Sold Dialog */}
      <Dialog open={sellDialogOpen} onOpenChange={setSellDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark as Sold</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {error && <p className="text-xs text-red-400">{error}</p>}
            {sellTarget && (
              <p className="text-sm text-[var(--color-text-muted)]">{sellTarget.title}</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Sold Price $</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={sellForm.sold_price}
                  onChange={(e) => setSellForm((f) => ({ ...f, sold_price: e.target.value }))}
                  placeholder="0.00"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fees $</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={sellForm.fees}
                  onChange={(e) => setSellForm((f) => ({ ...f, fees: e.target.value }))}
                  placeholder="0.00"
                  className="text-sm"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sold Date</Label>
              <Input
                type="date"
                value={sellForm.sold_at}
                onChange={(e) => setSellForm((f) => ({ ...f, sold_at: e.target.value }))}
                className="text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSellDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleMarkSold()} disabled={saving}>
              {saving ? 'Saving…' : 'Mark Sold'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className={`font-mono text-lg font-bold ${color ?? 'text-[var(--color-accent-gold)]'}`}>
        {value}
      </div>
      <div className="mt-1 text-xs font-bold tracking-widest text-[var(--color-text-disabled)] uppercase">
        {label}
      </div>
    </div>
  )
}
