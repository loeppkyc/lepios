'use client'

import { useEffect, useState, useCallback } from 'react'
import type { VaultResponse, VaultEntry } from '@/app/api/vault/route'

const CATEGORY_LABELS: Record<string, string> = {
  email:          'Email',
  amazon:         'Amazon',
  amazon_tools:   'Amazon Tools',
  business_tools: 'Business Tools',
  logistics:      'Logistics',
  social:         'Social',
  retail:         'Retail',
  other:          'Other',
}

const s = {
  page: { padding: '28px 32px', maxWidth: 1100, margin: '0 auto', fontFamily: 'var(--font-ui)' } as React.CSSProperties,
  header: { fontFamily: 'var(--font-display, var(--font-ui))', fontSize: '1.15rem', fontWeight: 800, letterSpacing: '0.06em', color: 'var(--color-text-primary)', textTransform: 'uppercase' as const, margin: 0 },
  sub: { fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-muted)', margin: '6px 0 0' },
  card: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 20, overflow: 'hidden' } as React.CSSProperties,
  catHeader: { padding: '8px 16px', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--color-text-disabled)' },
  row: { display: 'grid', gridTemplateColumns: '200px 1fr 160px auto', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--color-border)', alignItems: 'center' } as React.CSSProperties,
  service: { fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', fontWeight: 600, color: 'var(--color-text-primary)' },
  username: { fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--color-text-muted)', wordBreak: 'break-all' as const },
  notes: { fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)' },
  link: { fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-accent-gold)', textDecoration: 'none' as const, fontWeight: 600 },
  input: { fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-primary)', padding: '7px 10px', width: '100%', boxSizing: 'border-box' as const },
  btn: { fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', fontWeight: 600, padding: '6px 14px', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' },
}

export function VaultPage() {
  const [data, setData] = useState<VaultResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newEntry, setNewEntry] = useState({ service: '', username: '', url: '', notes: '', category: 'other' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/vault')
      .then((r) => r.json())
      .then((d: VaultResponse & { error?: string }) => {
        if (d.error) setError(d.error)
        else setData(d)
        setLoading(false)
      })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = (data?.entries ?? []).filter((e) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      e.service.toLowerCase().includes(q) ||
      (e.username ?? '').toLowerCase().includes(q) ||
      (e.notes ?? '').toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q)
    )
  })

  const byCategory = new Map<string, VaultEntry[]>()
  for (const e of filtered) {
    if (!byCategory.has(e.category)) byCategory.set(e.category, [])
    byCategory.get(e.category)!.push(e)
  }

  const categoryOrder = ['email', 'amazon', 'amazon_tools', 'business_tools', 'logistics', 'social', 'retail', 'other']
  const orderedCats = categoryOrder.filter((c) => byCategory.has(c)).concat(
    [...byCategory.keys()].filter((c) => !categoryOrder.includes(c))
  )

  async function handleAdd() {
    if (!newEntry.service.trim()) return
    setSaving(true)
    await fetch('/api/vault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newEntry),
    })
    setSaving(false)
    setShowAdd(false)
    setNewEntry({ service: '', username: '', url: '', notes: '', category: 'other' })
    load()
  }

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={s.header}>Account Vault</h1>
          <p style={s.sub}>Service logins — username + URL reference. No passwords stored.</p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          style={{ ...s.btn, background: 'var(--color-accent-gold)', color: '#000' }}
        >
          + Add
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search services, usernames…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ ...s.input, marginBottom: 16, maxWidth: 360 }}
      />

      {/* Add form */}
      {showAdd && (
        <div style={{ ...s.card, padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <input placeholder="Service name *" value={newEntry.service} onChange={(e) => setNewEntry({ ...newEntry, service: e.target.value })} style={s.input} />
            <input placeholder="Username / email" value={newEntry.username} onChange={(e) => setNewEntry({ ...newEntry, username: e.target.value })} style={s.input} />
            <input placeholder="URL (https://...)" value={newEntry.url} onChange={(e) => setNewEntry({ ...newEntry, url: e.target.value })} style={s.input} />
            <select value={newEntry.category} onChange={(e) => setNewEntry({ ...newEntry, category: e.target.value })} style={{ ...s.input }}>
              {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <input placeholder="Notes" value={newEntry.notes} onChange={(e) => setNewEntry({ ...newEntry, notes: e.target.value })} style={{ ...s.input, marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleAdd} disabled={saving} style={{ ...s.btn, background: 'var(--color-pillar-health)', color: '#000' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setShowAdd(false)} style={{ ...s.btn, background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && <div style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--text-small)' }}>Loading…</div>}
      {error && <div style={{ color: '#e5534b', fontSize: 'var(--text-small)' }}>{error}</div>}

      {/* Count badge */}
      {!loading && data && (
        <div style={{ fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)', marginBottom: 12 }}>
          {filtered.length} of {data.entries.length} services
        </div>
      )}

      {orderedCats.map((cat) => {
        const rows = byCategory.get(cat) ?? []
        if (rows.length === 0) return null
        return (
          <div key={cat} style={s.card}>
            <div style={s.catHeader}>{CATEGORY_LABELS[cat] ?? cat} · {rows.length}</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.id} style={{ borderBottom: '1px solid var(--color-border)', opacity: entry.is_active ? 1 : 0.5 }}>
                    <td style={{ padding: '10px 16px', width: 220 }}>
                      <div style={s.service}>{entry.service}</div>
                      {entry.notes && <div style={s.notes}>{entry.notes}</div>}
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      {entry.username
                        ? <span style={s.username}>{entry.username}</span>
                        : <span style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--text-nano)' }}>—</span>
                      }
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                      {entry.url
                        ? <a href={entry.url} target="_blank" rel="noopener noreferrer" style={s.link}>Open →</a>
                        : null
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}

      {!loading && filtered.length === 0 && (
        <div style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--text-small)', marginTop: 24 }}>
          No services found{search ? ` for "${search}"` : ''}.
        </div>
      )}
    </div>
  )
}
