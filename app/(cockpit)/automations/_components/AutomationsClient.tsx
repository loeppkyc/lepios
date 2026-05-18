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

interface Automation {
  id: string
  name: string
  description: string | null
  trigger_type: 'manual' | 'schedule' | 'webhook' | 'event'
  action_type: 'telegram' | 'email' | 'webhook' | 'supabase' | 'api-call'
  is_active: boolean
  last_run_at: string | null
  run_count: number
  created_at: string
  updated_at: string
}

interface AutomationsClientProps {
  initialAutomations: Automation[]
}

const TRIGGER_COLORS: Record<string, string> = {
  manual: 'bg-blue-500/20 text-blue-300',
  schedule: 'bg-green-500/20 text-green-300',
  webhook: 'bg-purple-500/20 text-purple-300',
  event: 'bg-yellow-500/20 text-yellow-300',
}
const ACTION_COLORS: Record<string, string> = {
  telegram: 'bg-cyan-500/20 text-cyan-300',
  email: 'bg-orange-500/20 text-orange-300',
  webhook: 'bg-purple-500/20 text-purple-300',
  supabase: 'bg-emerald-500/20 text-emerald-300',
  'api-call': 'bg-pink-500/20 text-pink-300',
}

const emptyForm = {
  name: '',
  description: '',
  trigger_type: 'manual' as Automation['trigger_type'],
  action_type: 'telegram' as Automation['action_type'],
  is_active: true,
}

export function AutomationsClient({ initialAutomations }: AutomationsClientProps) {
  const [automations, setAutomations] = useState<Automation[]>(initialAutomations)
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const filtered = automations.filter((a) => {
    if (filter === 'active') return a.is_active
    if (filter === 'inactive') return !a.is_active
    return true
  })

  function openAdd() {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(true)
    setError(null)
  }

  function openEdit(a: Automation) {
    setForm({
      name: a.name,
      description: a.description ?? '',
      trigger_type: a.trigger_type,
      action_type: a.action_type,
      is_active: a.is_active,
    })
    setEditingId(a.id)
    setShowForm(true)
    setError(null)
  }

  async function save() {
    if (!form.name.trim()) {
      setError('Name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (editingId) {
        const res = await fetch(`/api/automations/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
        const json = (await res.json()) as { automation?: Automation; error?: string }
        if (json.error) throw new Error(json.error)
        setAutomations((prev) => prev.map((a) => (a.id === editingId ? json.automation! : a)))
      } else {
        const res = await fetch('/api/automations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
        const json = (await res.json()) as { automation?: Automation; error?: string }
        if (json.error) throw new Error(json.error)
        setAutomations((prev) => [json.automation!, ...prev])
      }
      setShowForm(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(a: Automation) {
    try {
      const res = await fetch(`/api/automations/${a.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !a.is_active }),
      })
      const json = (await res.json()) as { automation?: Automation; error?: string }
      if (json.automation)
        setAutomations((prev) => prev.map((x) => (x.id === a.id ? json.automation! : x)))
    } catch {
      /* ignore */
    }
  }

  async function deleteAutomation(id: string) {
    if (!confirm('Delete this automation?')) return
    try {
      await fetch(`/api/automations/${id}`, { method: 'DELETE' })
      setAutomations((prev) => prev.filter((a) => a.id !== id))
    } catch {
      /* ignore */
    }
  }

  async function runNow(a: Automation) {
    setRunning(a.id)
    setError(null)
    try {
      const res = await fetch(`/api/automations/${a.id}/run`, { method: 'POST' })
      const json = (await res.json()) as { ok?: boolean; ran_at?: string; error?: string }
      if (json.error) throw new Error(json.error)
      // Refresh run_count locally
      setAutomations((prev) =>
        prev.map((x) =>
          x.id === a.id
            ? {
                ...x,
                run_count: x.run_count + 1,
                last_run_at: json.ran_at ?? new Date().toISOString(),
              }
            : x
        )
      )
    } catch (e) {
      setError(String(e))
    } finally {
      setRunning(null)
    }
  }

  function fmtDate(d: string | null) {
    if (!d) return '—'
    return new Date(d).toLocaleString('en-CA', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(['all', 'active', 'inactive'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-[var(--color-rail)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <Button onClick={openAdd} variant="outline" className="text-xs">
          + Add Automation
        </Button>
      </div>

      {error && <div className="text-xs text-red-400">{error}</div>}

      {/* Form */}
      {showForm && (
        <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
            {editingId ? 'Edit Automation' : 'New Automation'}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Daily Digest"
                className="text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Description</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="What does this do?"
                className="text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Trigger Type</Label>
              <Select
                value={form.trigger_type}
                onValueChange={(v) =>
                  setForm((p) => ({ ...p, trigger_type: v as Automation['trigger_type'] }))
                }
              >
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="schedule">Schedule</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                  <SelectItem value="event">Event</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Action Type</Label>
              <Select
                value={form.action_type}
                onValueChange={(v) =>
                  setForm((p) => ({ ...p, action_type: v as Automation['action_type'] }))
                }
              >
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="telegram">Telegram</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                  <SelectItem value="supabase">Supabase</SelectItem>
                  <SelectItem value="api-call">API Call</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_active"
              checked={form.is_active}
              onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
              className="rounded"
            />
            <Label htmlFor="is_active" className="cursor-pointer text-xs">
              Active
            </Label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowForm(false)} className="text-xs">
              Cancel
            </Button>
            <Button onClick={save} disabled={saving} className="text-xs">
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create'}
            </Button>
          </div>
        </div>
      )}

      {/* Cards */}
      {filtered.length === 0 && (
        <p className="mt-8 text-center text-[length:var(--text-small)] text-[var(--color-text-muted)]">
          No automations yet. Click &ldquo;+ Add Automation&rdquo; to create one.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((a) => (
          <div
            key={a.id}
            className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm leading-tight font-medium text-[var(--color-text-primary)]">
                {a.name}
              </span>
              <span
                className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  a.is_active
                    ? 'bg-green-500/20 text-green-300'
                    : 'bg-[var(--color-border)] text-[var(--color-text-disabled)]'
                }`}
              >
                {a.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
            {a.description && (
              <p className="text-xs leading-snug text-[var(--color-text-muted)]">{a.description}</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${TRIGGER_COLORS[a.trigger_type] ?? ''}`}
              >
                {a.trigger_type}
              </span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ACTION_COLORS[a.action_type] ?? ''}`}
              >
                {a.action_type}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-xs text-[var(--color-text-disabled)]">
              <span>Runs: {a.run_count}</span>
              <span>Last: {fmtDate(a.last_run_at)}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {a.trigger_type === 'manual' && (
                <Button
                  onClick={() => runNow(a)}
                  disabled={running === a.id}
                  variant="outline"
                  className="h-7 px-2 text-xs"
                >
                  {running === a.id ? 'Running…' : 'Run now'}
                </Button>
              )}
              <Button
                onClick={() => toggleActive(a)}
                variant="outline"
                className="h-7 px-2 text-xs"
              >
                {a.is_active ? 'Disable' : 'Enable'}
              </Button>
              <Button onClick={() => openEdit(a)} variant="outline" className="h-7 px-2 text-xs">
                Edit
              </Button>
              <Button
                onClick={() => deleteAutomation(a.id)}
                variant="outline"
                className="h-7 px-2 text-xs text-red-400 hover:text-red-300"
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
