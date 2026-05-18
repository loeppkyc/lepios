'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface UtilityBill {
  id: string
  provider: string
  utility_type: string
  monthly_avg: number | null
  last_bill_amount: number | null
  last_bill_date: string | null
  auto_pay: boolean
  account_number: string | null
  notes: string | null
}

const UTILITY_TYPES = ['electricity', 'gas', 'water', 'internet', 'cable', 'trash', 'other']

const TYPE_COLORS: Record<string, string> = {
  electricity: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  gas: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  water: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  internet: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  cable: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  trash: 'bg-green-500/20 text-green-400 border-green-500/30',
  other: 'bg-muted text-muted-foreground border-border',
}

const fmt = (n: number) =>
  n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

const EMPTY_FORM = {
  provider: '',
  utility_type: 'electricity',
  monthly_avg: '',
  last_bill_amount: '',
  last_bill_date: '',
  auto_pay: false,
  account_number: '',
  notes: '',
}

export function UtilitiesClient() {
  const [bills, setBills] = useState<UtilityBill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/utilities/bills')
      const j = (await r.json()) as { bills?: UtilityBill[]; error?: string }
      if (j.error) throw new Error(j.error)
      setBills(j.bills ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const openAdd = () => {
    setEditId(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  const openEdit = (b: UtilityBill) => {
    setEditId(b.id)
    setForm({
      provider: b.provider,
      utility_type: b.utility_type,
      monthly_avg: b.monthly_avg != null ? String(b.monthly_avg) : '',
      last_bill_amount: b.last_bill_amount != null ? String(b.last_bill_amount) : '',
      last_bill_date: b.last_bill_date ?? '',
      auto_pay: b.auto_pay,
      account_number: b.account_number ?? '',
      notes: b.notes ?? '',
    })
    setShowForm(true)
  }

  const submit = async () => {
    if (!form.provider.trim()) {
      setError('Provider is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const body = {
        provider: form.provider.trim(),
        utility_type: form.utility_type,
        monthly_avg: form.monthly_avg ? parseFloat(form.monthly_avg) : null,
        last_bill_amount: form.last_bill_amount ? parseFloat(form.last_bill_amount) : null,
        last_bill_date: form.last_bill_date || null,
        auto_pay: form.auto_pay,
        account_number: form.account_number.trim() || null,
        notes: form.notes.trim() || null,
      }
      const url = editId ? `/api/utilities/bills/${editId}` : '/api/utilities/bills'
      const method = editId ? 'PATCH' : 'POST'
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      setShowForm(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this utility?')) return
    await fetch(`/api/utilities/bills/${id}`, { method: 'DELETE' })
    await load()
  }

  const monthlyTotal = bills.reduce((s, b) => s + (b.monthly_avg ?? 0), 0)

  return (
    <div className="mx-auto max-w-5xl px-6 py-7">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="font-heading text-foreground text-lg font-bold tracking-widest uppercase">
            Utilities
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Monthly utility bills, auto-pay status, and last bill tracking.
          </p>
        </div>
        <Button onClick={openAdd} size="sm">
          + Add Utility
        </Button>
      </div>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="font-mono text-xl font-bold text-yellow-400">{fmt(monthlyTotal)}</div>
            <div className="text-muted-foreground mt-1 text-xs font-bold tracking-widest uppercase">
              Monthly Total
            </div>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="font-mono text-xl font-bold text-yellow-400">
              {fmt(monthlyTotal * 12)}
            </div>
            <div className="text-muted-foreground mt-1 text-xs font-bold tracking-widest uppercase">
              Annual Total
            </div>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="text-foreground font-mono text-xl font-bold">{bills.length}</div>
            <div className="text-muted-foreground mt-1 text-xs font-bold tracking-widest uppercase">
              Utilities
            </div>
          </CardContent>
        </Card>
      </div>

      {error && <p className="text-destructive mb-4 text-sm">{error}</p>}
      {loading && <p className="text-muted-foreground text-sm">Loading…</p>}

      {!loading && (
        <div className="flex flex-col gap-3">
          {bills.length === 0 && (
            <p className="text-muted-foreground py-10 text-center text-sm">
              No utilities yet. Add one above.
            </p>
          )}
          {bills.map((b) => (
            <Card key={b.id} size="sm">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base">{b.provider}</CardTitle>
                    <Badge className={TYPE_COLORS[b.utility_type] ?? TYPE_COLORS.other}>
                      {b.utility_type}
                    </Badge>
                    {b.auto_pay && (
                      <Badge className="border-green-500/30 bg-green-500/20 text-green-400">
                        Auto-Pay
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="xs" onClick={() => openEdit(b)}>
                      Edit
                    </Button>
                    <Button variant="destructive" size="xs" onClick={() => void remove(b.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-muted-foreground grid grid-cols-2 gap-x-8 gap-y-1 font-mono text-xs sm:grid-cols-4">
                  {b.monthly_avg != null && (
                    <span>
                      Avg/mo: <span className="text-foreground">{fmt(b.monthly_avg)}</span>
                    </span>
                  )}
                  {b.last_bill_amount != null && <span>Last bill: {fmt(b.last_bill_amount)}</span>}
                  {b.last_bill_date && <span>Bill date: {b.last_bill_date}</span>}
                  {b.account_number && <span>Acct: {b.account_number}</span>}
                </div>
                {b.notes && <p className="text-muted-foreground mt-2 text-xs">{b.notes}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="border-border bg-card w-full max-w-lg rounded-xl border p-6 shadow-xl">
            <h2 className="font-heading text-foreground mb-4 text-base font-semibold">
              {editId ? 'Edit Utility' : 'Add Utility'}
            </h2>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">Provider *</label>
                  <Input
                    value={form.provider}
                    onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                    placeholder="e.g. Epcor"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">Type *</label>
                  <Select
                    value={form.utility_type}
                    onValueChange={(v) => setForm((f) => ({ ...f, utility_type: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UTILITY_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">
                    Monthly Avg ($)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.monthly_avg}
                    onChange={(e) => setForm((f) => ({ ...f, monthly_avg: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">
                    Last Bill Amount ($)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.last_bill_amount}
                    onChange={(e) => setForm((f) => ({ ...f, last_bill_amount: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">Last Bill Date</label>
                  <Input
                    type="date"
                    value={form.last_bill_date}
                    onChange={(e) => setForm((f) => ({ ...f, last_bill_date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">Account Number</label>
                  <Input
                    value={form.account_number}
                    onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))}
                    placeholder="Optional"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="auto_pay"
                  checked={form.auto_pay}
                  onChange={(e) => setForm((f) => ({ ...f, auto_pay: e.target.checked }))}
                  className="border-border size-4 rounded"
                />
                <label htmlFor="auto_pay" className="text-foreground text-sm">
                  Auto-pay enabled
                </label>
              </div>
              <div>
                <label className="text-muted-foreground mb-1 block text-xs">Notes</label>
                <Input
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
            </div>
            {error && <p className="text-destructive mt-3 text-sm">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} disabled={saving}>
                {saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Utility'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
