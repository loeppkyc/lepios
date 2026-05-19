'use client'

import { useEffect, useState, useCallback } from 'react'
import type { TasksResponse, TaskRow } from '@/app/api/tasks/route'

const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: 'High',   color: '#e5534b' },
  2: { label: 'Medium', color: 'var(--color-accent-gold)' },
  3: { label: 'Low',    color: 'var(--color-text-disabled)' },
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:     { label: 'Pending',     color: 'var(--color-text-muted)' },
  in_progress: { label: 'In Progress', color: 'var(--color-accent-gold)' },
  done:        { label: 'Done',        color: 'var(--color-pillar-health)' },
  cancelled:   { label: 'Cancelled',   color: 'var(--color-text-disabled)' },
}

const s = {
  page: { padding: '28px 32px', maxWidth: 900, margin: '0 auto', fontFamily: 'var(--font-ui)' } as React.CSSProperties,
  header: { fontFamily: 'var(--font-display, var(--font-ui))', fontSize: '1.15rem', fontWeight: 800, letterSpacing: '0.06em', color: 'var(--color-text-primary)', textTransform: 'uppercase' as const, margin: 0 },
  sub: { fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-muted)', margin: '6px 0 0' },
  input: { fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-primary)', padding: '7px 10px', boxSizing: 'border-box' as const },
  btn: { fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', fontWeight: 600, padding: '6px 14px', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' },
  card: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 8, padding: '12px 16px' } as React.CSSProperties,
}

type FilterStatus = 'active' | 'done' | 'all'

export function TasksPage() {
  const [data, setData] = useState<TasksResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterStatus>('active')
  const [showAdd, setShowAdd] = useState(false)
  const [newTask, setNewTask] = useState({ task: '', priority: 2, notes: '', assigned_to: '' })
  const [saving, setSaving] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const reload = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    fetch('/api/tasks')
      .then((r) => r.json())
      .then((d: TasksResponse & { error?: string }) => {
        if (cancelled) return
        if (d.error) setError(d.error)
        else setData(d)
        setLoading(false)
      })
      .catch((e: unknown) => { if (!cancelled) { setError(String(e)); setLoading(false) } })
    return () => { cancelled = true }
  }, [refreshKey])

  const visible = (data?.tasks ?? []).filter((t) => {
    if (filter === 'active') return t.status === 'pending' || t.status === 'in_progress'
    if (filter === 'done') return t.status === 'done' || t.status === 'cancelled'
    return true
  })

  async function handleAdd() {
    if (!newTask.task.trim()) return
    setSaving(true)
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newTask, priority: Number(newTask.priority) }),
    })
    setSaving(false)
    setShowAdd(false)
    setNewTask({ task: '', priority: 2, notes: '', assigned_to: '' })
    reload()
  }

  async function updateStatus(task: TaskRow, status: TaskRow['status']) {
    await fetch('/api/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, status }),
    })
    reload()
  }

  async function deleteTask(id: string) {
    await fetch(`/api/tasks?id=${id}`, { method: 'DELETE' })
    reload()
  }

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={s.header}>Tasks</h1>
          <p style={s.sub}>Personal task list — priority 1/2/3, track done.</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} style={{ ...s.btn, background: 'var(--color-accent-gold)', color: '#000' }}>
          + Add Task
        </button>
      </div>

      {/* Counts */}
      {data && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {(['active', 'done', 'all'] as FilterStatus[]).map((f) => {
            const count = f === 'active'
              ? (data.counts.pending + data.counts.in_progress)
              : f === 'done'
                ? (data.counts.done + data.counts.cancelled)
                : Object.values(data.counts).reduce((a, b) => a + b, 0)
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  ...s.btn,
                  background: filter === f ? 'var(--color-accent-gold)' : 'var(--color-surface-2)',
                  color: filter === f ? '#000' : 'var(--color-text-muted)',
                  border: '1px solid var(--color-border)',
                  textTransform: 'capitalize',
                }}
              >
                {f === 'active' ? 'Active' : f === 'done' ? 'Done' : 'All'} · {count}
              </button>
            )
          })}
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10, marginBottom: 10 }}>
            <input
              placeholder="Task description *"
              value={newTask.task}
              onChange={(e) => setNewTask({ ...newTask, task: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              style={{ ...s.input, width: '100%' }}
              autoFocus
            />
            <select value={newTask.priority} onChange={(e) => setNewTask({ ...newTask, priority: Number(e.target.value) })} style={{ ...s.input }}>
              <option value={1}>Priority 1 — High</option>
              <option value={2}>Priority 2 — Medium</option>
              <option value={3}>Priority 3 — Low</option>
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <input placeholder="Assigned to (optional)" value={newTask.assigned_to} onChange={(e) => setNewTask({ ...newTask, assigned_to: e.target.value })} style={{ ...s.input, width: '100%' }} />
            <input placeholder="Notes (optional)" value={newTask.notes} onChange={(e) => setNewTask({ ...newTask, notes: e.target.value })} style={{ ...s.input, width: '100%' }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleAdd} disabled={saving} style={{ ...s.btn, background: 'var(--color-pillar-health)', color: '#000' }}>
              {saving ? 'Saving…' : 'Add Task'}
            </button>
            <button onClick={() => setShowAdd(false)} style={{ ...s.btn, background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && <div style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--text-small)' }}>Loading…</div>}
      {error && <div style={{ color: '#e5534b', fontSize: 'var(--text-small)' }}>{error}</div>}

      {visible.map((task) => {
        const pri = PRIORITY_LABELS[task.priority]
        const st = STATUS_LABELS[task.status]
        const isDone = task.status === 'done' || task.status === 'cancelled'
        return (
          <div key={task.id} style={{ ...s.card, opacity: isDone ? 0.65 : 1 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              {/* Priority dot */}
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: pri.color, marginTop: 6, flexShrink: 0 }} title={`Priority ${task.priority}: ${pri.label}`} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-primary)', textDecoration: isDone ? 'line-through' : 'none', marginBottom: task.notes ? 4 : 0 }}>
                  {task.task}
                </div>
                {task.notes && (
                  <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)' }}>{task.notes}</div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-ui)', fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: st.color }}>{st.label}</span>
                  {task.assigned_to && <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)' }}>→ {task.assigned_to}</span>}
                  <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)' }}>{task.date_added}</span>
                </div>
              </div>
              {/* Actions */}
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {task.status === 'pending' && (
                  <button onClick={() => updateStatus(task, 'in_progress')} style={{ ...s.btn, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontSize: '0.6rem' }}>
                    Start
                  </button>
                )}
                {(task.status === 'pending' || task.status === 'in_progress') && (
                  <button onClick={() => updateStatus(task, 'done')} style={{ ...s.btn, background: 'var(--color-pillar-health)', color: '#000', fontSize: '0.6rem' }}>
                    Done
                  </button>
                )}
                {isDone && (
                  <button onClick={() => updateStatus(task, 'pending')} style={{ ...s.btn, background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text-disabled)', fontSize: '0.6rem' }}>
                    Reopen
                  </button>
                )}
                <button onClick={() => deleteTask(task.id)} style={{ ...s.btn, background: 'none', border: '1px solid var(--color-border)', color: '#e5534b', fontSize: '0.6rem' }}>
                  ×
                </button>
              </div>
            </div>
          </div>
        )
      })}

      {!loading && visible.length === 0 && (
        <div style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--text-small)', marginTop: 24 }}>
          {filter === 'active' ? 'No active tasks. Add one above.' : 'Nothing here.'}
        </div>
      )}
    </div>
  )
}
