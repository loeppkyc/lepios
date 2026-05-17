'use client'

import { useState } from 'react'
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
import { Badge } from '@/components/ui/badge'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WatchTarget {
  id: string
  name: string
  type: 'amazon-asin' | 'lego-ca' | 'generic-url'
  url: string | null
  asin: string | null
  lego_item_number: string | null
  check_interval_min: number
  alert_on: string
  threshold_price: number | null
  last_status: string | null
  last_checked_at: string | null
  is_active: boolean
  notes: string | null
  created_at: string
}

interface WatchEvent {
  id: string
  watch_target_id: string
  event_type: string
  old_value: string | null
  new_value: string | null
  message: string | null
  occurred_at: string
  watch_targets?: { name: string } | null
}

interface Props {
  initialTargets: WatchTarget[]
  initialEvents: WatchEvent[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusBadge(status: string | null, isActive: boolean) {
  if (!isActive)
    return (
      <Badge variant="outline" className="text-xs text-[var(--color-text-disabled)]">
        Paused
      </Badge>
    )
  if (!status)
    return (
      <Badge variant="outline" className="text-xs">
        Unknown
      </Badge>
    )
  if (status === 'in_stock')
    return (
      <Badge className="bg-green-900/50 text-xs text-green-300 hover:bg-green-900/60">
        In Stock
      </Badge>
    )
  if (status === 'out_of_stock')
    return (
      <Badge className="bg-red-900/50 text-xs text-red-300 hover:bg-red-900/60">Out of Stock</Badge>
    )
  if (status === 'match')
    return (
      <Badge className="bg-yellow-900/50 text-xs text-yellow-300 hover:bg-yellow-900/60">
        Matched
      </Badge>
    )
  return (
    <Badge variant="outline" className="text-xs text-[var(--color-text-muted)]">
      {status}
    </Badge>
  )
}

function eventBadge(eventType: string) {
  if (eventType === 'in_stock')
    return (
      <span className="rounded bg-green-900/50 px-1.5 py-0.5 text-xs text-green-300">In Stock</span>
    )
  if (eventType === 'price_drop')
    return (
      <span className="rounded bg-blue-900/50 px-1.5 py-0.5 text-xs text-blue-300">Price Drop</span>
    )
  if (eventType === 'status_change')
    return (
      <span className="rounded bg-yellow-900/50 px-1.5 py-0.5 text-xs text-yellow-300">Change</span>
    )
  if (eventType === 'error')
    return <span className="rounded bg-red-900/50 px-1.5 py-0.5 text-xs text-red-300">Error</span>
  return (
    <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-xs">{eventType}</span>
  )
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function typeLabel(type: string): string {
  if (type === 'amazon-asin') return 'Amazon'
  if (type === 'lego-ca') return 'LEGO.ca'
  return 'Generic'
}

// ─── Add Target Form ─────────────────────────────────────────────────────────

function AddTargetForm({ onAdded }: { onAdded: (target: WatchTarget) => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [type, setType] = useState<'amazon-asin' | 'lego-ca' | 'generic-url'>('amazon-asin')
  const [asin, setAsin] = useState('')
  const [url, setUrl] = useState('')
  const [alertOn, setAlertOn] = useState<'in_stock' | 'price_drop' | 'any_change'>('in_stock')
  const [thresholdPrice, setThresholdPrice] = useState('')
  const [intervalMin, setIntervalMin] = useState('10')
  const [notes, setNotes] = useState('')

  function reset() {
    setName('')
    setType('amazon-asin')
    setAsin('')
    setUrl('')
    setAlertOn('in_stock')
    setThresholdPrice('')
    setIntervalMin('10')
    setNotes('')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const body = {
        name: name.trim(),
        type,
        asin: type === 'amazon-asin' ? asin.trim() || null : null,
        url: type !== 'amazon-asin' ? url.trim() || null : null,
        alert_on: alertOn,
        threshold_price:
          alertOn === 'price_drop' && thresholdPrice ? parseFloat(thresholdPrice) : null,
        check_interval_min: parseInt(intervalMin, 10),
        notes: notes.trim() || null,
      }

      const res = await fetch('/api/deal-watch/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const d = (await res.json()) as { error?: string }
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }

      const { target } = (await res.json()) as { target: WatchTarget }
      onAdded(target)
      reset()
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <Button size="sm" className="text-xs" onClick={() => setOpen(true)}>
        + Add Target
      </Button>
    )
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-cockpit-surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Add Watch Target</h3>
        <button
          type="button"
          onClick={() => {
            reset()
            setOpen(false)
          }}
          className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        >
          Cancel
        </button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="wt-name" className="text-xs">
              Name
            </Label>
            <Input
              id="wt-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. LEGO Eiffel Tower"
              className="h-8 text-xs"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wt-type" className="text-xs">
              Type
            </Label>
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger id="wt-type" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="amazon-asin">Amazon ASIN</SelectItem>
                <SelectItem value="lego-ca">LEGO.ca</SelectItem>
                <SelectItem value="generic-url">Generic URL</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {type === 'amazon-asin' && (
          <div className="space-y-1">
            <Label htmlFor="wt-asin" className="text-xs">
              ASIN
            </Label>
            <Input
              id="wt-asin"
              value={asin}
              onChange={(e) => setAsin(e.target.value)}
              placeholder="e.g. B0CXXX1234"
              className="h-8 text-xs"
              required
            />
          </div>
        )}

        {type !== 'amazon-asin' && (
          <div className="space-y-1">
            <Label htmlFor="wt-url" className="text-xs">
              URL
            </Label>
            <Input
              id="wt-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.lego.com/en-ca/product/..."
              className="h-8 text-xs"
              required
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="wt-alert-on" className="text-xs">
              Alert On
            </Label>
            <Select value={alertOn} onValueChange={(v) => setAlertOn(v as typeof alertOn)}>
              <SelectTrigger id="wt-alert-on" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in_stock">In Stock</SelectItem>
                <SelectItem value="price_drop">Price Drop</SelectItem>
                <SelectItem value="any_change">Any Change</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="wt-interval" className="text-xs">
              Interval
            </Label>
            <Select value={intervalMin} onValueChange={setIntervalMin}>
              <SelectTrigger id="wt-interval" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5 min</SelectItem>
                <SelectItem value="10">10 min</SelectItem>
                <SelectItem value="15">15 min</SelectItem>
                <SelectItem value="30">30 min</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {alertOn === 'price_drop' && (
          <div className="space-y-1">
            <Label htmlFor="wt-threshold" className="text-xs">
              Threshold Price ($)
            </Label>
            <Input
              id="wt-threshold"
              type="number"
              step="0.01"
              min="0"
              value={thresholdPrice}
              onChange={(e) => setThresholdPrice(e.target.value)}
              placeholder="e.g. 49.99"
              className="h-8 text-xs"
              required
            />
          </div>
        )}

        {type === 'generic-url' && (
          <div className="space-y-1">
            <Label htmlFor="wt-notes" className="text-xs">
              Match Pattern
            </Label>
            <Input
              id="wt-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="MATCH:Add to Cart or ABSENT:Sold Out"
              className="h-8 text-xs"
            />
            <p className="text-xs text-[var(--color-text-muted)]">
              MATCH:text — alert when found. ABSENT:text — alert when missing.
            </p>
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end">
          <Button type="submit" size="sm" className="text-xs" disabled={saving}>
            {saving ? 'Adding…' : 'Add Target'}
          </Button>
        </div>
      </form>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function DealWatchClient({ initialTargets, initialEvents }: Props) {
  const [targets, setTargets] = useState<WatchTarget[]>(initialTargets)
  const [events] = useState<WatchEvent[]>(initialEvents)
  const [actionError, setActionError] = useState<string | null>(null)

  function handleAdded(target: WatchTarget) {
    setTargets((prev) => [target, ...prev])
  }

  async function handleTogglePause(target: WatchTarget) {
    setActionError(null)
    try {
      const res = await fetch(`/api/deal-watch/targets/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !target.is_active }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { target: updated } = (await res.json()) as { target: WatchTarget }
      setTargets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleDelete(id: string) {
    setActionError(null)
    try {
      const res = await fetch(`/api/deal-watch/targets/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setTargets((prev) => prev.filter((t) => t.id !== id))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  const activeCount = targets.filter((t) => t.is_active).length

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Deal Watch</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            {activeCount} active target{activeCount !== 1 ? 's' : ''} — alerts via Telegram
          </p>
        </div>
      </div>

      {/* Add Target Form */}
      <AddTargetForm onAdded={handleAdded} />

      {actionError && (
        <p className="rounded border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-300">
          {actionError}
        </p>
      )}

      {/* Watch Targets Table */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-cockpit-surface)]">
        <div className="border-b border-[var(--color-border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Watch Targets</h2>
        </div>
        {targets.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
            No targets yet. Use the form above to start watching.
          </p>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {targets.map((target) => (
              <div key={target.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-[var(--color-text-primary)]">
                      {target.name}
                    </span>
                    <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-xs text-[var(--color-text-muted)]">
                      {typeLabel(target.type)}
                    </span>
                    {statusBadge(target.last_status, target.is_active)}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-[var(--color-text-muted)]">
                    <span>
                      Alert:{' '}
                      <strong>
                        {target.alert_on === 'in_stock'
                          ? 'In Stock'
                          : target.alert_on === 'price_drop'
                            ? `Price ≤ $${target.threshold_price?.toFixed(2) ?? '?'}`
                            : 'Any Change'}
                      </strong>
                    </span>
                    <span>Every {target.check_interval_min}m</span>
                    <span>Checked {relativeTime(target.last_checked_at)}</span>
                    {target.asin && (
                      <a
                        href={`https://www.amazon.ca/dp/${target.asin}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--color-accent-gold)] hover:underline"
                      >
                        {target.asin}
                      </a>
                    )}
                    {target.url && !target.asin && (
                      <a
                        href={target.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="max-w-xs truncate text-[var(--color-accent-gold)] hover:underline"
                      >
                        {target.url}
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => handleTogglePause(target)}
                    className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                  >
                    {target.is_active ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    onClick={() => handleDelete(target.id)}
                    className="text-xs text-[var(--color-text-muted)] hover:text-red-400"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Events */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-cockpit-surface)]">
        <div className="border-b border-[var(--color-border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Recent Events</h2>
        </div>
        {events.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
            No events yet.
          </p>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {events.map((event) => (
              <div key={event.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <div className="mt-0.5 shrink-0">{eventBadge(event.event_type)}</div>
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-[var(--color-text-primary)]">
                    {event.watch_targets?.name ?? 'Unknown target'}
                  </span>
                  {event.message && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-text-muted)]">
                      {event.message}
                    </p>
                  )}
                  {event.old_value && event.new_value && (
                    <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                      {event.old_value} → {event.new_value}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-[var(--color-text-disabled)]">
                  {relativeTime(event.occurred_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
