'use client'

import { useCallback, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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

interface Milestone {
  id: string
  user_id: string
  milestone_date: string
  title: string
  description: string | null
  category: string
  created_at: string
}

interface Props {
  initialMilestones: Milestone[]
}

const CATEGORIES = [
  'revenue',
  'acquisition',
  'launch',
  'team',
  'partnership',
  'legal',
  'financial',
  'personal',
  'general',
] as const

const CATEGORY_COLORS: Record<string, string> = {
  revenue: 'bg-green-900/50 text-green-300 hover:bg-green-900/60',
  acquisition: 'bg-blue-900/50 text-blue-300 hover:bg-blue-900/60',
  launch: 'bg-purple-900/50 text-purple-300 hover:bg-purple-900/60',
  team: 'bg-cyan-900/50 text-cyan-300 hover:bg-cyan-900/60',
  partnership: 'bg-indigo-900/50 text-indigo-300 hover:bg-indigo-900/60',
  legal: 'bg-orange-900/50 text-orange-300 hover:bg-orange-900/60',
  financial: 'bg-yellow-900/50 text-yellow-300 hover:bg-yellow-900/60',
  personal: 'bg-pink-900/50 text-pink-300 hover:bg-pink-900/60',
  general:
    'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]',
}

const BLANK_FORM = { title: '', description: '', milestone_date: '', category: 'general' }

export function BusinessHistoryClient({ initialMilestones }: Props) {
  const [milestones, setMilestones] = useState<Milestone[]>(initialMilestones)
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Milestone | null>(null)
  const [form, setForm] = useState(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch('/api/business-history/milestones')
    const j = (await r.json()) as { milestones: Milestone[]; error?: string }
    if (j.error) {
      setError(j.error)
      return
    }
    setMilestones(j.milestones)
  }, [])

  const openAdd = () => {
    setEditTarget(null)
    setForm({ ...BLANK_FORM, milestone_date: new Date().toISOString().slice(0, 10) })
    setDialogOpen(true)
  }

  const openEdit = (m: Milestone) => {
    setEditTarget(m)
    setForm({
      title: m.title,
      description: m.description ?? '',
      milestone_date: m.milestone_date,
      category: m.category,
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.title.trim() || !form.milestone_date) {
      setError('Title and date are required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const body = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        milestone_date: form.milestone_date,
        category: form.category,
      }
      let r: Response
      if (editTarget) {
        r = await fetch(`/api/business-history/milestones/${editTarget.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        r = await fetch('/api/business-history/milestones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      }
      const j = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      setDialogOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this milestone?')) return
    await fetch(`/api/business-history/milestones/${id}`, { method: 'DELETE' })
    await load()
  }

  const filtered =
    filterCategory === 'all' ? milestones : milestones.filter((m) => m.category === filterCategory)

  return (
    <div className="mx-auto max-w-4xl px-6 py-7">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-sm font-extrabold tracking-widest text-[var(--color-text-primary)] uppercase">
            Business History
          </h1>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Milestones, pivots, and key moments on the timeline.
          </p>
        </div>
        <Button onClick={openAdd} size="sm" className="text-xs">
          + Add Milestone
        </Button>
      </div>

      {error && <p className="mb-4 text-xs text-red-400">{error}</p>}

      {/* Category filter chips */}
      <div className="mb-6 flex flex-wrap gap-2">
        <button
          onClick={() => setFilterCategory('all')}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
            filterCategory === 'all'
              ? 'bg-[var(--color-accent-gold)] text-black'
              : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
          }`}
        >
          All ({milestones.length})
        </button>
        {CATEGORIES.map((cat) => {
          const count = milestones.filter((m) => m.category === cat).length
          if (count === 0) return null
          return (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${
                filterCategory === cat
                  ? 'bg-[var(--color-accent-gold)] text-black'
                  : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {cat} ({count})
            </button>
          )
        })}
      </div>

      {/* Timeline */}
      <div className="relative">
        <div className="absolute top-0 left-16 h-full w-px bg-[var(--color-border)]" />
        <div className="flex flex-col gap-6">
          {filtered.length === 0 && (
            <p className="py-12 text-center text-xs text-[var(--color-text-disabled)]">
              No milestones yet. Add one to start your timeline.
            </p>
          )}
          {filtered.map((m) => (
            <div key={m.id} className="flex gap-4">
              <div className="relative z-10 flex w-32 shrink-0 flex-col items-end pt-1 pr-4">
                <span className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 font-mono text-xs text-[var(--color-text-muted)]">
                  {m.milestone_date}
                </span>
              </div>
              <div className="relative z-10 mt-2 h-3 w-3 shrink-0 rounded-full border-2 border-[var(--color-accent-gold)] bg-[var(--color-base)]" />
              <div className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                      {m.title}
                    </span>
                    <Badge
                      className={`text-xs capitalize ${CATEGORY_COLORS[m.category] ?? CATEGORY_COLORS.general}`}
                    >
                      {m.category}
                    </Badge>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => openEdit(m)}
                      className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void handleDelete(m.id)}
                      className="text-xs text-[var(--color-text-disabled)] hover:text-red-400"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {m.description && (
                  <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
                    {m.description}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit Milestone' : 'Add Milestone'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="space-y-1">
              <Label className="text-xs">Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Launched first product on Amazon"
                className="text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Date</Label>
                <Input
                  type="date"
                  value={form.milestone_date}
                  onChange={(e) => setForm((f) => ({ ...f, milestone_date: e.target.value }))}
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat} className="capitalize">
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description (optional)</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What happened? Why does it matter?"
                rows={3}
                className="resize-none text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Add Milestone'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
