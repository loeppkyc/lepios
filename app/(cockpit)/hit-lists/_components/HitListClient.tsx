'use client'

import { useState, useEffect } from 'react'
import { CockpitInput } from '@/components/cockpit/CockpitInput'

interface HitList {
  id: string
  name: string
  created_at: string
  item_count: number
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

export function HitListClient() {
  const [lists, setLists] = useState<HitList[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [newName, setNewName] = useState('')
  const [isbnText, setIsbnText] = useState('')
  const [addResult, setAddResult] = useState<AddResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingLists, setLoadingLists] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchLists()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      if (!res.ok) {
        setError(data.error ?? 'Failed to create list')
        return
      }
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
    const isbns = isbnText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (isbns.length === 0) return

    setLoading(true)
    setError(null)
    setAddResult(null)
    try {
      const res = await fetch(`/api/hit-lists/${selectedId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbns }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to add ISBNs')
        return
      }
      setAddResult(data as AddResult)
      await fetchLists(selectedId)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

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
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            margin: '4px 0 0',
          }}
        >
          Persistent ISBN queue · Chunk E.1
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
        <button
          type="submit"
          disabled={loading || !newName.trim()}
          style={btnStyle(loading || !newName.trim())}
        >
          Add
        </button>
      </form>

      {/* List selector */}
      {!loadingLists && lists.length > 0 && (
        <div>
          <label style={labelStyle}>Select list</label>
          <select
            value={selectedId}
            onChange={(e) => {
              setSelectedId(e.target.value)
              setAddResult(null)
            }}
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

      {loadingLists && (
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
          }}
        >
          Loading…
        </p>
      )}

      {/* Add ISBNs */}
      {!loadingLists && selectedId && (
        <form
          onSubmit={handleAddIsbns}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <div>
            <label htmlFor="isbn-textarea" style={labelStyle}>
              Add ISBNs
            </label>
            <textarea
              id="isbn-textarea"
              value={isbnText}
              onChange={(e) => {
                setIsbnText(e.target.value)
                setAddResult(null)
              }}
              placeholder={'9780062316097\n9780385490818'}
              rows={6}
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
            <button
              type="submit"
              disabled={loading || !isbnText.trim()}
              style={btnStyle(loading || !isbnText.trim())}
            >
              {loading ? 'Adding…' : 'Add to list'}
            </button>
            {addResult && (
              <span
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {addResult.added} added
                {addResult.skipped > 0 ? `, ${addResult.skipped} already in list` : ''}
              </span>
            )}
          </div>
        </form>
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
