'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface FbaBatch {
  id: string
  name: string
  status: string
  source: string | null
  created_at: string
  updated_at: string
}

interface FbaBatchItem {
  id: string
  sku: string | null
  asin: string
  isbn: string | null
  title: string | null
  condition_code: string | null
  list_price_cad: number | null
  status: 'pending' | 'listed' | 'shipped'
  added_at: string
}

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  pending: { bg: 'var(--color-overlay)', color: 'var(--color-text-muted)' },
  listed: { bg: 'var(--color-positive)', color: 'var(--color-base)' },
  shipped: { bg: 'var(--color-accent-gold)', color: 'var(--color-base)' },
}

const cellLabel: React.CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-nano)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-text-disabled)',
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.pending
  return (
    <span
      style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-nano)',
        fontWeight: 700,
        letterSpacing: '0.06em',
        padding: '2px 8px',
        borderRadius: 'var(--radius-sm)',
        background: style.bg,
        color: style.color,
        textTransform: 'uppercase',
      }}
    >
      {status}
    </span>
  )
}

export function BatchDetailClient({ batchId }: { batchId: string }) {
  const [batch, setBatch] = useState<FbaBatch | null>(null)
  const [items, setItems] = useState<FbaBatchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function fetchData() {
    setLoading(true)
    setError(null)
    try {
      const [batchRes, itemsRes] = await Promise.all([
        fetch(`/api/batches/${batchId}`),
        fetch(`/api/batches/${batchId}/items`),
      ])

      if (!batchRes.ok) {
        setError('Batch not found')
        return
      }

      const batchData = await batchRes.json()
      const itemsData = itemsRes.ok ? await itemsRes.json() : []

      setBatch(batchData as FbaBatch)
      setItems(itemsData as FbaBatchItem[])
    } catch {
      setError('Network error loading batch')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData()
  }, [batchId]) // eslint-disable-line react-hooks/exhaustive-deps

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-CA', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  function truncate(str: string | null, len: number): string {
    if (!str) return '—'
    return str.length > len ? str.slice(0, len) + '…' : str
  }

  if (loading) {
    return (
      <div
        style={{
          maxWidth: 800,
          margin: '0 auto',
          padding: '24px 16px',
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-disabled)',
        }}
      >
        Loading batch…
      </div>
    )
  }

  if (error || !batch) {
    return (
      <div
        style={{
          maxWidth: 800,
          margin: '0 auto',
          padding: '24px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <Link
          href="/batches"
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            textDecoration: 'none',
          }}
        >
          ← Back to Batches
        </Link>
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-critical)',
          }}
        >
          {error ?? 'Batch not found'}
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        maxWidth: 800,
        margin: '0 auto',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
      }}
    >
      {/* Back link */}
      <Link
        href="/batches"
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-muted)',
          textDecoration: 'none',
          alignSelf: 'flex-start',
        }}
      >
        ← Back to Batches
      </Link>

      {/* Batch header */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 4,
          }}
        >
          <h1
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-heading)',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              margin: 0,
            }}
          >
            {batch.name}
          </h1>
          <StatusBadge status={batch.status} />
        </div>
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          {batch.source && <span>Source: {batch.source}</span>}
          <span>Created: {formatDate(batch.created_at)}</span>
          <span>
            {items.length} item{items.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Items table */}
      {items.length === 0 ? (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
            textAlign: 'center',
            padding: '32px 0',
          }}
        >
          No items in this batch yet. Add items from the Scanner.
        </div>
      ) : (
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
          }}
        >
          {/* Table header */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '120px 80px 1fr 80px 70px 80px',
              gap: 0,
              padding: '10px 16px',
              background: 'var(--color-surface-2)',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <div style={cellLabel}>SKU</div>
            <div style={cellLabel}>ISBN</div>
            <div style={cellLabel}>Title</div>
            <div style={cellLabel}>Condition</div>
            <div style={cellLabel}>Price</div>
            <div style={cellLabel}>Status</div>
          </div>

          {/* Table rows */}
          {items.map((item, idx) => (
            <div
              key={item.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 80px 1fr 80px 70px 80px',
                gap: 0,
                padding: '10px 16px',
                borderBottom: idx < items.length - 1 ? '1px solid var(--color-border)' : 'none',
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.sku ?? '—'}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {item.isbn ?? '—'}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={item.title ?? undefined}
              >
                {truncate(item.title, 40)}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {item.condition_code ?? '—'}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-primary)',
                }}
              >
                {item.list_price_cad != null ? `$${item.list_price_cad.toFixed(2)}` : '—'}
              </div>
              <div>
                <StatusBadge status={item.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
