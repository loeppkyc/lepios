'use client'

import { useCallback, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

interface Coupon {
  id: string
  user_id: string
  store: string
  description: string
  discount_type: string
  discount_value: number | null
  min_purchase: number | null
  expiry_date: string | null
  code: string | null
  category: string
  is_used: boolean
  created_at: string
}

interface Props {
  initialCoupons: Coupon[]
}

const DISCOUNT_TYPES = ['pct', 'fixed', 'bogo', 'free-shipping', 'other'] as const
const CATEGORIES = [
  'grocery',
  'electronics',
  'clothing',
  'home',
  'restaurant',
  'travel',
  'online',
  'general',
] as const

const BLANK_FORM = {
  store: '',
  description: '',
  discount_type: 'pct',
  discount_value: '',
  min_purchase: '',
  expiry_date: '',
  code: '',
  category: 'general',
}

function discountLabel(c: Coupon): string {
  switch (c.discount_type) {
    case 'pct':
      return c.discount_value != null ? `${c.discount_value}% OFF` : 'PCT OFF'
    case 'fixed':
      return c.discount_value != null ? `$${c.discount_value} OFF` : 'FIXED OFF'
    case 'bogo':
      return 'BOGO'
    case 'free-shipping':
      return 'FREE SHIP'
    default:
      return 'DEAL'
  }
}

function isExpired(expiry: string | null): boolean {
  if (!expiry) return false
  return new Date(expiry).getTime() < Date.now()
}

function isExpiringSoon(expiry: string | null): boolean {
  if (!expiry) return false
  const days = (new Date(expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  return days >= 0 && days <= 7
}

export function CouponsClient({ initialCoupons }: Props) {
  const [coupons, setCoupons] = useState<Coupon[]>(initialCoupons)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Coupon | null>(null)
  const [form, setForm] = useState(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch('/api/coupons')
    const j = (await r.json()) as { coupons: Coupon[]; error?: string }
    if (j.error) {
      setError(j.error)
      return
    }
    setCoupons(j.coupons)
  }, [])

  const openAdd = () => {
    setEditTarget(null)
    setForm(BLANK_FORM)
    setDialogOpen(true)
  }

  const openEdit = (c: Coupon) => {
    setEditTarget(c)
    setForm({
      store: c.store,
      description: c.description,
      discount_type: c.discount_type,
      discount_value: c.discount_value?.toString() ?? '',
      min_purchase: c.min_purchase?.toString() ?? '',
      expiry_date: c.expiry_date ?? '',
      code: c.code ?? '',
      category: c.category,
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.store.trim() || !form.description.trim()) {
      setError('Store and description are required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const body = {
        store: form.store.trim(),
        description: form.description.trim(),
        discount_type: form.discount_type,
        discount_value: form.discount_value ? parseFloat(form.discount_value) : null,
        min_purchase: form.min_purchase ? parseFloat(form.min_purchase) : null,
        expiry_date: form.expiry_date || null,
        code: form.code.trim() || null,
        category: form.category,
      }
      const r = editTarget
        ? await fetch(`/api/coupons/${editTarget.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch('/api/coupons', {
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

  const handleMarkUsed = async (id: string) => {
    await fetch(`/api/coupons/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_used: true }),
    })
    await load()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this coupon?')) return
    await fetch(`/api/coupons/${id}`, { method: 'DELETE' })
    await load()
  }

  const copyCode = async (code: string, id: string) => {
    await navigator.clipboard.writeText(code)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const active = coupons.filter((c) => !c.is_used)
  const used = coupons.filter((c) => c.is_used)

  return (
    <div className="mx-auto max-w-4xl px-6 py-7">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-sm font-extrabold tracking-widest text-[var(--color-text-primary)] uppercase">
            Coupon Lady
          </h1>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Track coupons, promo codes, and deals before they expire.
          </p>
        </div>
        <Button onClick={openAdd} size="sm" className="text-xs">
          + Add Coupon
        </Button>
      </div>

      {error && <p className="mb-4 text-xs text-red-400">{error}</p>}

      <Tabs defaultValue="active">
        <TabsList className="mb-4">
          <TabsTrigger value="active" className="text-xs">
            Active ({active.length})
          </TabsTrigger>
          <TabsTrigger value="used" className="text-xs">
            Used ({used.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          {active.length === 0 ? (
            <p className="py-12 text-center text-xs text-[var(--color-text-disabled)]">
              No active coupons. Add one to get started.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {active.map((c) => (
                <CouponCard
                  key={c.id}
                  coupon={c}
                  copied={copied}
                  onEdit={() => openEdit(c)}
                  onMarkUsed={() => void handleMarkUsed(c.id)}
                  onDelete={() => void handleDelete(c.id)}
                  onCopy={() => c.code && void copyCode(c.code, c.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="used">
          {used.length === 0 ? (
            <p className="py-12 text-center text-xs text-[var(--color-text-disabled)]">
              No used coupons yet.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {used.map((c) => (
                <CouponCard
                  key={c.id}
                  coupon={c}
                  copied={copied}
                  onEdit={() => openEdit(c)}
                  onDelete={() => void handleDelete(c.id)}
                  onCopy={() => c.code && void copyCode(c.code, c.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit Coupon' : 'Add Coupon'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Store</Label>
                <Input
                  value={form.store}
                  onChange={(e) => setForm((f) => ({ ...f, store: e.target.value }))}
                  placeholder="e.g. Walmart"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat} className="capitalize">
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="e.g. 20% off all produce"
                className="text-sm"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select
                  value={form.discount_type}
                  onValueChange={(v) => setForm((f) => ({ ...f, discount_type: v }))}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DISCOUNT_TYPES.map((dt) => (
                      <SelectItem key={dt} value={dt}>
                        {dt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Value</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.discount_value}
                  onChange={(e) => setForm((f) => ({ ...f, discount_value: e.target.value }))}
                  placeholder="e.g. 20"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Min $ Purchase</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.min_purchase}
                  onChange={(e) => setForm((f) => ({ ...f, min_purchase: e.target.value }))}
                  placeholder="Optional"
                  className="text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Promo Code</Label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  placeholder="e.g. SAVE20"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Expiry Date</Label>
                <Input
                  type="date"
                  value={form.expiry_date}
                  onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))}
                  className="text-sm"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Add Coupon'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface CardProps {
  coupon: Coupon
  copied: string | null
  onEdit: () => void
  onMarkUsed?: () => void
  onDelete: () => void
  onCopy: () => void
}

function CouponCard({ coupon: c, copied, onEdit, onMarkUsed, onDelete, onCopy }: CardProps) {
  const expired = isExpired(c.expiry_date)
  const expiringSoon = isExpiringSoon(c.expiry_date)

  return (
    <div
      className={`rounded-lg border bg-[var(--color-surface)] p-4 ${expired ? 'border-red-900/50 opacity-60' : 'border-[var(--color-border)]'}`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-[var(--color-text-primary)]">{c.store}</div>
          <Badge className="mt-1 bg-[var(--color-accent-gold)]/20 text-xs text-[var(--color-accent-gold)] hover:bg-[var(--color-accent-gold)]/30">
            {discountLabel(c)}
          </Badge>
        </div>
        <span className="shrink-0 rounded bg-[var(--color-surface-2)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] capitalize">
          {c.category}
        </span>
      </div>
      <p className="mb-3 text-xs text-[var(--color-text-muted)]">{c.description}</p>
      {c.min_purchase && (
        <p className="mb-2 text-xs text-[var(--color-text-disabled)]">
          Min. purchase: ${c.min_purchase}
        </p>
      )}
      {c.code && (
        <div className="mb-3 flex items-center gap-2">
          <code className="rounded bg-[var(--color-surface-2)] px-2 py-1 font-mono text-xs text-[var(--color-text-primary)]">
            {c.code}
          </code>
          <button
            onClick={onCopy}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            {copied === c.id ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}
      {c.expiry_date && (
        <p
          className={`mb-3 text-xs ${expired ? 'text-red-400' : expiringSoon ? 'text-orange-400' : 'text-[var(--color-text-disabled)]'}`}
        >
          {expired ? 'Expired: ' : expiringSoon ? 'Expires soon: ' : 'Expires: '}
          {c.expiry_date}
        </p>
      )}
      <div className="flex gap-2">
        {!c.is_used && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onEdit}>
            Edit
          </Button>
        )}
        {!c.is_used && onMarkUsed && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onMarkUsed}>
            Mark Used
          </Button>
        )}
        <button
          onClick={onDelete}
          className="ml-auto text-xs text-[var(--color-text-disabled)] hover:text-red-400"
        >
          Delete
        </button>
      </div>
    </div>
  )
}
