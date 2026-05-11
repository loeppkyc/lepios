'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface FbaBatch {
  id: string
  name: string
  status: string
  source: string | null
  created_at: string
  item_count: number
}

const sectionLabel: React.CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-nano)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-text-disabled)',
  marginBottom: 8,
}

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: '14px 16px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  transition: 'border-color var(--transition-fast)',
}

export function BatchesClient() {
  const router = useRouter()
  const [batches, setBatches] = useState<FbaBatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // New batch form state
  const [formOpen, setFormOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSource, setNewSource] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  async function fetchBatches() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/batches')
      if (!res.ok) {
        setError('Failed to load batches')
        return
      }
      const data = await res.json()
      setBatches(data as FbaBatch[])
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchBatches()
  }, [])

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          source: newSource.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCreateError(data.error ?? 'Failed to create batch')
        return
      }
      setNewName('')
      setNewSource('')
      setFormOpen(false)
      await fetchBatches()
    } catch {
      setCreateError('Network error')
    } finally {
      setCreating(false)
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-CA', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <div
      style={{
        maxWidth: 640,
        margin: '0 auto',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
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
            FBA Batches
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-text-muted)',
              margin: '4px 0 0',
            }}
          >
            Open batches — items pending shipment to Amazon FBA
          </p>
        </div>
        {!formOpen && (
          <button
            onClick={() => setFormOpen(true)}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              fontWeight: 700,
              padding: '8px 16px',
              background: 'var(--color-accent-gold)',
              color: 'var(--color-base)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
          >
            New Batch
          </button>
        )}
      </div>

      {/* New batch inline form */}
      {formOpen && (
        <div
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={sectionLabel}>New Batch</div>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Batch name (e.g. May10-GW)"
            maxLength={80}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              padding: '8px 10px',
              background: 'var(--color-surface)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
            }}
          />
          <input
            value={newSource}
            onChange={(e) => setNewSource(e.target.value)}
            placeholder="Source (optional — e.g. GoodWill, Thrift)"
            maxLength={80}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              padding: '8px 10px',
              background: 'var(--color-surface)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                fontWeight: 700,
                padding: '8px 16px',
                background:
                  creating || !newName.trim()
                    ? 'var(--color-surface-2)'
                    : 'var(--color-accent-gold)',
                color:
                  creating || !newName.trim() ? 'var(--color-text-disabled)' : 'var(--color-base)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                cursor: creating || !newName.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {creating ? 'Creating…' : 'Create Batch'}
            </button>
            <button
              onClick={() => {
                setFormOpen(false)
                setNewName('')
                setNewSource('')
                setCreateError(null)
              }}
              disabled={creating}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                padding: '8px 14px',
                background: 'none',
                color: 'var(--color-text-disabled)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                cursor: creating ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
          {createError && (
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                color: 'var(--color-critical)',
              }}
            >
              {createError}
            </div>
          )}
        </div>
      )}

      {/* Batch list */}
      {loading && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
          }}
        >
          Loading batches…
        </div>
      )}

      {error && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-critical)',
            background: 'var(--color-critical-dim)',
            border: '1px solid var(--color-critical)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
          }}
        >
          {error}
        </div>
      )}

      {!loading && !error && batches.length === 0 && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
            textAlign: 'center',
            padding: '32px 0',
          }}
        >
          No open batches. Create one to start adding items.
        </div>
      )}

      {!loading && batches.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={sectionLabel}>Open Batches ({batches.length})</div>
          {batches.map((batch) => (
            <div
              key={batch.id}
              style={cardStyle}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/batches/${batch.id}`)}
              onKeyDown={(e) => e.key === 'Enter' && router.push(`/batches/${batch.id}`)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-body)',
                    fontWeight: 600,
                    color: 'var(--color-text-primary)',
                    marginBottom: 2,
                  }}
                >
                  {batch.name}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-small)',
                    color: 'var(--color-text-muted)',
                    display: 'flex',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  {batch.source && <span>{batch.source}</span>}
                  <span>{formatDate(batch.created_at)}</span>
                </div>
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-small)',
                  fontWeight: 600,
                  color: 'var(--color-text-muted)',
                  flexShrink: 0,
                }}
              >
                {batch.item_count} item{batch.item_count !== 1 ? 's' : ''}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  color: 'var(--color-text-disabled)',
                  flexShrink: 0,
                }}
              >
                →
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
