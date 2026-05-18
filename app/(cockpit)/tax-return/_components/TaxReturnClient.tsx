'use client'

import { useCallback, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface TaxDoc {
  id: string
  user_id: string
  tax_year: number
  doc_type: string
  description: string
  amount: number | null
  file_url: string | null
  is_confirmed: boolean
  uploaded_at: string
}

interface Props {
  initialDocs: TaxDoc[]
  defaultYear: number
}

const DOC_TYPES = [
  'T4',
  'T4A',
  'T5',
  'T3',
  'RRSP-receipt',
  'medical',
  'charitable',
  'tuition',
  'business-income',
  'business-expense',
  'rental',
  'foreign',
  'other',
] as const

const DOC_TYPE_GROUPS: Record<string, string[]> = {
  Employment: ['T4', 'T4A'],
  Investment: ['T5', 'T3'],
  Deductions: ['RRSP-receipt', 'medical', 'charitable', 'tuition'],
  Business: ['business-income', 'business-expense'],
  Other: ['rental', 'foreign', 'other'],
}

const BLANK_FORM = { doc_type: 'T4', description: '', amount: '', file_url: '' }

/** Discrete progress step — maps 0–100 to the nearest Tailwind fraction class */
function progressClass(pct: number): string {
  if (pct === 0) return 'w-0'
  if (pct <= 8) return 'w-[8%]'
  if (pct <= 16) return 'w-[16%]'
  if (pct <= 25) return 'w-1/4'
  if (pct <= 33) return 'w-1/3'
  if (pct <= 42) return 'w-[42%]'
  if (pct <= 50) return 'w-1/2'
  if (pct <= 58) return 'w-[58%]'
  if (pct <= 67) return 'w-2/3'
  if (pct <= 75) return 'w-3/4'
  if (pct <= 83) return 'w-[83%]'
  if (pct <= 91) return 'w-[91%]'
  return 'w-full'
}

export function TaxReturnClient({ initialDocs, defaultYear }: Props) {
  const [docs, setDocs] = useState<TaxDoc[]>(initialDocs)
  const [year, setYear] = useState<number>(defaultYear)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<TaxDoc | null>(null)
  const [form, setForm] = useState(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (y: number) => {
    const r = await fetch(`/api/tax-return/docs?year=${y}`)
    const j = (await r.json()) as { docs: TaxDoc[]; error?: string }
    if (j.error) {
      setError(j.error)
      return
    }
    setDocs(j.docs)
  }, [])

  const openAdd = () => {
    setEditTarget(null)
    setForm(BLANK_FORM)
    setDialogOpen(true)
  }

  const openEdit = (d: TaxDoc) => {
    setEditTarget(d)
    setForm({
      doc_type: d.doc_type,
      description: d.description,
      amount: d.amount?.toString() ?? '',
      file_url: d.file_url ?? '',
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.description.trim()) {
      setError('Description is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const body = {
        doc_type: form.doc_type,
        description: form.description.trim(),
        amount: form.amount ? parseFloat(form.amount) : null,
        file_url: form.file_url.trim() || null,
        tax_year: year,
      }
      const r = editTarget
        ? await fetch(`/api/tax-return/docs/${editTarget.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch('/api/tax-return/docs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
      const j = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      setDialogOpen(false)
      await load(year)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleToggleConfirm = async (d: TaxDoc) => {
    await fetch(`/api/tax-return/docs/${d.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_confirmed: !d.is_confirmed }),
    })
    await load(year)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this document?')) return
    await fetch(`/api/tax-return/docs/${id}`, { method: 'DELETE' })
    await load(year)
  }

  const yearDocs = docs.filter((d) => d.tax_year === year)
  const confirmed = yearDocs.filter((d) => d.is_confirmed).length
  const total = yearDocs.length
  const progressPct = total > 0 ? Math.round((confirmed / total) * 100) : 0

  const years = Array.from(
    new Set([defaultYear, defaultYear - 1, defaultYear - 2, ...docs.map((d) => d.tax_year)])
  ).sort((a, b) => b - a)

  return (
    <div className="mx-auto max-w-3xl px-6 py-7">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-sm font-extrabold tracking-widest text-[var(--color-text-primary)] uppercase">
            Tax Return
          </h1>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Track T-slips, receipts, and deduction docs by tax year.
          </p>
        </div>
        <Button onClick={openAdd} size="sm" className="text-xs">
          + Add Doc
        </Button>
      </div>

      {error && <p className="mb-4 text-xs text-red-400">{error}</p>}

      <div className="mb-4 flex items-center gap-3">
        <span className="text-xs text-[var(--color-text-muted)]">Tax Year:</span>
        <Select
          value={String(year)}
          onValueChange={(v) => {
            const y = parseInt(v)
            setYear(y)
            void load(y)
          }}
        >
          <SelectTrigger className="w-28 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {total > 0 && (
        <div className="mb-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-[var(--color-text-muted)]">
              {confirmed} of {total} docs confirmed
            </span>
            <span className="font-mono font-bold text-[var(--color-accent-gold)]">
              {progressPct}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
            <div
              className={`h-full rounded-full bg-[var(--color-accent-gold)] transition-all ${progressClass(progressPct)}`}
            />
          </div>
        </div>
      )}

      {yearDocs.length === 0 ? (
        <p className="py-12 text-center text-xs text-[var(--color-text-disabled)]">
          No documents for {year}. Add one to get started.
        </p>
      ) : (
        <div className="space-y-6">
          {Object.entries(DOC_TYPE_GROUPS).map(([group, types]) => {
            const groupDocs = yearDocs.filter((d) => types.includes(d.doc_type))
            if (groupDocs.length === 0) return null
            return (
              <div key={group}>
                <h2 className="mb-2 text-xs font-bold tracking-wider text-[var(--color-text-disabled)] uppercase">
                  {group}
                </h2>
                <div className="space-y-2">
                  {groupDocs.map((d) => (
                    <div
                      key={d.id}
                      className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${d.is_confirmed ? 'border-green-900/40 bg-green-900/10' : 'border-[var(--color-border)] bg-[var(--color-surface)]'}`}
                    >
                      <input
                        type="checkbox"
                        checked={d.is_confirmed}
                        onChange={() => void handleToggleConfirm(d)}
                        className="h-4 w-4 cursor-pointer accent-[var(--color-accent-gold)]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className="shrink-0 bg-[var(--color-surface-2)] text-xs text-[var(--color-text-muted)]">
                            {d.doc_type}
                          </Badge>
                          <span className="truncate text-sm text-[var(--color-text-primary)]">
                            {d.description}
                          </span>
                        </div>
                        {d.amount != null && (
                          <span className="mt-0.5 block font-mono text-xs text-[var(--color-text-muted)]">
                            ${d.amount.toFixed(2)}
                          </span>
                        )}
                      </div>
                      {d.file_url && (
                        <a
                          href={d.file_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-[var(--color-accent-gold)] hover:underline"
                        >
                          File
                        </a>
                      )}
                      <div className="flex shrink-0 gap-2">
                        <button
                          onClick={() => openEdit(d)}
                          className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => void handleDelete(d.id)}
                          className="text-xs text-[var(--color-text-disabled)] hover:text-red-400"
                        >
                          Del
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit Document' : `Add Document — ${year}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="space-y-1">
              <Label className="text-xs">Document Type</Label>
              <Select
                value={form.doc_type}
                onValueChange={(v) => setForm((f) => ({ ...f, doc_type: v }))}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map((dt) => (
                    <SelectItem key={dt} value={dt}>
                      {dt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="e.g. T4 from Employer ABC"
                className="text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Amount $</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="Optional"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">File URL</Label>
                <Input
                  value={form.file_url}
                  onChange={(e) => setForm((f) => ({ ...f, file_url: e.target.value }))}
                  placeholder="https://…"
                  className="text-sm"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Add Document'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
