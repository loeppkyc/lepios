'use client'

import { useEffect, useState, useCallback } from 'react'
import type { ChecklistsResponse, ChoreRow } from '@/app/api/checklists/route'

type Tab = 'monthly' | 'address' | 'chores'

const s = {
  page: { padding: '28px 32px', maxWidth: 900, margin: '0 auto', fontFamily: 'var(--font-ui)' } as React.CSSProperties,
  header: { fontFamily: 'var(--font-display, var(--font-ui))', fontSize: '1.15rem', fontWeight: 800, letterSpacing: '0.06em', color: 'var(--color-text-primary)', textTransform: 'uppercase' as const, margin: 0 },
  sub: { fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-muted)', margin: '6px 0 0' },
  card: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 8, padding: '12px 16px' } as React.CSSProperties,
  btn: { fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', fontWeight: 600, padding: '6px 14px', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' },
  input: { fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-primary)', padding: '7px 10px', boxSizing: 'border-box' as const },
  link: { color: 'var(--color-accent-gold)', textDecoration: 'none' as const, fontSize: 'var(--text-nano)' },
}

const FREQ_LABELS: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly', biweekly: 'Every 2 weeks',
  monthly: 'Monthly', as_needed: 'As needed',
}

function daysAgo(dateStr: string | null): number | null {
  if (!dateStr) return null
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
}

export function ChecklistsPage() {
  const [data, setData] = useState<ChecklistsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('monthly')
  const [addChore, setAddChore] = useState(false)
  const [newChore, setNewChore] = useState({ name: '', frequency: 'weekly', assigned_to: '', notes: '' })
  const [addItem, setAddItem] = useState(false)
  const [newItem, setNewItem] = useState({ name: '', category: '' })
  const [toggling, setToggling] = useState<string | null>(null)

  const [refreshKey, setRefreshKey] = useState(0)
  const reload = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    fetch('/api/checklists')
      .then((r) => r.json())
      .then((d: ChecklistsResponse & { error?: string }) => {
        if (cancelled) return
        if (d.error) setError(d.error)
        else setData(d)
        setLoading(false)
      })
      .catch((e: unknown) => { if (!cancelled) { setError(String(e)); setLoading(false) } })
    return () => { cancelled = true }
  }, [refreshKey])

  async function toggleMonthly(itemId: string) {
    setToggling(itemId)
    await fetch('/api/checklists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle_monthly', item_id: itemId }),
    })
    setToggling(null)
    reload()
  }

  async function markChoreDone(choreId: string) {
    await fetch('/api/checklists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark_chore_done', chore_id: choreId }),
    })
    reload()
  }

  async function saveChore() {
    if (!newChore.name.trim()) return
    await fetch('/api/checklists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_chore', ...newChore }),
    })
    setAddChore(false)
    setNewChore({ name: '', frequency: 'weekly', assigned_to: '', notes: '' })
    reload()
  }

  async function saveItem() {
    if (!newItem.name.trim()) return
    await fetch('/api/checklists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_monthly_item', ...newItem }),
    })
    setAddItem(false)
    setNewItem({ name: '', category: '' })
    reload()
  }

  const monthLabel = data
    ? new Date(data.currentMonth + '-01').toLocaleString('en-CA', { month: 'long', year: 'numeric' })
    : ''

  const choresByFreq = new Map<string, ChoreRow[]>()
  for (const c of data?.chores ?? []) {
    const k = c.frequency ?? 'as_needed'
    if (!choresByFreq.has(k)) choresByFreq.set(k, [])
    choresByFreq.get(k)!.push(c)
  }

  return (
    <div style={s.page}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={s.header}>Checklists</h1>
        <p style={s.sub}>Monthly close checklist · Address change · Household chores</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {(['monthly', 'address', 'chores'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              ...s.btn,
              background: tab === t ? 'var(--color-accent-gold)' : 'var(--color-surface-2)',
              color: tab === t ? '#000' : 'var(--color-text-muted)',
              border: '1px solid var(--color-border)',
              textTransform: 'capitalize',
            }}
          >
            {t === 'monthly' ? `Month-End ${data ? `(${data.completedCount}/${data.totalCount})` : ''}` : t === 'address' ? 'Address Change' : 'Chores'}
          </button>
        ))}
      </div>

      {loading && <div style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--text-small)' }}>Loading…</div>}
      {error && <div style={{ color: '#e5534b', fontSize: 'var(--text-small)' }}>{error}</div>}

      {/* Monthly Checklist */}
      {tab === 'monthly' && data && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-muted)' }}>{monthLabel}</span>
            <button onClick={() => setAddItem(!addItem)} style={{ ...s.btn, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
              + Add Item
            </button>
          </div>

          {addItem && (
            <div style={{ ...s.card, marginBottom: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 10, marginBottom: 10 }}>
                <input placeholder="Item name *" value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} style={{ ...s.input, width: '100%' }} autoFocus />
                <input placeholder="Category" value={newItem.category} onChange={(e) => setNewItem({ ...newItem, category: e.target.value })} style={{ ...s.input, width: '100%' }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={saveItem} style={{ ...s.btn, background: 'var(--color-pillar-health)', color: '#000' }}>Save</button>
                <button onClick={() => setAddItem(false)} style={{ ...s.btn, background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Cancel</button>
              </div>
            </div>
          )}

          {data.monthlyItems.map((item) => (
            <div
              key={item.id}
              style={{
                ...s.card,
                cursor: 'pointer',
                borderLeft: `3px solid ${item.completed_this_month ? 'var(--color-pillar-health)' : 'var(--color-border)'}`,
                opacity: toggling === item.id ? 0.5 : 1,
              }}
              onClick={() => toggleMonthly(item.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 18, height: 18, borderRadius: 4, border: '2px solid',
                  borderColor: item.completed_this_month ? 'var(--color-pillar-health)' : 'var(--color-border)',
                  background: item.completed_this_month ? 'var(--color-pillar-health)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {item.completed_this_month && <span style={{ color: '#000', fontSize: 11, fontWeight: 900 }}>✓</span>}
                </div>
                <div style={{ flex: 1 }}>
                  <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: item.completed_this_month ? 'var(--color-text-disabled)' : 'var(--color-text-primary)', textDecoration: item.completed_this_month ? 'line-through' : 'none' }}>
                    {item.name}
                  </span>
                </div>
                {item.category && (
                  <span style={{ fontFamily: 'var(--font-ui)', fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-disabled)' }}>
                    {item.category}
                  </span>
                )}
              </div>
            </div>
          ))}

          {data.completedCount === data.totalCount && data.totalCount > 0 && (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--color-pillar-health)', fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', fontWeight: 700 }}>
              Month-end complete ✓
            </div>
          )}
        </>
      )}

      {/* Address Change Checklist */}
      {tab === 'address' && data && (
        <>
          <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-muted)', marginBottom: 16 }}>
            Places to update your address when moving. {data.addressItems.length} items.
          </p>
          {(() => {
            const byCat = new Map<string, typeof data.addressItems>()
            for (const item of data.addressItems) {
              const k = item.category ?? 'Other'
              if (!byCat.has(k)) byCat.set(k, [])
              byCat.get(k)!.push(item)
            }
            return [...byCat.entries()].map(([cat, items]) => (
              <div key={cat} style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: 'var(--font-ui)', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-disabled)', marginBottom: 6 }}>{cat}</div>
                {items.map((item) => (
                  <div key={item.id} style={s.card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-primary)' }}>{item.place}</div>
                        {item.notes && <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)', marginTop: 2 }}>{item.notes}</div>}
                      </div>
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noopener noreferrer" style={s.link} onClick={(e) => e.stopPropagation()}>
                          Open →
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))
          })()}
        </>
      )}

      {/* Chores */}
      {tab === 'chores' && data && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button onClick={() => setAddChore(!addChore)} style={{ ...s.btn, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
              + Add Chore
            </button>
          </div>

          {addChore && (
            <div style={{ ...s.card, marginBottom: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 10, marginBottom: 10 }}>
                <input placeholder="Chore name *" value={newChore.name} onChange={(e) => setNewChore({ ...newChore, name: e.target.value })} style={{ ...s.input, width: '100%' }} autoFocus />
                <select value={newChore.frequency} onChange={(e) => setNewChore({ ...newChore, frequency: e.target.value })} style={{ ...s.input }}>
                  {Object.entries(FREQ_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <input placeholder="Assigned to" value={newChore.assigned_to} onChange={(e) => setNewChore({ ...newChore, assigned_to: e.target.value })} style={{ ...s.input, width: '100%' }} />
                <input placeholder="Notes" value={newChore.notes} onChange={(e) => setNewChore({ ...newChore, notes: e.target.value })} style={{ ...s.input, width: '100%' }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={saveChore} style={{ ...s.btn, background: 'var(--color-pillar-health)', color: '#000' }}>Save</button>
                <button onClick={() => setAddChore(false)} style={{ ...s.btn, background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Cancel</button>
              </div>
            </div>
          )}

          {data.chores.length === 0 && (
            <div style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--text-small)' }}>No chores yet. Add one above.</div>
          )}

          {[...choresByFreq.entries()].map(([freq, chores]) => (
            <div key={freq} style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: 'var(--font-ui)', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-disabled)', marginBottom: 6 }}>
                {FREQ_LABELS[freq] ?? freq}
              </div>
              {chores.map((chore) => {
                const ago = daysAgo(chore.last_done)
                return (
                  <div key={chore.id} style={s.card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-primary)' }}>{chore.name}</div>
                        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                          {chore.assigned_to && <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)' }}>→ {chore.assigned_to}</span>}
                          {ago !== null
                            ? <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: ago > 14 ? '#e5534b' : 'var(--color-text-disabled)' }}>{ago === 0 ? 'Done today' : `${ago}d ago`}</span>
                            : <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)' }}>Never done</span>
                          }
                        </div>
                      </div>
                      <button onClick={() => markChoreDone(chore.id)} style={{ ...s.btn, background: 'var(--color-pillar-health)', color: '#000' }}>
                        Done ✓
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
