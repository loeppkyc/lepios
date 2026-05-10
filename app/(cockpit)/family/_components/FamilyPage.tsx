'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { CleaningClient, CoraActivity, FamilyDate, FamilyResponse } from '@/lib/family/types'

const FREQ_MULTI: Record<string, number> = {
  Weekly: 4.33,
  Biweekly: 2.17,
  Monthly: 1.0,
  'One-time': 0.0,
}

function fmt(n: number) {
  return `$${Math.round(n).toLocaleString('en-CA')}`
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border-border rounded-md border bg-[var(--color-cockpit-surface)] px-4 py-3">
      <p className="text-xs text-[var(--color-text-secondary)]">{label}</p>
      <p className="mt-1 text-xl font-bold text-[var(--color-text-primary)]">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{sub}</p>}
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
      {children}
    </p>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-[var(--color-text-secondary)]">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'border-border w-full rounded-md border bg-[var(--color-cockpit-surface)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-gold)]'
const selectCls = 'border-border w-full rounded-md border bg-[var(--color-cockpit-surface)] px-2 py-1.5 text-xs text-[var(--color-text-primary)]'

export function FamilyPage() {
  const [data, setData] = useState<FamilyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [colinIncome, setColinIncome] = useState(0)

  const [addClientOpen, setAddClientOpen] = useState(false)
  const [addActivityOpen, setAddActivityOpen] = useState(false)
  const [addDateOpen, setAddDateOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [clientForm, setClientForm] = useState({ name: '', address: '', frequency: 'Weekly', rate: '', notes: '' })
  const [actForm, setActForm] = useState({ name: '', day_of_week: 'Monday', time_of_day: '', monthly_cost: '', notes: '' })
  const [dateForm, setDateForm] = useState({ event: '', date: '', recurring: 'false', notes: '' })

  useEffect(() => {
    fetch('/api/family')
      .then((r) => r.json())
      .then((d: FamilyResponse & { error?: string }) => {
        if (d.error) setError(d.error)
        else setData(d)
        setLoading(false)
      })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [])

  if (loading) return <div className="p-8 text-sm text-[var(--color-text-secondary)]">Loading…</div>
  if (error || !data) return <div className="p-8 text-sm text-red-400">{error ?? 'Failed to load'}</div>

  const activeClients = data.clients.filter((c) => c.status === 'Active')
  const meganIncome = activeClients.reduce((sum, c) => sum + c.rate * (FREQ_MULTI[c.frequency] ?? 0), 0)
  const activeActCost = data.activities.filter((a) => a.active).reduce((sum, a) => sum + a.monthly_cost, 0)
  const surplus = colinIncome + meganIncome - data.household_monthly - activeActCost

  async function addClient(e: React.FormEvent) {
    e.preventDefault()
    if (!clientForm.name.trim()) return
    setSaving(true)
    const res = await fetch('/api/family', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'client', data: { ...clientForm, rate: parseFloat(clientForm.rate) || 0 } }),
    })
    const row = await res.json() as CleaningClient
    setData((d) => d ? { ...d, clients: [...d.clients, row] } : d)
    setClientForm({ name: '', address: '', frequency: 'Weekly', rate: '', notes: '' })
    setSaving(false)
    setAddClientOpen(false)
  }

  async function addActivity(e: React.FormEvent) {
    e.preventDefault()
    if (!actForm.name.trim()) return
    setSaving(true)
    const res = await fetch('/api/family', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'activity', data: { ...actForm, monthly_cost: parseFloat(actForm.monthly_cost) || 0 } }),
    })
    const row = await res.json() as CoraActivity
    setData((d) => d ? { ...d, activities: [...d.activities, row] } : d)
    setActForm({ name: '', day_of_week: 'Monday', time_of_day: '', monthly_cost: '', notes: '' })
    setSaving(false)
    setAddActivityOpen(false)
  }

  async function addDate(e: React.FormEvent) {
    e.preventDefault()
    if (!dateForm.event.trim() || !dateForm.date) return
    setSaving(true)
    const res = await fetch('/api/family', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'date', data: { ...dateForm, recurring: dateForm.recurring === 'true' } }),
    })
    const row = await res.json() as FamilyDate
    setData((d) => d ? { ...d, dates: [...d.dates, row].sort((a, b) => a.date.localeCompare(b.date)) } : d)
    setDateForm({ event: '', date: '', recurring: 'false', notes: '' })
    setSaving(false)
    setAddDateOpen(false)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <div>
        <h1 className="mb-1 text-2xl font-bold text-[var(--color-text-primary)]">Family</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">Colin, Megan & Cora</p>
      </div>

      {/* Family Overview */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { name: 'Colin', sub: 'Amazon FBA · Trading · Building the OS' },
          { name: 'Megan', sub: 'Cleaning Business · Superhero Mom' },
          { name: 'Cora (11)', sub: 'Roblox · Ninja · Style Queen' },
        ].map((p) => (
          <div key={p.name} className="border-border rounded-md border bg-[var(--color-cockpit-surface)] px-4 py-4 text-center">
            <p className="text-lg font-bold text-[var(--color-accent-gold)]">{p.name}</p>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{p.sub}</p>
          </div>
        ))}
      </div>

      {/* Megan's Cleaning Business */}
      <section>
        <SectionHeader>Megan&apos;s Cleaning Business</SectionHeader>
        <div className="mb-4 max-w-xs">
          <StatCard
            label="Est. Monthly Income"
            value={fmt(meganIncome)}
            sub={`${activeClients.length} active client${activeClients.length !== 1 ? 's' : ''}`}
          />
        </div>
        {data.clients.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-[var(--color-text-secondary)]">
                <th className="pb-2 pr-4">Client</th>
                <th className="pb-2 pr-4">Frequency</th>
                <th className="pb-2 pr-4">Rate</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {data.clients.map((c) => (
                <tr key={c.id} className="border-b border-border/40">
                  <td className="py-2 pr-4 text-[var(--color-text-primary)]">
                    {c.name}
                    {c.address && <span className="ml-1 text-xs text-[var(--color-text-secondary)]">({c.address})</span>}
                  </td>
                  <td className="py-2 pr-4 text-[var(--color-text-secondary)]">{c.frequency}</td>
                  <td className="py-2 pr-4 text-[var(--color-text-primary)]">{fmt(c.rate)}</td>
                  <td className="py-2 pr-4 text-[var(--color-text-secondary)]">{c.status}</td>
                  <td className="py-2 text-xs text-[var(--color-text-secondary)]">{c.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setAddClientOpen((o) => !o)}>
          {addClientOpen ? 'Cancel' : '+ Add Client'}
        </Button>
        {addClientOpen && (
          <form onSubmit={addClient} className="border-border mt-2 rounded-md border p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Client Name *"><input className={inputCls} value={clientForm.name} onChange={(e) => setClientForm((f) => ({ ...f, name: e.target.value }))} required /></FieldRow>
              <FieldRow label="Address"><input className={inputCls} value={clientForm.address} onChange={(e) => setClientForm((f) => ({ ...f, address: e.target.value }))} /></FieldRow>
              <FieldRow label="Frequency">
                <select className={selectCls} value={clientForm.frequency} onChange={(e) => setClientForm((f) => ({ ...f, frequency: e.target.value }))}>
                  {Object.keys(FREQ_MULTI).map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="Rate per Clean ($)"><input className={inputCls} type="number" min={0} step={10} value={clientForm.rate} onChange={(e) => setClientForm((f) => ({ ...f, rate: e.target.value }))} /></FieldRow>
              <div className="col-span-2"><FieldRow label="Notes"><input className={inputCls} value={clientForm.notes} onChange={(e) => setClientForm((f) => ({ ...f, notes: e.target.value }))} /></FieldRow></div>
            </div>
            <Button type="submit" size="sm" disabled={saving}>Add Client</Button>
          </form>
        )}
      </section>

      {/* Cora's Corner */}
      <section>
        <SectionHeader>Cora&apos;s Corner</SectionHeader>
        <div className="mb-4 max-w-xs">
          <StatCard
            label="Monthly Activity Cost"
            value={fmt(activeActCost)}
            sub={`${data.activities.filter((a) => a.active).length} active`}
          />
        </div>
        {data.activities.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-[var(--color-text-secondary)]">
                <th className="pb-2 pr-4">Activity</th>
                <th className="pb-2 pr-4">Day</th>
                <th className="pb-2 pr-4">Time</th>
                <th className="pb-2 pr-4">Monthly Cost</th>
                <th className="pb-2">Active</th>
              </tr>
            </thead>
            <tbody>
              {data.activities.map((a) => (
                <tr key={a.id} className="border-b border-border/40">
                  <td className="py-2 pr-4 text-[var(--color-text-primary)]">{a.name}</td>
                  <td className="py-2 pr-4 text-[var(--color-text-secondary)]">{a.day_of_week ?? '—'}</td>
                  <td className="py-2 pr-4 text-[var(--color-text-secondary)]">{a.time_of_day ?? '—'}</td>
                  <td className="py-2 pr-4 text-[var(--color-text-primary)]">{fmt(a.monthly_cost)}</td>
                  <td className="py-2 text-[var(--color-text-secondary)]">{a.active ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setAddActivityOpen((o) => !o)}>
          {addActivityOpen ? 'Cancel' : '+ Add Activity'}
        </Button>
        {addActivityOpen && (
          <form onSubmit={addActivity} className="border-border mt-2 rounded-md border p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Activity Name *"><input className={inputCls} value={actForm.name} onChange={(e) => setActForm((f) => ({ ...f, name: e.target.value }))} required /></FieldRow>
              <FieldRow label="Day of Week">
                <select className={selectCls} value={actForm.day_of_week} onChange={(e) => setActForm((f) => ({ ...f, day_of_week: e.target.value }))}>
                  {['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="Time (e.g. 4:00 PM)"><input className={inputCls} value={actForm.time_of_day} onChange={(e) => setActForm((f) => ({ ...f, time_of_day: e.target.value }))} /></FieldRow>
              <FieldRow label="Monthly Cost ($)"><input className={inputCls} type="number" min={0} step={5} value={actForm.monthly_cost} onChange={(e) => setActForm((f) => ({ ...f, monthly_cost: e.target.value }))} /></FieldRow>
              <div className="col-span-2"><FieldRow label="Notes"><input className={inputCls} value={actForm.notes} onChange={(e) => setActForm((f) => ({ ...f, notes: e.target.value }))} /></FieldRow></div>
            </div>
            <Button type="submit" size="sm" disabled={saving}>Add Activity</Button>
          </form>
        )}
      </section>

      {/* Family Budget Summary */}
      <section>
        <SectionHeader>Family Budget Summary</SectionHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="border-border rounded-md border bg-[var(--color-cockpit-surface)] px-4 py-3">
            <p className="text-xs text-[var(--color-text-secondary)]">Colin&apos;s Monthly Income</p>
            <input
              type="number"
              min={0}
              step={500}
              value={colinIncome}
              onChange={(e) => setColinIncome(parseFloat(e.target.value) || 0)}
              className="mt-1 w-full bg-transparent text-xl font-bold text-[var(--color-text-primary)] focus:outline-none"
            />
          </div>
          <StatCard label="Megan's Est. Income" value={fmt(meganIncome)} />
          <StatCard
            label="Household Expenses"
            value={fmt(data.household_monthly)}
            sub={data.household_source === 'recurring' ? 'from recurring' : 'hardcoded'}
          />
          <div className="border-border rounded-md border bg-[var(--color-cockpit-surface)] px-4 py-3">
            <p className="text-xs text-[var(--color-text-secondary)]">Monthly Surplus / Deficit</p>
            <p className={`mt-1 text-xl font-bold ${surplus >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmt(surplus)}</p>
            <p className={`mt-0.5 text-xs ${surplus >= 0 ? 'text-green-400' : 'text-red-400'}`}>{surplus >= 0 ? 'Surplus' : 'Deficit'}</p>
          </div>
        </div>
      </section>

      {/* Important Dates */}
      <section>
        <SectionHeader>Important Dates</SectionHeader>
        {data.dates.length > 0 && (
          <table className="mb-3 w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-[var(--color-text-secondary)]">
                <th className="pb-2 pr-4">Event</th>
                <th className="pb-2 pr-4">Date</th>
                <th className="pb-2 pr-4">Recurring</th>
                <th className="pb-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {data.dates.map((d) => (
                <tr key={d.id} className="border-b border-border/40">
                  <td className="py-2 pr-4 text-[var(--color-text-primary)]">{d.event}</td>
                  <td className="py-2 pr-4 text-[var(--color-text-secondary)]">{d.date}</td>
                  <td className="py-2 pr-4 text-[var(--color-text-secondary)]">{d.recurring ? 'Yes' : 'No'}</td>
                  <td className="py-2 text-xs text-[var(--color-text-secondary)]">{d.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Button variant="outline" size="sm" onClick={() => setAddDateOpen((o) => !o)}>
          {addDateOpen ? 'Cancel' : '+ Add Date'}
        </Button>
        {addDateOpen && (
          <form onSubmit={addDate} className="border-border mt-2 rounded-md border p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Event *"><input className={inputCls} value={dateForm.event} onChange={(e) => setDateForm((f) => ({ ...f, event: e.target.value }))} required /></FieldRow>
              <FieldRow label="Date *"><input className={inputCls} type="date" value={dateForm.date} onChange={(e) => setDateForm((f) => ({ ...f, date: e.target.value }))} required /></FieldRow>
              <FieldRow label="Recurring?">
                <select className={selectCls} value={dateForm.recurring} onChange={(e) => setDateForm((f) => ({ ...f, recurring: e.target.value }))}>
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </FieldRow>
              <FieldRow label="Notes"><input className={inputCls} value={dateForm.notes} onChange={(e) => setDateForm((f) => ({ ...f, notes: e.target.value }))} /></FieldRow>
            </div>
            <Button type="submit" size="sm" disabled={saving}>Add Date</Button>
          </form>
        )}
      </section>
    </div>
  )
}
