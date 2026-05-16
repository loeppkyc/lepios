'use client'

import { useState } from 'react'
import type { Idea, IdeaStatus } from '@/app/api/systems/ideas/route'

const STATUS_LABEL: Record<IdeaStatus, string> = {
  idea: 'Idea',
  active: 'Active',
  shipped: 'Shipped',
  parked: 'Parked',
}

const STATUS_CLASS: Record<IdeaStatus, string> = {
  idea: 'text-info border-info/30 bg-info/10',
  active: 'text-positive border-positive/30 bg-positive/10',
  shipped: 'text-warning border-warning/30 bg-warning/10',
  parked: 'text-muted-foreground border-border bg-muted/20',
}

const SOURCE_LABEL: Record<string, string> = {
  claude: 'Claude',
  colin: 'Colin',
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

interface BrainDumpFeedProps {
  initialIdeas: Idea[]
}

export function BrainDumpFeed({ initialIdeas }: BrainDumpFeedProps) {
  const [ideas, setIdeas] = useState<Idea[]>(initialIdeas)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [adding, setAdding] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [filter, setFilter] = useState<IdeaStatus | 'all'>('all')

  async function handleAdd() {
    if (!title.trim()) return
    setAdding(true)
    try {
      const res = await fetch('/api/systems/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          source: 'colin',
        }),
      })
      if (res.ok) {
        const newIdea = (await res.json()) as Idea
        setIdeas((prev) => [newIdea, ...prev])
        setTitle('')
        setDescription('')
        setShowAdd(false)
      }
    } finally {
      setAdding(false)
    }
  }

  async function handleStatusChange(id: string, status: IdeaStatus) {
    const prev = ideas
    setIdeas((list) => list.map((i) => (i.id === id ? { ...i, status } : i)))
    const res = await fetch('/api/systems/ideas', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    if (!res.ok) setIdeas(prev)
  }

  const STATUSES: IdeaStatus[] = ['idea', 'active', 'shipped', 'parked']
  const visible = filter === 'all' ? ideas : ideas.filter((i) => i.status === filter)

  return (
    <div className="flex flex-col gap-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-foreground font-sans text-sm font-semibold tracking-wider uppercase">
            Brain Dump
          </h2>
          <span className="text-muted-foreground font-mono text-xs">{ideas.length}</span>
        </div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="text-muted-foreground hover:text-foreground border-border rounded border px-2 py-1 font-sans text-xs font-medium transition-colors"
        >
          {showAdd ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {/* Quick-add form */}
      {showAdd && (
        <div className="border-border bg-cockpit-surface flex flex-col gap-2 rounded-lg border p-3">
          <input
            type="text"
            placeholder="Idea title…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleAdd()}
            className="bg-cockpit-overlay border-border text-foreground placeholder:text-muted-foreground focus:ring-ring w-full rounded border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
          />
          <textarea
            placeholder="Description (optional)…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="bg-cockpit-overlay border-border text-foreground placeholder:text-muted-foreground focus:ring-ring w-full resize-none rounded border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
          />
          <div className="flex justify-end">
            <button
              onClick={handleAdd}
              disabled={adding || !title.trim()}
              className="bg-accent/20 hover:bg-accent/30 rounded border border-[var(--color-accent-gold)]/30 px-3 py-1.5 font-sans text-xs font-semibold text-[var(--color-accent-gold)] transition-colors disabled:opacity-40"
            >
              {adding ? 'Adding…' : 'Add Idea'}
            </button>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1">
        {(['all', ...STATUSES] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded border px-2 py-0.5 font-sans text-[0.65rem] font-medium transition-colors ${
              filter === s
                ? 'border-border bg-cockpit-overlay text-foreground'
                : 'text-muted-foreground hover:text-foreground border-transparent'
            }`}
          >
            {s === 'all'
              ? `All (${ideas.length})`
              : `${STATUS_LABEL[s]} (${ideas.filter((i) => i.status === s).length})`}
          </button>
        ))}
      </div>

      {/* Ideas list */}
      <div className="flex flex-col gap-2">
        {visible.length === 0 && (
          <p className="text-muted-foreground py-6 text-center text-sm">No ideas yet.</p>
        )}
        {visible.map((idea) => (
          <div
            key={idea.id}
            className="border-border bg-cockpit-surface flex flex-col gap-1.5 rounded-lg border p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-foreground flex-1 font-sans text-sm leading-snug font-medium">
                {idea.title}
              </span>
              <select
                value={idea.status}
                onChange={(e) => handleStatusChange(idea.id, e.target.value as IdeaStatus)}
                className={`flex-shrink-0 cursor-pointer rounded border bg-transparent px-1.5 py-0.5 font-sans text-[0.62rem] font-semibold focus:outline-none ${STATUS_CLASS[idea.status]}`}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s} className="bg-cockpit-base text-foreground">
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            {idea.description && (
              <p className="text-muted-foreground font-sans text-[0.75rem] leading-relaxed">
                {idea.description}
              </p>
            )}
            <div className="mt-0.5 flex items-center gap-2">
              <span className="text-muted-foreground/60 font-sans text-[0.62rem]">
                {SOURCE_LABEL[idea.source] ?? idea.source}
              </span>
              <span className="text-muted-foreground/40 text-[0.55rem]">·</span>
              <span className="text-muted-foreground/60 font-sans text-[0.62rem]">
                {fmt(idea.created_at)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
