'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

interface PhonePlan {
  id: string
  carrier: string
  plan_name: string
  monthly_cost: number
  data_gb: number | null
  renewal_date: string | null
  phone_model: string | null
  phone_owner: string | null
  notes: string | null
  is_active: boolean
}

const fmt = (n: number) =>
  n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

function isRenewalSoon(dateStr: string | null): boolean {
  if (!dateStr) return false
  const diff = new Date(dateStr).getTime() - Date.now()
  return diff > 0 && diff < 60 * 24 * 60 * 60 * 1000
}

const EMPTY_FORM = {
  carrier: '',
  plan_name: '',
  monthly_cost: '',
  data_gb: '',
  renewal_date: '',
  phone_model: '',
  phone_owner: '',
  notes: '',
  is_active: true,
}

export function PhonePlansClient() {
  const [plans, setPlans] = useState<PhonePlan[]>([])
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
      const r = await fetch('/api/phone-plans')
      const j = (await r.json()) as { plans?: PhonePlan[]; error?: string }
      if (j.error) throw new Error(j.error)
      setPlans(j.plans ?? [])
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

  const openEdit = (p: PhonePlan) => {
    setEditId(p.id)
    setForm({
      carrier: p.carrier,
      plan_name: p.plan_name,
      monthly_cost: String(p.monthly_cost),
      data_gb: p.data_gb != null ? String(p.data_gb) : '',
      renewal_date: p.renewal_date ?? '',
      phone_model: p.phone_model ?? '',
      phone_owner: p.phone_owner ?? '',
      notes: p.notes ?? '',
      is_active: p.is_active,
    })
    setShowForm(true)
  }

  const submit = async () => {
    if (!form.carrier.trim()) {
      setError('Carrier is required')
      return
    }
    if (!form.plan_name.trim()) {
      setError('Plan name is required')
      return
    }
    if (!form.monthly_cost) {
      setError('Monthly cost is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const body = {
        carrier: form.carrier.trim(),
        plan_name: form.plan_name.trim(),
        monthly_cost: parseFloat(form.monthly_cost),
        data_gb: form.data_gb ? parseFloat(form.data_gb) : null,
        renewal_date: form.renewal_date || null,
        phone_model: form.phone_model.trim() || null,
        phone_owner: form.phone_owner.trim() || null,
        notes: form.notes.trim() || null,
        is_active: form.is_active,
      }
      const url = editId ? `/api/phone-plans/${editId}` : '/api/phone-plans'
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
    if (!confirm('Delete this plan?')) return
    await fetch(`/api/phone-plans/${id}`, { method: 'DELETE' })
    await load()
  }

  const activePlans = plans.filter((p) => p.is_active)
  const totalMonthly = activePlans.reduce((s, p) => s + p.monthly_cost, 0)

  return (
    <div className="mx-auto max-w-5xl px-6 py-7">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="font-heading text-foreground text-lg font-bold tracking-widest uppercase">
            Phone Plans
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Carrier plans, monthly costs, data, and renewal dates for all lines.
          </p>
        </div>
        <Button onClick={openAdd} size="sm">
          + Add Line
        </Button>
      </div>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="font-mono text-xl font-bold text-yellow-400">{fmt(totalMonthly)}</div>
            <div className="text-muted-foreground mt-1 text-xs font-bold tracking-widest uppercase">
              Total Monthly
            </div>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="text-foreground font-mono text-xl font-bold">{activePlans.length}</div>
            <div className="text-muted-foreground mt-1 text-xs font-bold tracking-widest uppercase">
              Active Lines
            </div>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="font-mono text-xl font-bold text-yellow-400">
              {fmt(totalMonthly * 12)}
            </div>
            <div className="text-muted-foreground mt-1 text-xs font-bold tracking-widest uppercase">
              Annual Cost
            </div>
          </CardContent>
        </Card>
      </div>

      {error && <p className="text-destructive mb-4 text-sm">{error}</p>}
      {loading && <p className="text-muted-foreground text-sm">Loading…</p>}

      {!loading && (
        <div className="flex flex-col gap-3">
          {plans.length === 0 && (
            <p className="text-muted-foreground py-10 text-center text-sm">
              No plans yet. Add one above.
            </p>
          )}
          {plans.map((p) => (
            <Card key={p.id} size="sm">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base">{p.carrier}</CardTitle>
                    <Badge variant="outline">{p.plan_name}</Badge>
                    {p.phone_owner && (
                      <Badge className="border-blue-500/30 bg-blue-500/20 text-blue-400">
                        {p.phone_owner}
                      </Badge>
                    )}
                    {!p.is_active && (
                      <Badge variant="outline" className="text-muted-foreground">
                        Inactive
                      </Badge>
                    )}
                    {isRenewalSoon(p.renewal_date) && (
                      <Badge className="border-yellow-500/30 bg-yellow-500/20 text-yellow-400">
                        Renews soon
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="xs" onClick={() => openEdit(p)}>
                      Edit
                    </Button>
                    <Button variant="destructive" size="xs" onClick={() => void remove(p.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-muted-foreground grid grid-cols-2 gap-x-8 gap-y-1 font-mono text-xs sm:grid-cols-4">
                  <span className="text-foreground font-semibold">{fmt(p.monthly_cost)}/mo</span>
                  {p.data_gb != null && <span>Data: {p.data_gb} GB</span>}
                  {p.phone_model && <span>Phone: {p.phone_model}</span>}
                  {p.renewal_date && <span>Renews: {p.renewal_date}</span>}
                </div>
                {p.notes && <p className="text-muted-foreground mt-2 text-xs">{p.notes}</p>}
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
              {editId ? 'Edit Plan' : 'Add Plan'}
            </h2>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">Carrier *</label>
                  <Input
                    value={form.carrier}
                    onChange={(e) => setForm((f) => ({ ...f, carrier: e.target.value }))}
                    placeholder="e.g. Koodo"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">Plan Name *</label>
                  <Input
                    value={form.plan_name}
                    onChange={(e) => setForm((f) => ({ ...f, plan_name: e.target.value }))}
                    placeholder="e.g. Canada 25GB"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">
                    Monthly Cost ($) *
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.monthly_cost}
                    onChange={(e) => setForm((f) => ({ ...f, monthly_cost: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">Data (GB)</label>
                  <Input
                    type="number"
                    step="0.1"
                    value={form.data_gb}
                    onChange={(e) => setForm((f) => ({ ...f, data_gb: e.target.value }))}
                    placeholder="e.g. 25"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">Phone Owner</label>
                  <Input
                    value={form.phone_owner}
                    onChange={(e) => setForm((f) => ({ ...f, phone_owner: e.target.value }))}
                    placeholder="e.g. Colin"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">Phone Model</label>
                  <Input
                    value={form.phone_model}
                    onChange={(e) => setForm((f) => ({ ...f, phone_model: e.target.value }))}
                    placeholder="e.g. iPhone 15"
                  />
                </div>
              </div>
              <div>
                <label className="text-muted-foreground mb-1 block text-xs">Renewal Date</label>
                <Input
                  type="date"
                  value={form.renewal_date}
                  onChange={(e) => setForm((f) => ({ ...f, renewal_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-muted-foreground mb-1 block text-xs">Notes</label>
                <Input
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="phone_active"
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                  className="border-border size-4 rounded"
                />
                <label htmlFor="phone_active" className="text-foreground text-sm">
                  Active plan
                </label>
              </div>
            </div>
            {error && <p className="text-destructive mt-3 text-sm">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} disabled={saving}>
                {saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Plan'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
