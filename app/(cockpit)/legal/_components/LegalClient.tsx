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

type Category =
  | 'contract'
  | 'compliance'
  | 'IP'
  | 'employment'
  | 'real-estate'
  | 'corporate'
  | 'personal'
  | 'tax'
  | 'other'
type Status = 'active' | 'resolved' | 'pending' | 'review'

interface LegalItem {
  id: string
  title: string
  category: Category
  status: Status
  due_date: string | null
  counterparty: string | null
  value_cad: number | null
  notes: string | null
  created_at: string
}

interface LegalClientProps {
  initialItems: LegalItem[]
}

const STATUS_COLORS: Record<Status, string> = {
  active: 'bg-green-500/20 text-green-300',
  resolved: 'bg-[var(--color-border)] text-[var(--color-text-disabled)]',
  pending: 'bg-yellow-500/20 text-yellow-300',
  review: 'bg-blue-500/20 text-blue-300',
}
const CATEGORY_COLORS: Record<Category, string> = {
  contract: 'bg-purple-500/20 text-purple-300',
  compliance: 'bg-orange-500/20 text-orange-300',
  IP: 'bg-pink-500/20 text-pink-300',
  employment: 'bg-cyan-500/20 text-cyan-300',
  'real-estate': 'bg-emerald-500/20 text-emerald-300',
  corporate: 'bg-blue-500/20 text-blue-300',
  personal: 'bg-indigo-500/20 text-indigo-300',
  tax: 'bg-red-500/20 text-red-300',
  other: 'bg-[var(--color-border)] text-[var(--color-text-muted)]',
}

const emptyForm = {
  title: '',
  category: 'other' as Category,
  status: 'active' as Status,
  due_date: '',
  counterparty: '',
  value_cad: '',
  notes: '',
}

const fmt = (n: number | null) =>
  n == null
    ? '—'
    : n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0 })

export function LegalClient({ initialItems }: LegalClientProps) {
  const [items, setItems] = useState<LegalItem[]>(initialItems)
  const [statusFilter, setStatusFilter] = useState<'All' | Status>('All')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const today = new Date().toISOString().split('T')[0]

  const filtered = items.filter((i) => statusFilter === 'All' || i.status === statusFilter)

  function openAdd() {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(true)
    setError(null)
  }

  function openEdit(item: LegalItem) {
    setForm({
      title: item.title,
      category: item.category,
      status: item.status,
      due_date: item.due_date ?? '',
      counterparty: item.counterparty ?? '',
      value_cad: item.value_cad != null ? String(item.value_cad) : '',
      notes: item.notes ?? '',
    })
    setEditingId(item.id)
    setShowForm(true)
    setError(null)
  }

  async function save() {
    if (!form.title.trim()) {
      setError('Title is required')
      return
    }
    setSaving(true)
    setError(null)
    const payload = {
      title: form.title.trim(),
      category: form.category,
      status: form.status,
      due_date: form.due_date || null,
      counterparty: form.counterparty.trim() || null,
      value_cad: form.value_cad ? parseFloat(form.value_cad) : null,
      notes: form.notes.trim() || null,
    }
    try {
      if (editingId) {
        const res = await fetch(`/api/legal/items/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const json = (await res.json()) as { item?: LegalItem; error?: string }
        if (json.error) throw new Error(json.error)
        setItems((prev) => prev.map((x) => (x.id === editingId ? json.item! : x)))
      } else {
        const res = await fetch('/api/legal/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const json = (await res.json()) as { item?: LegalItem; error?: string }
        if (json.error) throw new Error(json.error)
        setItems((prev) => [json.item!, ...prev])
      }
      setShowForm(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  async function deleteItem(id: string) {
    if (!confirm('Delete this legal item?')) return
    try {
      await fetch(`/api/legal/items/${id}`, { method: 'DELETE' })
      setItems((prev) => prev.filter((x) => x.id !== id))
    } catch {
      /* ignore */
    }
  }

  const statuses: Array<'All' | Status> = ['All', 'active', 'pending', 'review', 'resolved']

  // Summary counts
  const active = items.filter((i) => i.status === 'active').length
  const pending = items.filter((i) => i.status === 'pending').length
  const review = items.filter((i) => i.status === 'review').length

  return (
    <div className="flex flex-col gap-4">
      {/* Summary */}
      <div className="flex flex-wrap gap-3">
        {[
          { label: 'Active', value: active, color: 'text-green-300' },
          { label: 'Pending', value: pending, color: 'text-yellow-300' },
          { label: 'Review', value: review, color: 'text-blue-300' },
          { label: 'Total', value: items.length, color: 'text-[var(--color-text-primary)]' },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-center"
          >
            <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-[var(--color-text-muted)]">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {statuses.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === f
                  ? 'bg-[var(--color-rail)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <Button onClick={openAdd} variant="outline" className="text-xs">
          + Add Item
        </Button>
      </div>

      {error && <div className="text-xs text-red-400">{error}</div>}

      {/* Form */}
      {showForm && (
        <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
            {editingId ? 'Edit Legal Item' : 'New Legal Item'}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 flex flex-col gap-1">
              <Label className="text-xs">Title *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                placeholder="e.g. Supplier agreement — ABC Co."
                className="text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm((p) => ({ ...p, category: v as Category }))}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    [
                      'contract',
                      'compliance',
                      'IP',
                      'employment',
                      'real-estate',
                      'corporate',
                      'personal',
                      'tax',
                      'other',
                    ] as Category[]
                  ).map((c) => (
                    <SelectItem key={c} value={c}>
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((p) => ({ ...p, status: v as Status }))}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['active', 'pending', 'review', 'resolved'] as Status[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Due Date</Label>
              <Input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))}
                className="text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Counterparty</Label>
              <Input
                value={form.counterparty}
                onChange={(e) => setForm((p) => ({ ...p, counterparty: e.target.value }))}
                placeholder="Person or company"
                className="text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Value (CAD)</Label>
              <Input
                type="number"
                value={form.value_cad}
                onChange={(e) => setForm((p) => ({ ...p, value_cad: e.target.value }))}
                placeholder="0.00"
                className="text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Notes</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Key notes"
                className="text-sm"
              />
            </div>
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

      {/* Table */}
      {filtered.length === 0 ? (
        <p className="mt-8 text-center text-[length:var(--text-small)] text-[var(--color-text-muted)]">
          No items found. Click &ldquo;+ Add Item&rdquo; to create one.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                {['Title', 'Category', 'Status', 'Counterparty', 'Value', 'Due', ''].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const isPast = item.due_date && item.due_date < today && item.status !== 'resolved'
                return (
                  <tr
                    key={item.id}
                    className="border-b border-[var(--color-border)] transition-colors last:border-0 hover:bg-[var(--color-border)]/20"
                  >
                    <td className="max-w-[200px] truncate px-3 py-2 font-medium text-[var(--color-text-primary)]">
                      {item.title}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CATEGORY_COLORS[item.category] ?? ''}`}
                      >
                        {item.category}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLORS[item.status] ?? ''}`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                      {item.counterparty ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                      {fmt(item.value_cad)}
                    </td>
                    <td
                      className={`px-3 py-2 text-xs ${isPast ? 'font-medium text-red-400' : 'text-[var(--color-text-muted)]'}`}
                    >
                      {item.due_date ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => openEdit(item)}
                          className="text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteItem(item.id)}
                          className="text-xs text-[var(--color-text-disabled)] transition-colors hover:text-red-400"
                        >
                          Delete
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
    </div>
  )
}
