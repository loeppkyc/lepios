'use client'

import { useCallback, useState } from 'react'
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

interface CryptoHolding {
  id: string
  user_id: string
  symbol: string
  name: string | null
  quantity: number
  avg_cost_cad: number | null
  wallet_or_exchange: string | null
  notes: string | null
  updated_at: string
  created_at: string
}

interface Props {
  initialHoldings: CryptoHolding[]
}

const BLANK_FORM = {
  symbol: '',
  name: '',
  quantity: '',
  avg_cost_cad: '',
  wallet_or_exchange: '',
  notes: '',
}

const fmtCad = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`)
const fmtQty = (n: number) => n.toFixed(8).replace(/\.?0+$/, '')

export function CryptoClient({ initialHoldings }: Props) {
  const [holdings, setHoldings] = useState<CryptoHolding[]>(initialHoldings)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<CryptoHolding | null>(null)
  const [form, setForm] = useState(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch('/api/crypto/holdings')
    const j = (await r.json()) as { holdings: CryptoHolding[]; error?: string }
    if (j.error) {
      setError(j.error)
      return
    }
    setHoldings(j.holdings)
  }, [])

  const openAdd = () => {
    setEditTarget(null)
    setForm(BLANK_FORM)
    setDialogOpen(true)
  }

  const openEdit = (h: CryptoHolding) => {
    setEditTarget(h)
    setForm({
      symbol: h.symbol,
      name: h.name ?? '',
      quantity: h.quantity.toString(),
      avg_cost_cad: h.avg_cost_cad?.toString() ?? '',
      wallet_or_exchange: h.wallet_or_exchange ?? '',
      notes: h.notes ?? '',
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.symbol.trim() || !form.quantity) {
      setError('Symbol and quantity are required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const body = {
        symbol: form.symbol.trim().toUpperCase(),
        name: form.name.trim() || null,
        quantity: parseFloat(form.quantity),
        avg_cost_cad: form.avg_cost_cad ? parseFloat(form.avg_cost_cad) : null,
        wallet_or_exchange: form.wallet_or_exchange.trim() || null,
        notes: form.notes.trim() || null,
      }
      const r = editTarget
        ? await fetch(`/api/crypto/holdings/${editTarget.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch('/api/crypto/holdings', {
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

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this holding?')) return
    await fetch(`/api/crypto/holdings/${id}`, { method: 'DELETE' })
    await load()
  }

  const totalCost = holdings.reduce(
    (sum, h) => (h.avg_cost_cad != null ? sum + h.quantity * h.avg_cost_cad : sum),
    0
  )

  return (
    <div className="mx-auto max-w-4xl px-6 py-7">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-sm font-extrabold tracking-widest text-[var(--color-text-primary)] uppercase">
            Crypto
          </h1>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Manual portfolio tracker — holdings and average cost basis. No live prices.
          </p>
        </div>
        <Button onClick={openAdd} size="sm" className="text-xs">
          + Add Holding
        </Button>
      </div>

      {error && <p className="mb-4 text-xs text-red-400">{error}</p>}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="font-mono text-xl font-bold text-[var(--color-accent-gold)]">
            {holdings.length}
          </div>
          <div className="mt-1 text-xs font-bold tracking-widest text-[var(--color-text-disabled)] uppercase">
            Holdings
          </div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="font-mono text-xl font-bold text-[var(--color-text-primary)]">
            {fmtCad(totalCost)}
          </div>
          <div className="mt-1 text-xs font-bold tracking-widest text-[var(--color-text-disabled)] uppercase">
            Total Cost Basis
          </div>
        </div>
      </div>

      {holdings.length === 0 ? (
        <p className="py-12 text-center text-xs text-[var(--color-text-disabled)]">
          No holdings tracked yet. Add one to start.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-disabled)]">
                <th className="pr-4 pb-2 font-medium">Symbol</th>
                <th className="pr-4 pb-2 font-medium">Name</th>
                <th className="pr-4 pb-2 text-right font-medium">Quantity</th>
                <th className="pr-4 pb-2 text-right font-medium">Avg Cost CAD</th>
                <th className="pr-4 pb-2 text-right font-medium">Cost Basis</th>
                <th className="pr-4 pb-2 font-medium">Where</th>
                <th className="pr-4 pb-2 font-medium">Notes</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => {
                const costBasis = h.avg_cost_cad != null ? h.quantity * h.avg_cost_cad : null
                return (
                  <tr
                    key={h.id}
                    className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                  >
                    <td className="py-2 pr-4 font-mono font-bold text-[var(--color-accent-gold)]">
                      {h.symbol}
                    </td>
                    <td className="py-2 pr-4 text-[var(--color-text-muted)]">{h.name ?? '—'}</td>
                    <td className="py-2 pr-4 text-right font-mono text-[var(--color-text-primary)]">
                      {fmtQty(h.quantity)}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono text-[var(--color-text-muted)]">
                      {fmtCad(h.avg_cost_cad)}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono text-[var(--color-text-primary)]">
                      {fmtCad(costBasis)}
                    </td>
                    <td className="py-2 pr-4 text-[var(--color-text-muted)]">
                      {h.wallet_or_exchange ?? '—'}
                    </td>
                    <td className="max-w-xs py-2 pr-4 text-[var(--color-text-disabled)]">
                      <span className="block truncate">{h.notes ?? '—'}</span>
                    </td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => openEdit(h)}
                          className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => void handleDelete(h.id)}
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit Holding' : 'Add Holding'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Symbol</Label>
                <Input
                  value={form.symbol}
                  onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value.toUpperCase() }))}
                  placeholder="e.g. BTC"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Bitcoin"
                  className="text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Quantity</Label>
                <Input
                  type="number"
                  step="any"
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                  placeholder="e.g. 0.5"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Avg Cost CAD</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={form.avg_cost_cad}
                  onChange={(e) => setForm((f) => ({ ...f, avg_cost_cad: e.target.value }))}
                  placeholder="$ per coin"
                  className="text-sm"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Wallet / Exchange</Label>
              <Input
                value={form.wallet_or_exchange}
                onChange={(e) => setForm((f) => ({ ...f, wallet_or_exchange: e.target.value }))}
                placeholder="e.g. Coinbase, Ledger"
                className="text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="resize-none text-sm"
                placeholder="Optional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Add Holding'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
