'use client'

import { useEffect, useState, useCallback } from 'react'
import type { ContactsResponse, ContactRow } from '@/app/api/contacts/route'

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  business: { label: 'Business', color: 'var(--color-accent-gold)' },
  personal: { label: 'Personal', color: 'var(--color-pillar-health)' },
  vendor:   { label: 'Vendor',   color: 'var(--color-text-muted)' },
  family:   { label: 'Family',   color: '#7c8fdb' },
}

const CATEGORY_ORDER = ['business', 'personal', 'family', 'vendor', 'other']

const s = {
  page:      { padding: '28px 32px', maxWidth: 960, margin: '0 auto', fontFamily: 'var(--font-ui)' } as React.CSSProperties,
  header:    { fontFamily: 'var(--font-display, var(--font-ui))', fontSize: '1.15rem', fontWeight: 800, letterSpacing: '0.06em', color: 'var(--color-text-primary)', textTransform: 'uppercase' as const, margin: 0 },
  sub:       { fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-muted)', margin: '6px 0 0' },
  input:     { fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-primary)', padding: '7px 10px', width: '100%', boxSizing: 'border-box' as const },
  btn:       { fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', fontWeight: 600, padding: '6px 14px', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' },
  card:      { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 20, overflow: 'hidden' } as React.CSSProperties,
  catHeader: { padding: '8px 16px', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--color-text-disabled)' },
}

function badge(type: string) {
  const t = TYPE_LABELS[type] ?? { label: type, color: 'var(--color-text-disabled)' }
  return (
    <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: t.color }}>
      {t.label}
    </span>
  )
}

export function ContactsPage() {
  const [data, setData] = useState<ContactsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newContact, setNewContact] = useState({ name: '', company: '', type: 'personal', email: '', phone: '', address: '', notes: '', category: '' })
  const [saving, setSaving] = useState(false)

  const [refreshKey, setRefreshKey] = useState(0)
  const reload = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    fetch('/api/contacts')
      .then((r) => r.json())
      .then((d: ContactsResponse & { error?: string }) => {
        if (cancelled) return
        if (d.error) setError(d.error)
        else setData(d)
        setLoading(false)
      })
      .catch((e: unknown) => { if (!cancelled) { setError(String(e)); setLoading(false) } })
    return () => { cancelled = true }
  }, [refreshKey])

  const filtered = (data?.contacts ?? []).filter((c) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      c.name.toLowerCase().includes(q) ||
      (c.company ?? '').toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q) ||
      (c.phone ?? '').toLowerCase().includes(q) ||
      (c.notes ?? '').toLowerCase().includes(q)
    )
  })

  const byCategory = new Map<string, ContactRow[]>()
  for (const c of filtered) {
    const key = c.category ?? c.type ?? 'other'
    if (!byCategory.has(key)) byCategory.set(key, [])
    byCategory.get(key)!.push(c)
  }

  const orderedCats = CATEGORY_ORDER.filter((c) => byCategory.has(c)).concat(
    [...byCategory.keys()].filter((c) => !CATEGORY_ORDER.includes(c))
  )

  async function handleAdd() {
    if (!newContact.name.trim()) return
    setSaving(true)
    await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...newContact,
        category: newContact.category.trim() || newContact.type,
      }),
    })
    setSaving(false)
    setShowAdd(false)
    setNewContact({ name: '', company: '', type: 'personal', email: '', phone: '', address: '', notes: '', category: '' })
    reload()
  }

  async function deleteContact(id: string) {
    await fetch(`/api/contacts?id=${id}`, { method: 'DELETE' })
    reload()
  }

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={s.header}>Contacts</h1>
          <p style={s.sub}>Business, personal, family, and vendor contacts.</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} style={{ ...s.btn, background: 'var(--color-accent-gold)', color: '#000' }}>
          + Add Contact
        </button>
      </div>

      <input
        type="text"
        placeholder="Search contacts…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ ...s.input, marginBottom: 16, maxWidth: 360 }}
      />

      {showAdd && (
        <div style={{ ...s.card, padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <input placeholder="Name *" value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} style={s.input} autoFocus />
            <input placeholder="Company" value={newContact.company} onChange={(e) => setNewContact({ ...newContact, company: e.target.value })} style={s.input} />
            <input placeholder="Email" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} style={s.input} />
            <input placeholder="Phone" value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} style={s.input} />
            <select value={newContact.type} onChange={(e) => setNewContact({ ...newContact, type: e.target.value })} style={{ ...s.input }}>
              <option value="personal">Personal</option>
              <option value="business">Business</option>
              <option value="family">Family</option>
              <option value="vendor">Vendor</option>
            </select>
            <input placeholder="Category (optional)" value={newContact.category} onChange={(e) => setNewContact({ ...newContact, category: e.target.value })} style={s.input} />
          </div>
          <input placeholder="Address" value={newContact.address} onChange={(e) => setNewContact({ ...newContact, address: e.target.value })} style={{ ...s.input, marginBottom: 10 }} />
          <input placeholder="Notes" value={newContact.notes} onChange={(e) => setNewContact({ ...newContact, notes: e.target.value })} style={{ ...s.input, marginBottom: 10 }} />
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

      {!loading && data && (
        <div style={{ fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)', marginBottom: 12 }}>
          {filtered.length} of {data.contacts.length} contacts
        </div>
      )}

      {orderedCats.map((cat) => {
        const rows = byCategory.get(cat) ?? []
        if (rows.length === 0) return null
        const label = cat.charAt(0).toUpperCase() + cat.slice(1)
        return (
          <div key={cat} style={s.card}>
            <div style={s.catHeader}>{label} · {rows.length}</div>
            {rows.map((contact) => (
              <div key={contact.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 2 }}>
                    <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                      {contact.name}
                    </span>
                    {contact.company && (
                      <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-muted)' }}>
                        {contact.company}
                      </span>
                    )}
                    {badge(contact.type)}
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 4 }}>
                    {contact.email && (
                      <a href={`mailto:${contact.email}`} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--color-accent-gold)', textDecoration: 'none' }}>
                        {contact.email}
                      </a>
                    )}
                    {contact.phone && (
                      <a href={`tel:${contact.phone}`} style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-muted)', textDecoration: 'none' }}>
                        {contact.phone}
                      </a>
                    )}
                  </div>
                  {contact.address && (
                    <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)', marginTop: 3 }}>
                      {contact.address}
                    </div>
                  )}
                  {contact.notes && (
                    <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)', marginTop: 3 }}>
                      {contact.notes}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => deleteContact(contact.id)}
                  style={{ ...s.btn, background: 'none', border: '1px solid var(--color-border)', color: '#e5534b', fontSize: '0.6rem', flexShrink: 0 }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )
      })}

      {!loading && filtered.length === 0 && (
        <div style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--text-small)', marginTop: 24 }}>
          No contacts found{search ? ` for "${search}"` : ''}.
        </div>
      )}
    </div>
  )
}
