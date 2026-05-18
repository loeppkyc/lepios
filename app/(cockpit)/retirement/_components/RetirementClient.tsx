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

interface RetirementAccount {
  id: string
  account_name: string
  provider: string
  account_type: string
  balance: number
  annual_contribution: number | null
  employer_match_pct: number | null
  target_retirement_age: number | null
  notes: string | null
}

const ACCOUNT_TYPES = ['RRSP', 'TFSA', 'LIRA', 'RESP', 'Pension', '401k', 'IRA', 'other']

const TYPE_COLORS: Record<string, string> = {
  RRSP: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  TFSA: 'bg-green-500/20 text-green-400 border-green-500/30',
  LIRA: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  RESP: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  Pension: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  '401k': 'bg-red-500/20 text-red-400 border-red-500/30',
  IRA: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  other: 'bg-muted text-muted-foreground border-border',
}

const fmt = (n: number) =>
  n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

const fmtPrecise = (n: number) =>
  n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

/** Compound growth projection: FV = PV*(1+r)^n + PMT*((1+r)^n - 1)/r */
function projectBalance(
  balance: number,
  annualContribution: number | null,
  yearsToRetirement: number,
  rate = 0.06
): number {
  if (yearsToRetirement <= 0) return balance
  const pmt = annualContribution ?? 0
  const r = rate
  const n = yearsToRetirement
  const growth = Math.pow(1 + r, n)
  return balance * growth + (pmt * (growth - 1)) / r
}

const EMPTY_FORM = {
  account_name: '',
  provider: '',
  account_type: 'RRSP',
  balance: '',
  annual_contribution: '',
  employer_match_pct: '',
  target_retirement_age: '',
  notes: '',
}

export function RetirementClient() {
  const [accounts, setAccounts] = useState<RetirementAccount[]>([])
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
      const r = await fetch('/api/retirement/accounts')
      const j = (await r.json()) as { accounts?: RetirementAccount[]; error?: string }
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

  const openEdit = (a: RetirementAccount) => {
    setEditId(a.id)
    setForm({
      account_name: a.account_name,
      provider: a.provider,
      account_type: a.account_type,
      balance: String(a.balance),
      annual_contribution: a.annual_contribution != null ? String(a.annual_contribution) : '',
      employer_match_pct: a.employer_match_pct != null ? String(a.employer_match_pct) : '',
      target_retirement_age: a.target_retirement_age != null ? String(a.target_retirement_age) : '',
      notes: a.notes ?? '',
    })
    setShowForm(true)
  }

  const submit = async () => {
    if (!form.account_name.trim()) {
      setError('Account name is required')
      return
    }
    if (!form.provider.trim()) {
      setError('Provider is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const body = {
        account_name: form.account_name.trim(),
        provider: form.provider.trim(),
        account_type: form.account_type,
        balance: parseFloat(form.balance || '0'),
        annual_contribution: form.annual_contribution ? parseFloat(form.annual_contribution) : null,
        employer_match_pct: form.employer_match_pct ? parseFloat(form.employer_match_pct) : null,
        target_retirement_age: form.target_retirement_age
          ? parseInt(form.target_retirement_age)
          : null,
        notes: form.notes.trim() || null,
      }
      const url = editId ? `/api/retirement/accounts/${editId}` : '/api/retirement/accounts'
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
    if (!confirm('Delete this account?')) return
    await fetch(`/api/retirement/accounts/${id}`, { method: 'DELETE' })
    await load()
  }

  const totalBalance = accounts.reduce((s, a) => s + a.balance, 0)
  const totalAnnualContrib = accounts.reduce((s, a) => s + (a.annual_contribution ?? 0), 0)

  // Use the most common target retirement age across accounts
  const targetAges = accounts
    .map((a) => a.target_retirement_age)
    .filter((v): v is number => v != null)
  const medianTarget = targetAges.length > 0 ? targetAges[Math.floor(targetAges.length / 2)] : 65
  const currentAge = 33 // placeholder — typical; will show in projection
  const yearsToRetirement = Math.max(0, medianTarget - currentAge)

  const projectedTotal = accounts.reduce((s, a) => {
    const years =
      a.target_retirement_age != null
        ? Math.max(0, a.target_retirement_age - currentAge)
        : yearsToRetirement
    return s + projectBalance(a.balance, a.annual_contribution, years)
  }, 0)

  return (
    <div className="mx-auto max-w-5xl px-6 py-7">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="font-heading text-foreground text-lg font-bold tracking-widest uppercase">
            Retirement
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Portfolio balance, contributions, and 6% compound growth projections.
          </p>
        </div>
        <Button onClick={openAdd} size="sm">
          + Add Account
        </Button>
      </div>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="font-mono text-xl font-bold text-yellow-400">{fmt(totalBalance)}</div>
            <div className="text-muted-foreground mt-1 text-xs font-bold tracking-widest uppercase">
              Total Balance
            </div>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="font-mono text-xl font-bold text-green-400">{fmt(projectedTotal)}</div>
            <div className="text-muted-foreground mt-1 text-xs font-bold tracking-widest uppercase">
              Projected at Retirement
            </div>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="text-foreground font-mono text-xl font-bold">
              {fmt(totalAnnualContrib)}
            </div>
            <div className="text-muted-foreground mt-1 text-xs font-bold tracking-widest uppercase">
              Annual Contributions
            </div>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="pt-3">
            <div className="text-foreground font-mono text-xl font-bold">{accounts.length}</div>
            <div className="text-muted-foreground mt-1 text-xs font-bold tracking-widest uppercase">
              Accounts
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
              No accounts yet. Add one above.
            </p>
          )}
          {accounts.map((a) => {
            const years =
              a.target_retirement_age != null
                ? Math.max(0, a.target_retirement_age - currentAge)
                : yearsToRetirement
            const projected = projectBalance(a.balance, a.annual_contribution, years)
            return (
              <Card key={a.id} size="sm">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{a.account_name}</CardTitle>
                      <Badge className={TYPE_COLORS[a.account_type] ?? TYPE_COLORS.other}>
                        {a.account_type}
                      </Badge>
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
                  <div className="text-muted-foreground grid grid-cols-2 gap-x-8 gap-y-1 font-mono text-xs sm:grid-cols-4">
                    <span className="text-foreground font-semibold">{fmtPrecise(a.balance)}</span>
                    <span>Provider: {a.provider}</span>
                    {a.annual_contribution != null && (
                      <span>Contrib/yr: {fmt(a.annual_contribution)}</span>
                    )}
                    {a.employer_match_pct != null && <span>Match: {a.employer_match_pct}%</span>}
                    {a.target_retirement_age != null && (
                      <span>Target age: {a.target_retirement_age}</span>
                    )}
                    <span className="text-green-400">Projected: {fmt(projected)}</span>
                  </div>
                  {a.notes && <p className="text-muted-foreground mt-2 text-xs">{a.notes}</p>}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="border-border bg-card w-full max-w-lg rounded-xl border p-6 shadow-xl">
            <h2 className="font-heading text-foreground mb-4 text-base font-semibold">
              {editId ? 'Edit Account' : 'Add Account'}
            </h2>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">Account Name *</label>
                  <Input
                    value={form.account_name}
                    onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))}
                    placeholder="e.g. Personal RRSP"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">Provider *</label>
                  <Input
                    value={form.provider}
                    onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                    placeholder="e.g. Questrade"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">Type *</label>
                  <Select
                    value={form.account_type}
                    onValueChange={(v) => setForm((f) => ({ ...f, account_type: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">
                    Current Balance ($)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.balance}
                    onChange={(e) => setForm((f) => ({ ...f, balance: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">
                    Annual Contribution ($)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.annual_contribution}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, annual_contribution: e.target.value }))
                    }
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">
                    Employer Match (%)
                  </label>
                  <Input
                    type="number"
                    step="0.1"
                    value={form.employer_match_pct}
                    onChange={(e) => setForm((f) => ({ ...f, employer_match_pct: e.target.value }))}
                    placeholder="0.0"
                  />
                </div>
              </div>
              <div>
                <label className="text-muted-foreground mb-1 block text-xs">
                  Target Retirement Age
                </label>
                <Input
                  type="number"
                  value={form.target_retirement_age}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, target_retirement_age: e.target.value }))
                  }
                  placeholder="65"
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
            </div>
            {error && <p className="text-destructive mt-3 text-sm">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} disabled={saving}>
                {saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Account'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
