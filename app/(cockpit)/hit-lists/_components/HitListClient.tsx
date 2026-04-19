'use client'

import { useState, useEffect } from 'react'
import { CockpitInput } from '@/components/cockpit/CockpitInput'

interface HitList {
  id: string
  name: string
  created_at: string
  item_count: number
}

interface HitListItem {
  id: string
  isbn: string
  status: 'pending' | 'scanned' | 'skipped'
  added_at: string
}

interface AddResult {
  added: number
  skipped: number
}

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-nano)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-text-disabled)',
  display: 'block',
  marginBottom: 4,
}

const btnStyle = (disabled: boolean): React.CSSProperties => ({
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-body)',
  fontWeight: 600,
  padding: '8px 20px',
  background: disabled ? 'var(--color-surface-2)' : 'var(--color-accent-gold)',
  color: disabled ? 'var(--color-text-disabled)' : 'var(--color-base)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  transition: 'background var(--transition-fast)',
  flexShrink: 0,
})

const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--color-text-muted)',
  scanned: 'var(--color-positive)',
  skipped: 'var(--color-text-disabled)',
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

export function HitListClient() {
  const [lists, setLists] = useState<HitList[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [items, setItems] = useState<HitListItem[]>([])
  const [newName, setNewName] = useState('')
  const [isbnText, setIsbnText] = useState('')
  const [addResult, setAddResult] = useState<AddResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingLists, setLoadingLists] = useState(true)
  const [loadingItems, setLoadingItems] = useState(false)
  const [deletingList, setDeletingList] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchLists()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedId) { setItems([]); return }
    fetchItems(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  async function fetchLists(selectId?: string) {
    setLoadingLists(true)
    try {
      const res = await fetch('/api/hit-lists')
      if (!res.ok) return
      const data: HitList[] = await res.json()
      setLists(data)
      if (selectId) {
        setSelectedId(selectId)
      } else if (data.length > 0 && !selectedId) {
        setSelectedId(data[0].id)
      }
    } finally {
      setLoadingLists(false)
    }
  }

  async function fetchItems(listId: string) {
    setLoadingItems(true)
    try {
      const res = await fetch(`/api/hit-lists/${listId}/items`)
      if (!res.ok) return
      const data: HitListItem[] = await res.json()
      setItems(data)
    } finally {
      setLoadingItems(false)
    }
  }

  async function handleCreateList(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/hit-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to create list'); return }
      setNewName('')
      await fetchLists(data.id)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  async function handleAddIsbns(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedId) return
    const capturedId = selectedId
    const isbns = isbnText.split('\n').map((s) => s.trim()).filter(Boolean)
    if (isbns.length === 0) return

    setLoading(true)
    setError(null)
    setAddResult(null)
    try {
      const res = await fetch(`/api/hit-lists/${capturedId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbns }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to add ISBNs'); return }
      setAddResult(data as AddResult)
      await Promise.all([fetchLists(capturedId), fetchItems(capturedId)])
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteItem(itemId: string) {
    const capturedId = selectedId
    const res = await fetch(`/api/hit-lists/${capturedId}/items/${itemId}`, { method: 'DELETE' })
    if (!res.ok) return
    setItems((prev) => prev.filter((i) => i.id !== itemId))
    // Refresh dropdown count
    const listsRes = await fetch('/api/hit-lists')
    if (listsRes.ok) setLists(await listsRes.json())
  }

  async function handleDeleteList() {
    const list = lists.find((l) => l.id === selectedId)
    if (!list) return
    const n = list.item_count
    const ok = window.confirm(
      `Delete "${list.name}" and all ${n} ISBN${n !== 1 ? 's' : ''}?`
    )
    if (!ok) return

    setDeletingList(true)
    try {
      const res = await fetch(`/api/hit-lists/${selectedId}`, { method: 'DELETE' })
      if (!res.ok) { setError('Failed to delete list'); return }
      const remaining = lists.filter((l) => l.id !== selectedId)
      setLists(remaining)
      setItems([])
      setAddResult(null)
      setSelectedId(remaining.length > 0 ? remaining[0].id : '')
    } catch {
      setError('Network error')
    } finally {
      setDeletingList(false)
    }
  }

  const selectedList = lists.find((l) => l.id === selectedId)
  const pendingCount = items.filter((i) => i.status === 'pending').length

  return (
    <div
      style={{
        maxWidth: 520,
        margin: '0 auto',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
      }}
    >
      <div>
        <h1
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-heading)',
            fontWeight: 700,
            color: 'var(--color-text-primary)',
            margin: 0,
          }}
        >
          Hit Lists
        </h1>
        <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-muted)', margin: '4px 0 0' }}>
          Persistent ISBN queue
        </p>
      </div>

      {/* Create new list */}
      <form onSubmit={handleCreateList} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <CockpitInput
            label="New list"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="April Pallet"
            maxLength={80}
          />
        </div>
        <button type="submit" disabled={loading || !newName.trim()} style={btnStyle(loading || !newName.trim())}>
          Add
        </button>
      </form>

      {loadingLists && (
        <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)' }}>
          Loading…
        </p>
      )}

      {/* List selector */}
      {!loadingLists && lists.length > 0 && (
        <div>
          <label style={labelStyle}>Select list</label>
          <select
            value={selectedId}
            onChange={(e) => { setSelectedId(e.target.value); setAddResult(null) }}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-body)',
              color: 'var(--color-text-primary)',
              backgroundColor: 'var(--color-surface-2)',
              border: '1px solid var(--color-border-accent)',
              borderRadius: 'var(--radius-md)',
              padding: '6px 10px',
              width: '100%',
              outline: 'none',
            }}
          >
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.item_count} item{l.item_count !== 1 ? 's' : ''})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Add ISBNs */}
      {!loadingLists && selectedId && (
        <form onSubmit={handleAddIsbns} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label htmlFor="isbn-textarea" style={labelStyle}>Add ISBNs</label>
            <textarea
              id="isbn-textarea"
              value={isbnText}
              onChange={(e) => { setIsbnText(e.target.value); setAddResult(null) }}
              placeholder={'9780062316097\n9780385490818'}
              rows={5}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-body)',
                color: 'var(--color-text-primary)',
                backgroundColor: 'var(--color-surface-2)',
                border: '1px solid var(--color-border-accent)',
                borderRadius: 'var(--radius-md)',
                padding: '8px 10px',
                width: '100%',
                outline: 'none',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button type="submit" disabled={loading || !isbnText.trim()} style={btnStyle(loading || !isbnText.trim())}>
              {loading ? 'Adding…' : 'Add to list'}
            </button>
            {addResult && (
              <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-muted)' }}>
                {addResult.added} added{addResult.skipped > 0 ? `, ${addResult.skipped} already in list` : ''}
              </span>
            )}
          </div>
        </form>
      )}

      {/* Item list panel */}
      {!loadingLists && selectedId && selectedList && (
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-accent)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}
        >
          {/* Panel header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-muted)' }}>
              <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {selectedList.name}
              </span>
              {' · '}
              {selectedList.item_count} ISBN{selectedList.item_count !== 1 ? 's' : ''}
              {pendingCount > 0 && ` · ${pendingCount} pending`}
            </span>
            <button
              onClick={handleDeleteList}
              disabled={deletingList}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                fontWeight: 600,
                letterSpacing: '0.06em',
                padding: '3px 10px',
                background: 'transparent',
                color: 'var(--color-critical)',
                border: '1px solid var(--color-critical)',
                borderRadius: 'var(--radius-sm)',
                cursor: deletingList ? 'not-allowed' : 'pointer',
                opacity: deletingList ? 0.5 : 1,
              }}
            >
              Delete list
            </button>
          </div>

          {/* Item rows */}
          {loadingItems ? (
            <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)', padding: '12px 14px', margin: 0 }}>
              Loading…
            </p>
          ) : items.length === 0 ? (
            <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)', padding: '12px 14px', margin: 0 }}>
              No items yet. Add ISBNs above.
            </p>
          ) : (
            <div>
              {items.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 14px',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)', color: 'var(--color-text-primary)', flex: 1 }}>
                    {item.isbn}
                  </span>
                  <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: STATUS_COLOR[item.status] ?? 'var(--color-text-muted)', fontWeight: 600, letterSpacing: '0.06em', minWidth: 52 }}>
                    {item.status}
                  </span>
                  <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)', minWidth: 48 }}>
                    {fmtDate(item.added_at)}
                  </span>
                  <button
                    onClick={() => handleDeleteItem(item.id)}
                    aria-label={`Remove ${item.isbn}`}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--color-text-disabled)',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-ui)',
                      fontSize: '1rem',
                      lineHeight: 1,
                      padding: '0 2px',
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-body)',
            color: 'var(--color-critical)',
            background: 'var(--color-critical-dim)',
            border: '1px solid var(--color-critical)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}
