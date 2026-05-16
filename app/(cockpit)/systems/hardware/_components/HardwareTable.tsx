'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import type { HardwareComponent } from '../page'

// ── Constants ──────────────────────────────────────────────────────────────────
// TODO: tune category/status lists with real data if requirements expand
const CATEGORIES = ['CPU', 'GPU', 'RAM', 'Storage', 'Cooling', 'Chassis', 'PSU', 'Motherboard', 'Peripherals', 'Other'] as const
const STATUSES = ['planned', 'ordered', 'received', 'installed'] as const

type Category = typeof CATEGORIES[number]
type Status = typeof STATUSES[number]

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'planned':
      return 'bg-secondary text-secondary-foreground'
    case 'ordered':
      return 'bg-amber-900/50 text-amber-300 border-amber-800'
    case 'received':
      return 'bg-blue-900/50 text-blue-300 border-blue-800'
    case 'installed':
      return 'bg-green-900/50 text-green-300 border-green-800'
    default:
      return 'bg-secondary text-secondary-foreground'
  }
}

function formatCad(val: number | null): string {
  if (val == null) return '—'
  return `$${val.toFixed(2)}`
}

function sumCad(components: HardwareComponent[], field: 'budget_cad' | 'actual_cad'): number {
  return components.reduce((acc, c) => acc + (c[field] ?? 0), 0)
}

// ── Add/Edit form state type ───────────────────────────────────────────────────

interface FormState {
  name: string
  category: Category
  status: Status
  budget_cad: string
  actual_cad: string
  product_url: string
  notes: string
}

const EMPTY_FORM: FormState = {
  name: '',
  category: 'Other',
  status: 'planned',
  budget_cad: '',
  actual_cad: '',
  product_url: '',
  notes: '',
}

function formFromComponent(c: HardwareComponent): FormState {
  return {
    name: c.name,
    category: c.category as Category,
    status: c.status as Status,
    budget_cad: c.budget_cad != null ? String(c.budget_cad) : '',
    actual_cad: c.actual_cad != null ? String(c.actual_cad) : '',
    product_url: c.product_url ?? '',
    notes: c.notes ?? '',
  }
}

// ── Inline add form ────────────────────────────────────────────────────────────

function AddForm({ onSaved }: { onSaved: (c: HardwareComponent) => void }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      setErr('Component name is required.')
      return
    }
    setSaving(true)
    setErr('')
    try {
      const res = await fetch('/api/hardware', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          category: form.category,
          status: form.status,
          budget_cad: form.budget_cad ? parseFloat(form.budget_cad) : null,
          actual_cad: form.actual_cad ? parseFloat(form.actual_cad) : null,
          product_url: form.product_url.trim() || null,
          notes: form.notes.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErr(data.error ?? 'Failed to add component.')
      } else {
        setForm(EMPTY_FORM)
        onSaved(data.component as HardwareComponent)
      }
    } catch {
      setErr('Network error — try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="border-border bg-cockpit-surface rounded-xl border p-4 space-y-4">
      <h3 className="label-caps text-sm">Add Component</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Component Name</Label>
          <Input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="RTX 4070 Ti Super"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Category</Label>
          <Select value={form.category} onValueChange={(v) => set('category', v as Category)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select value={form.status} onValueChange={(v) => set('status', v as Status)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Budget CAD — optional</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={form.budget_cad}
            onChange={(e) => set('budget_cad', e.target.value)}
            placeholder="1200.00"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Actual CAD — optional</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={form.actual_cad}
            onChange={(e) => set('actual_cad', e.target.value)}
            placeholder="1149.99"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Product URL — optional</Label>
          <Input
            type="url"
            value={form.product_url}
            onChange={(e) => set('product_url', e.target.value)}
            placeholder="https://www.amazon.ca/..."
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Notes — optional</Label>
          <textarea
            className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[60px] w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Pair with 32GB DDR5..."
          />
        </div>
      </div>
      {err && <p className="text-sm text-red-400">{err}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Add Component'}
        </Button>
      </div>
    </form>
  )
}

// ── Inline edit form ───────────────────────────────────────────────────────────

function EditForm({
  component,
  onSaved,
  onCancel,
}: {
  component: HardwareComponent
  onSaved: (c: HardwareComponent) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<FormState>(formFromComponent(component))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      setErr('Component name is required.')
      return
    }
    setSaving(true)
    setErr('')
    try {
      const res = await fetch(`/api/hardware/${component.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          category: form.category,
          status: form.status,
          budget_cad: form.budget_cad ? parseFloat(form.budget_cad) : null,
          actual_cad: form.actual_cad ? parseFloat(form.actual_cad) : null,
          product_url: form.product_url.trim() || null,
          notes: form.notes.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErr(data.error ?? 'Failed to save changes.')
      } else {
        onSaved(data.component as HardwareComponent)
      }
    } catch {
      setErr('Network error — try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="border-border bg-cockpit-surface rounded-xl border p-4 space-y-4 mt-2">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Component Name</Label>
          <Input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Category</Label>
          <Select value={form.category} onValueChange={(v) => set('category', v as Category)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select value={form.status} onValueChange={(v) => set('status', v as Status)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Budget CAD</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={form.budget_cad}
            onChange={(e) => set('budget_cad', e.target.value)}
            placeholder="—"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Actual CAD</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={form.actual_cad}
            onChange={(e) => set('actual_cad', e.target.value)}
            placeholder="—"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Product URL</Label>
          <Input
            type="url"
            value={form.product_url}
            onChange={(e) => set('product_url', e.target.value)}
            placeholder="https://..."
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Notes</Label>
          <textarea
            className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[60px] w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </div>
      </div>
      {err && <p className="text-sm text-red-400">{err}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving} size="sm">
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

// ── Component row ──────────────────────────────────────────────────────────────

function ComponentRow({
  component,
  onEdit,
  onDelete,
}: {
  component: HardwareComponent
  onEdit: (c: HardwareComponent) => void
  onDelete: (id: string) => void
}) {
  const variance =
    component.actual_cad != null && component.budget_cad != null
      ? component.actual_cad - component.budget_cad
      : null

  return (
    <tr className="border-border border-b last:border-0">
      <td className="py-3 pr-4 text-sm font-medium text-[var(--color-text-primary)]">
        {component.product_url ? (
          <a
            href={component.product_url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {component.name}
          </a>
        ) : (
          component.name
        )}
      </td>
      <td className="py-3 pr-4 text-sm text-muted-foreground">{component.category}</td>
      <td className="py-3 pr-4">
        <Badge className={statusBadgeClass(component.status)}>
          {component.status.charAt(0).toUpperCase() + component.status.slice(1)}
        </Badge>
      </td>
      <td className="py-3 pr-4 text-right font-mono text-sm text-muted-foreground">
        {formatCad(component.budget_cad)}
      </td>
      <td className="py-3 pr-4 text-right font-mono text-sm text-muted-foreground">
        {formatCad(component.actual_cad)}
      </td>
      <td className="py-3 pr-4 text-right font-mono text-sm">
        {variance == null ? (
          <span className="text-muted-foreground/50">—</span>
        ) : (
          <span className={variance <= 0 ? 'text-green-400' : 'text-red-400'}>
            {variance > 0 ? '+' : ''}{formatCad(variance)}
          </span>
        )}
      </td>
      <td className="py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => onEdit(component)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() => onDelete(component.id)}
            className="text-xs text-muted-foreground hover:text-red-400 transition-colors"
          >
            ✕
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Main HardwareTable component ───────────────────────────────────────────────

export function HardwareTable({ initialComponents }: { initialComponents: HardwareComponent[] }) {
  const [components, setComponents] = useState<HardwareComponent[]>(initialComponents)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const totalBudget = sumCad(components, 'budget_cad')
  const totalActual = sumCad(components, 'actual_cad')

  const handleAdded = useCallback((c: HardwareComponent) => {
    setComponents((prev) => [c, ...prev])
    setShowAddForm(false)
  }, [])

  const handleEdited = useCallback((c: HardwareComponent) => {
    setComponents((prev) => prev.map((x) => (x.id === c.id ? c : x)))
    setEditingId(null)
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    if (!window.confirm('Delete this component?')) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/hardware/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setComponents((prev) => prev.filter((x) => x.id !== id))
      }
    } finally {
      setDeletingId(null)
    }
  }, [])

  return (
    <div className="space-y-6">
      {/* Summary header */}
      <div className="border-border bg-cockpit-surface flex flex-wrap items-center gap-8 rounded-xl border p-5">
        <div>
          <p className="label-caps text-muted-foreground/60 text-xs">Budgeted</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-[var(--color-text-primary)]">
            ${totalBudget.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="label-caps text-muted-foreground/60 text-xs">Actual Spent</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-[var(--color-text-primary)]">
            ${totalActual.toFixed(2)}
          </p>
        </div>
        {totalBudget > 0 && (
          <div>
            <p className="label-caps text-muted-foreground/60 text-xs">Variance</p>
            <p
              className={`mt-1 font-mono text-2xl font-semibold ${
                totalActual - totalBudget <= 0 ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {totalActual - totalBudget > 0 ? '+' : ''}${(totalActual - totalBudget).toFixed(2)}
            </p>
          </div>
        )}
        <div className="ml-auto">
          <p className="label-caps text-muted-foreground/60 text-xs">Components</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-[var(--color-text-primary)]">
            {components.length}
          </p>
        </div>
      </div>

      {/* Add Component button or form */}
      {showAddForm ? (
        <AddForm onSaved={handleAdded} />
      ) : (
        <Button onClick={() => setShowAddForm(true)} variant="outline">
          + Add Component
        </Button>
      )}

      {/* Table */}
      {components.length === 0 ? (
        <p className="text-muted-foreground/60 py-8 text-center text-sm">
          No components yet — add your first one above.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-border border-b">
                <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Component</th>
                <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Category</th>
                <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Status</th>
                <th className="pb-2 pr-4 text-right text-xs font-medium text-muted-foreground">Budget</th>
                <th className="pb-2 pr-4 text-right text-xs font-medium text-muted-foreground">Actual</th>
                <th className="pb-2 pr-4 text-right text-xs font-medium text-muted-foreground">Variance</th>
                <th className="pb-2 text-right text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {components.map((c) =>
                editingId === c.id ? (
                  <tr key={c.id} className="border-border border-b last:border-0">
                    <td colSpan={7} className="py-2">
                      <EditForm
                        component={c}
                        onSaved={handleEdited}
                        onCancel={() => setEditingId(null)}
                      />
                    </td>
                  </tr>
                ) : (
                  <ComponentRow
                    key={c.id}
                    component={c}
                    onEdit={(comp) => setEditingId(comp.id)}
                    onDelete={deletingId === c.id ? () => undefined : handleDelete}
                  />
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
