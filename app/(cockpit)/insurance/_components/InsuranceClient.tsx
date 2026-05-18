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

interface InsurancePolicy {
  id: string
  provider: string
  policy_type: string
  policy_number: string | null
  premium_monthly: number | null
  premium_annual: number | null
  renewal_date: string | null
  coverage_amount: number | null
  notes: string | null
  is_active: boolean
}

const POLICY_TYPES = ['auto', 'home', 'life', 'health', 'dental', 'disability', 'umbrella', 'other']

const TYPE_COLORS: Record<string, string> = {
  auto: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  home: 'bg-green-500/20 text-green-400 border-green-500/30',
  life: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  health: 'bg-red-500/20 text-red-400 border-red-500/30',
  dental: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  disability: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  umbrella: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  other: 'bg-muted text-muted-foreground border-border',
}

const fmt = (n: number) =>
  n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

function isRenewalSoon(dateStr: string | null): boolean {
  if (!dateStr) return false
  const diff = new Date(dateStr).getTime() - Date.now()
  return diff > 0 && diff < 60 * 24 * 60 * 60 * 1000
}

const EMPTY_FORM = {
  provider: '',
  policy_type: 'auto',
  policy_number: '',
  premium_monthly: '',
  premium_annual: '',
  renewal_date: '',
  coverage_amount: '',
  notes: '',
  is_active: true,
}

export function InsuranceClient() {
  const [policies, setPolicies] = useState<InsurancePolicy[]>([])
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
      const r = await fetch('/api/insurance/policies')
      const j = (await r.json()) as { policies?: InsurancePolicy[]; error?: string }
      if (j.error) throw new Error(j.error)
      setPolicies(j.policies ?? [])
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

  const openEdit = (p: InsurancePolicy) => {
    setEditId(p.id)
    setForm({
      provider: p.provider,
      policy_type: p.policy_type,
      policy_number: p.policy_number ?? '',
      premium_monthly: p.premium_monthly != null ? String(p.premium_monthly) : '',
      premium_annual: p.premium_annual != null ? String(p.premium_annual) : '',
      renewal_date: p.renewal_date ?? '',
      coverage_amount: p.coverage_amount != null ? String(p.coverage_amount) : '',
      notes: p.notes ?? '',
      is_active: p.is_active,
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
        policy_type: form.policy_type,
        policy_number: form.policy_number.trim() || null,
        premium_monthly: form.premium_monthly ? parseFloat(form.premium_monthly) : null,
        premium_annual: form.premium_annual ? parseFloat(form.premium_annual) : null,
        renewal_date: form.renewal_date || null,
        coverage_amount: form.coverage_amount ? parseFloat(form.coverage_amount) : null,
        notes: form.notes.trim() || null,
        is_active: form.is_active,
      }
      const url = editId ? `/api/insurance/policies/${editId}` : '/api/insurance/policies'
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
    if (!confirm('Delete this policy?')) return
    await fetch(`/api/insurance/policies/${id}`, { method: 'DELETE' })
    await load()
  }

  const totalAnnual = policies
    .filter((p) => p.is_active)
    .reduce(
      (s, p) => s + (p.premium_annual ?? (p.premium_monthly != null ? p.premium_monthly * 12 : 0)),
      0
    )

  return (
    <div className="mx-auto max-w-5xl px-6 py-7">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="font-heading text-foreground text-lg font-bold tracking-widest uppercase">
            Insurance
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Track all active policies, premiums, and renewal dates.
          </p>
        </div>
        <Button onClick={openAdd} size="sm">
          + Add Policy
        </Button>
      </div>

      {/* KPI */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="font-mono text-xl font-bold text-yellow-400">{fmt(totalAnnual)}</div>
            <div className="text-muted-foreground mt-1 text-xs font-bold tracking-widest uppercase">
              Total Annual Premium
            </div>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="font-mono text-xl font-bold text-yellow-400">
              {fmt(totalAnnual / 12)}
            </div>
            <div className="text-muted-foreground mt-1 text-xs font-bold tracking-widest uppercase">
              Monthly Cost
            </div>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="text-foreground font-mono text-xl font-bold">
              {policies.filter((p) => p.is_active).length}
            </div>
            <div className="text-muted-foreground mt-1 text-xs font-bold tracking-widest uppercase">
              Active Policies
            </div>
          </CardContent>
        </Card>
      </div>

      {error && <p className="text-destructive mb-4 text-sm">{error}</p>}
      {loading && <p className="text-muted-foreground text-sm">Loading…</p>}

      {/* Policy list */}
      {!loading && (
        <div className="flex flex-col gap-3">
          {policies.length === 0 && (
            <p className="text-muted-foreground py-10 text-center text-sm">
              No policies yet. Add one above.
            </p>
          )}
          {policies.map((p) => (
            <Card key={p.id} size="sm">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{p.provider}</CardTitle>
                    <Badge className={TYPE_COLORS[p.policy_type] ?? TYPE_COLORS.other}>
                      {p.policy_type}
                    </Badge>
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
                  {p.policy_number && <span>#{p.policy_number}</span>}
                  {p.premium_monthly != null && <span>Monthly: {fmt(p.premium_monthly)}</span>}
                  {p.premium_annual != null && <span>Annual: {fmt(p.premium_annual)}</span>}
                  {p.coverage_amount != null && <span>Coverage: {fmt(p.coverage_amount)}</span>}
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
              {editId ? 'Edit Policy' : 'Add Policy'}
            </h2>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">Provider *</label>
                  <Input
                    value={form.provider}
                    onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                    placeholder="e.g. Intact"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">Type *</label>
                  <Select
                    value={form.policy_type}
                    onValueChange={(v) => setForm((f) => ({ ...f, policy_type: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {POLICY_TYPES.map((t) => (
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
                  <label className="text-muted-foreground mb-1 block text-xs">Policy Number</label>
                  <Input
                    value={form.policy_number}
                    onChange={(e) => setForm((f) => ({ ...f, policy_number: e.target.value }))}
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">Renewal Date</label>
                  <Input
                    type="date"
                    value={form.renewal_date}
                    onChange={(e) => setForm((f) => ({ ...f, renewal_date: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">
                    Monthly Premium ($)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.premium_monthly}
                    onChange={(e) => setForm((f) => ({ ...f, premium_monthly: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">
                    Annual Premium ($)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.premium_annual}
                    onChange={(e) => setForm((f) => ({ ...f, premium_annual: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div>
                <label className="text-muted-foreground mb-1 block text-xs">
                  Coverage Amount ($)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.coverage_amount}
                  onChange={(e) => setForm((f) => ({ ...f, coverage_amount: e.target.value }))}
                  placeholder="0.00"
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
                  id="is_active"
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                  className="border-border size-4 rounded"
                />
                <label htmlFor="is_active" className="text-foreground text-sm">
                  Active policy
                </label>
              </div>
            </div>
            {error && <p className="text-destructive mt-3 text-sm">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} disabled={saving}>
                {saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Policy'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
