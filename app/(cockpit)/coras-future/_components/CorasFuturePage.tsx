'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { CoraFutureItem, CorasFutureResponse } from '@/lib/coras-future/types'

const STATUS_COLORS: Record<CoraFutureItem['status'], string> = {
  upcoming: 'bg-blue-500/20 text-blue-300',
  open: 'bg-green-500/20 text-green-300',
  applied: 'bg-violet-500/20 text-violet-300',
  accepted: 'bg-yellow-500/20 text-yellow-300',
  missed: 'bg-red-500/20 text-red-300',
  rejected: 'bg-orange-500/20 text-orange-300',
}

const TIMELINES = ['Grade 11', 'Grade 12', 'Post-secondary'] as const
const STATUSES: CoraFutureItem['status'][] = [
  'upcoming',
  'open',
  'applied',
  'accepted',
  'missed',
  'rejected',
]
const TABS = ['Programs & Scholarships', 'Deadlines', 'Notes', "Cora's World"] as const
type Tab = (typeof TABS)[number]

function daysUntil(datesText: string): number | null {
  const yearMatch = datesText.match(/\b(202\d|203\d)\b/)
  if (!yearMatch) return null
  const year = parseInt(yearMatch[1])
  const target = new Date(year, 2, 1) // March of that year
  return Math.floor((target.getTime() - Date.now()) / 86400000)
}

function DeadlinePill({ datesText }: { datesText: string | null }) {
  if (!datesText) return null
  const days = daysUntil(datesText)
  if (days === null) return null
  if (days < 0) return <span className="text-xs text-[var(--color-text-secondary)]">passed</span>
  if (days < 90)
    return (
      <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-300">{days}d</span>
    )
  if (days < 365)
    return (
      <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-300">
        {days}d
      </span>
    )
  return (
    <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs text-green-300">{days}d</span>
  )
}

function ItemCard({
  item,
  onStatusChange,
}: {
  item: CoraFutureItem
  onStatusChange: (id: string, status: CoraFutureItem['status']) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [localStatus, setLocalStatus] = useState(item.status)

  async function handleSave() {
    if (localStatus === item.status) return
    setSaving(true)
    await fetch(`/api/coras-future?id=${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: localStatus }),
    })
    onStatusChange(item.id, localStatus)
    setSaving(false)
  }

  return (
    <div className="border-border rounded-md border">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[item.status]}`}
        >
          {item.status.toUpperCase()}
        </span>
        <span className="flex-1 text-sm font-medium text-[var(--color-text-primary)]">
          {item.name}
        </span>
        <span className="text-xs text-[var(--color-text-secondary)]">{item.provider}</span>
        <DeadlinePill datesText={item.dates} />
        <span className="text-[var(--color-text-secondary)]">{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded && (
        <div className="border-border space-y-3 border-t bg-[var(--color-cockpit-surface-2)] px-4 py-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-[var(--color-text-secondary)]">Eligibility</p>
              <p className="text-[var(--color-text-primary)]">{item.eligibility ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-secondary)]">Value</p>
              <p className="text-[var(--color-text-primary)]">{item.value ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-secondary)]">Timeline</p>
              <p className="text-[var(--color-text-primary)]">{item.timeline ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-secondary)]">Dates</p>
              <p className="flex items-center gap-2 text-[var(--color-text-primary)]">
                {item.dates ?? '—'}
                <DeadlinePill datesText={item.dates} />
              </p>
            </div>
          </div>
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-xs text-[var(--color-accent-gold)] hover:underline"
            >
              Open Application Page →
            </a>
          )}
          {item.notes && <p className="text-xs text-[var(--color-text-secondary)]">{item.notes}</p>}
          <div className="flex items-center gap-2 pt-1">
            <select
              value={localStatus}
              onChange={(e) => setLocalStatus(e.target.value as CoraFutureItem['status'])}
              className="border-border rounded-md border bg-[var(--color-cockpit-surface)] px-2 py-1 text-xs text-[var(--color-text-primary)]"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSave}
              disabled={saving || localStatus === item.status}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function AddItemForm({ onAdded }: { onAdded: (item: CoraFutureItem) => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    category: 'program' as CoraFutureItem['category'],
    name: '',
    provider: '',
    eligibility: '',
    value: '',
    timeline: '' as CoraFutureItem['timeline'] | '',
    dates: '',
    url: '',
    status: 'upcoming' as CoraFutureItem['status'],
    notes: '',
  })

  function set<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    const res = await fetch('/api/coras-future', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, timeline: form.timeline || null }),
    })
    const item = (await res.json()) as CoraFutureItem
    onAdded(item)
    setForm({
      category: 'program',
      name: '',
      provider: '',
      eligibility: '',
      value: '',
      timeline: '',
      dates: '',
      url: '',
      status: 'upcoming',
      notes: '',
    })
    setSaving(false)
    setOpen(false)
  }

  return (
    <div className="mt-4">
      <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
        {open ? 'Cancel' : '+ Add Program or Scholarship'}
      </Button>
      {open && (
        <form
          onSubmit={handleSubmit}
          className="border-border mt-2 space-y-3 rounded-md border p-4"
        >
          <div className="grid grid-cols-2 gap-3">
            {[
              {
                label: 'Type',
                field: 'category' as const,
                type: 'select',
                options: ['program', 'scholarship', 'note'],
              },
              { label: 'Status', field: 'status' as const, type: 'select', options: STATUSES },
            ].map(({ label, field, options }) => (
              <div key={field} className="space-y-1">
                <label className="text-xs text-[var(--color-text-secondary)]">{label}</label>
                <select
                  value={form[field] as string}
                  onChange={(e) => set(field, e.target.value as (typeof form)[typeof field])}
                  className="border-border w-full rounded-md border bg-[var(--color-cockpit-surface)] px-2 py-1.5 text-xs text-[var(--color-text-primary)]"
                >
                  {options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {[
              { label: 'Name *', field: 'name' as const },
              { label: 'Provider', field: 'provider' as const },
              { label: 'Eligibility', field: 'eligibility' as const },
              { label: 'Value / Funding', field: 'value' as const },
              { label: 'Key Dates', field: 'dates' as const },
              { label: 'URL', field: 'url' as const },
            ].map(({ label, field }) => (
              <div key={field} className="space-y-1">
                <label className="text-xs text-[var(--color-text-secondary)]">{label}</label>
                <input
                  value={form[field] as string}
                  onChange={(e) => set(field, e.target.value)}
                  required={field === 'name'}
                  className="border-border w-full rounded-md border bg-[var(--color-cockpit-surface)] px-2 py-1.5 text-xs text-[var(--color-text-primary)]"
                />
              </div>
            ))}
            <div className="space-y-1">
              <label className="text-xs text-[var(--color-text-secondary)]">Timeline</label>
              <select
                value={form.timeline ?? ''}
                onChange={(e) => set('timeline', e.target.value as CoraFutureItem['timeline'] | '')}
                className="border-border w-full rounded-md border bg-[var(--color-cockpit-surface)] px-2 py-1.5 text-xs text-[var(--color-text-primary)]"
              >
                <option value="">—</option>
                {TIMELINES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-[var(--color-text-secondary)]">Notes</label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              className="border-border w-full rounded-md border bg-[var(--color-cockpit-surface)] px-2 py-1.5 text-xs text-[var(--color-text-primary)]"
            />
          </div>
          <Button type="submit" size="sm" disabled={saving || !form.name.trim()}>
            {saving ? 'Adding…' : 'Add'}
          </Button>
        </form>
      )}
    </div>
  )
}

export function CorasFuturePage() {
  const [items, setItems] = useState<CoraFutureItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('Programs & Scholarships')

  useEffect(() => {
    fetch('/api/coras-future')
      .then((r) => r.json())
      .then((d: CorasFutureResponse & { error?: string }) => {
        if (d.error) setError(d.error)
        else setItems(d.items)
        setLoading(false)
      })
      .catch((e: unknown) => {
        setError(String(e))
        setLoading(false)
      })
  }, [])

  function handleStatusChange(id: string, status: CoraFutureItem['status']) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)))
  }

  function handleAdded(item: CoraFutureItem) {
    setItems((prev) => [...prev, item])
  }

  const programs = items.filter((i) => i.category !== 'note')
  const notes = items.filter((i) => i.category === 'note')
  const withDates = items.filter((i) => i.dates)
  const grouped = TIMELINES.reduce<Record<string, CoraFutureItem[]>>((acc, tl) => {
    acc[tl] = programs.filter((i) => i.timeline === tl)
    return acc
  }, {})
  const noTimeline = programs.filter((i) => !i.timeline)

  if (loading) return <div className="p-8 text-sm text-[var(--color-text-secondary)]">Loading…</div>
  if (error) return <div className="p-8 text-sm text-red-400">{error}</div>

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold text-[var(--color-text-primary)]">
        Cora&apos;s Future
      </h1>
      <p className="mb-6 text-sm text-[var(--color-text-secondary)]">
        Programs, scholarships & planning for Cora&apos;s path forward
      </p>

      {/* Tabs */}
      <div className="border-border mb-6 flex gap-1 border-b">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'border-b-2 border-[var(--color-accent-gold)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Programs & Scholarships' && (
        <div className="space-y-6">
          {TIMELINES.map((tl) =>
            grouped[tl].length > 0 ? (
              <div key={tl}>
                <p className="mb-2 text-xs font-semibold tracking-wider text-[var(--color-text-secondary)] uppercase">
                  {tl}
                </p>
                <div className="space-y-2">
                  {grouped[tl].map((item) => (
                    <ItemCard key={item.id} item={item} onStatusChange={handleStatusChange} />
                  ))}
                </div>
              </div>
            ) : null
          )}
          {noTimeline.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wider text-[var(--color-text-secondary)] uppercase">
                Other
              </p>
              <div className="space-y-2">
                {noTimeline.map((item) => (
                  <ItemCard key={item.id} item={item} onStatusChange={handleStatusChange} />
                ))}
              </div>
            </div>
          )}
          {programs.length === 0 && (
            <p className="text-sm text-[var(--color-text-secondary)]">
              No programs tracked yet. Add one below.
            </p>
          )}
          <AddItemForm onAdded={handleAdded} />
        </div>
      )}

      {activeTab === 'Deadlines' && (
        <div className="space-y-4">
          {withDates.length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)]">No deadlines tracked yet.</p>
          ) : (
            <div className="space-y-2">
              {withDates.map((item) => (
                <div key={item.id} className="border-border rounded-md border px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm">{item.category === 'scholarship' ? '🎓' : '🔬'}</span>
                    <span className="flex-1 text-sm font-medium text-[var(--color-text-primary)]">
                      {item.name}
                    </span>
                    <DeadlinePill datesText={item.dates} />
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                    {item.dates} · {item.provider}
                  </p>
                  {item.notes && (
                    <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                      {item.notes.slice(0, 120)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="border-border mt-6 rounded-md border bg-[var(--color-cockpit-surface)] p-4">
            <p className="mb-2 text-xs font-semibold text-[var(--color-text-primary)]">
              Quick Reference
            </p>
            <div className="space-y-1 text-xs text-[var(--color-text-secondary)]">
              <p>
                <span className="text-[var(--color-text-primary)]">Current Grade:</span> ~Grade 6
                (age 11)
              </p>
              <p className="mt-2 font-medium text-[var(--color-text-primary)]">Key Target Dates:</p>
              <p>· March 2032 — WISEST application opens (Grade 11)</p>
              <p>· March 2032 — HYRS application opens (Grade 11)</p>
              <p>· Grade 12 — Aboriginal Futures scholarship</p>
              <p>· Post-secondary — RBC Future Launch Scholarship</p>
              <p className="mt-2">
                <span className="text-[var(--color-text-primary)]">First Nations Status:</span>{' '}
                Eligible for Indigenous-specific subsidies and scholarships.
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'Notes' && (
        <div className="space-y-4">
          {notes.length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)]">No notes yet.</p>
          ) : (
            <div className="space-y-3">
              {notes.map((item) => (
                <div key={item.id} className="border-border rounded-md border p-4">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    {item.name}
                  </p>
                  {item.notes && (
                    <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{item.notes}</p>
                  )}
                  <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                    Added {new Date(item.created_at).toLocaleDateString('en-CA')}
                  </p>
                </div>
              ))}
            </div>
          )}
          <AddItemForm onAdded={handleAdded} />
        </div>
      )}

      {activeTab === "Cora's World" && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            {[
              {
                title: 'Godot 3D Game',
                desc: 'Zelda BOTW inspired, NPC souls, health tracking',
                code: 'coras-world/',
              },
              {
                title: 'React Web App',
                desc: 'Room builder, world explorer, vibes tracker',
                code: 'coras-world-app/',
              },
              {
                title: 'Streamlit App',
                desc: 'Mood tracking, math arena, style studio',
                code: 'coras_world/',
              },
            ].map((p) => (
              <div key={p.title} className="border-border rounded-md border p-4">
                <p className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">
                  {p.title}
                </p>
                <p className="mb-2 text-xs text-[var(--color-text-secondary)]">{p.desc}</p>
                <code className="rounded bg-[var(--color-cockpit-surface-2)] px-2 py-0.5 text-xs text-[var(--color-accent-gold)]">
                  {p.code}
                </code>
              </div>
            ))}
          </div>
          <div className="border-border rounded-md border p-4">
            <p className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">
              Health & Wellness
            </p>
            <ul className="space-y-1 text-xs text-[var(--color-text-secondary)]">
              <li>· Health tracking built into the game via Spark (AI companion)</li>
              <li>· Tracks mood, physical symptoms, food, sleep, activity</li>
              <li>· Parent dashboard available for oversight</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
