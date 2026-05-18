'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

interface CashbackAccount {
  id: string
  card_name: string
  portal: string | null
  cashback_rate_pct: number
  pending_balance: number
  total_earned_ytd: number
  notes: string | null
}

const fmt = (n: number) =>
  n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

const EMPTY_FORM = {
  card_name: '',
  portal: '',
  cashback_rate_pct: '',
  pending_balance: '',
  total_earned_ytd: '',
  notes: '',
}

export function CashbackClient() {
  const [accounts, setAccounts] = useState<CashbackAccount[]>([])
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
      const r = await fetch('/api/cashback/accounts')
      const j = (await r.json()) as { accounts?: CashbackAccount[]; error?: string }
      if (j.error) throw new Error(j.error)
      setAccounts(j.accounts ?? [])
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

  const openEdit = (a: CashbackAccount) => {
    setEditId(a.id)
    setForm({
      card_name: a.card_name,
      portal: a.portal ?? '',
      cashback_rate_pct: String(a.cashback_rate_pct),
      pending_balance: String(a.pending_balance),
      total_earned_ytd: String(a.total_earned_ytd),
      notes: a.notes ?? '',
    })
    setShowForm(true)
  }

  const submit = async () => {
    if (!form.card_name.trim()) {
      setError('Card name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const body = {
        card_name: form.card_name.trim(),
        portal: form.portal.trim() || null,
        cashback_rate_pct: parseFloat(form.cashback_rate_pct || '0'),
        pending_balance: parseFloat(form.pending_balance || '0'),
        total_earned_ytd: parseFloat(form.total_earned_ytd || '0'),
        notes: form.notes.trim() || null,
      }
      const url = editId ? `/api/cashback/accounts/${editId}` : '/api/cashback/accounts'
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
    if (!confirm('Delete this cashback account?')) return
    await fetch(`/api/cashback/accounts/${id}`, { method: 'DELETE' })
    await load()
  }

  const totalPending = accounts.reduce((s, a) => s + a.pending_balance, 0)
  const totalYtd = accounts.reduce((s, a) => s + a.total_earned_ytd, 0)

  return (
    <div className="mx-auto max-w-5xl px-6 py-7">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="font-heading text-foreground text-lg font-bold tracking-widest uppercase">
            Cashback HQ
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Track cashback rate, pending balance, and YTD earnings per card.
          </p>
        </div>
        <Button onClick={openAdd} size="sm">
          + Add Card
        </Button>
      </div>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="font-mono text-xl font-bold text-green-400">{fmt(totalPending)}</div>
            <div className="text-muted-foreground mt-1 text-xs font-bold tracking-widest uppercase">
              Pending Balance
            </div>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="font-mono text-xl font-bold text-yellow-400">{fmt(totalYtd)}</div>
            <div className="text-muted-foreground mt-1 text-xs font-bold tracking-widest uppercase">
              Earned YTD
            </div>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="text-foreground font-mono text-xl font-bold">{accounts.length}</div>
            <div className="text-muted-foreground mt-1 text-xs font-bold tracking-widest uppercase">
              Cards Tracked
            </div>
          </CardContent>
        </Card>
      </div>

      {error && <p className="text-destructive mb-4 text-sm">{error}</p>}
      {loading && <p className="text-muted-foreground text-sm">Loading…</p>}

      {!loading && (
        <div className="flex flex-col gap-3">
          {accounts.length === 0 && (
            <p className="text-muted-foreground py-10 text-center text-sm">
              No cards yet. Add one above.
            </p>
          )}
          {accounts.map((a) => (
            <Card key={a.id} size="sm">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base">{a.card_name}</CardTitle>
                    {a.portal && (
                      <span className="border-border bg-muted/40 text-muted-foreground rounded-md border px-2 py-0.5 font-mono text-xs">
                        {a.portal}
                      </span>
                    )}
                    <span className="rounded-md border border-green-500/30 bg-green-500/10 px-2 py-0.5 font-mono text-xs text-green-400">
                      {a.cashback_rate_pct}%
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="xs" onClick={() => openEdit(a)}>
                      Edit
                    </Button>
                    <Button variant="destructive" size="xs" onClick={() => void remove(a.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-x-8 gap-y-1 font-mono text-xs sm:grid-cols-3">
                  <span>
                    <span className="text-muted-foreground">Pending: </span>
                    <span className="font-semibold text-green-400">{fmt(a.pending_balance)}</span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">YTD: </span>
                    <span className="font-semibold text-yellow-400">{fmt(a.total_earned_ytd)}</span>
                  </span>
                </div>
                {a.notes && <p className="text-muted-foreground mt-2 text-xs">{a.notes}</p>}
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
              {editId ? 'Edit Card' : 'Add Card'}
            </h2>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">Card Name *</label>
                  <Input
                    value={form.card_name}
                    onChange={(e) => setForm((f) => ({ ...f, card_name: e.target.value }))}
                    placeholder="e.g. CT Triangle World Elite"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">
                    Portal / Program
                  </label>
                  <Input
                    value={form.portal}
                    onChange={(e) => setForm((f) => ({ ...f, portal: e.target.value }))}
                    placeholder="e.g. Canadian Tire Money"
                  />
                </div>
              </div>
              <div>
                <label className="text-muted-foreground mb-1 block text-xs">
                  Cashback Rate (%)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.cashback_rate_pct}
                  onChange={(e) => setForm((f) => ({ ...f, cashback_rate_pct: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">
                    Pending Balance ($)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.pending_balance}
                    onChange={(e) => setForm((f) => ({ ...f, pending_balance: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">
                    Total Earned YTD ($)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.total_earned_ytd}
                    onChange={(e) => setForm((f) => ({ ...f, total_earned_ytd: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
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
                {saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Card'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
