'use client'

import { useEffect, useState } from 'react'
import type { ConnectionStatus, ConnectionsResponse } from '@/app/api/money/connections/route'

function timeAgo(isoString: string | null): string {
  if (!isoString) return 'never'
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function statusColor(status: ConnectionStatus['status']): string {
  if (status === 'connected') return 'var(--color-positive)'
  if (status === 'pending') return 'var(--color-warning)'
  return 'var(--color-critical)'
}

export function ConnectionsHealth() {
  const [data, setData] = useState<ConnectionsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/money/connections')
      .then((r) => r.json())
      .then((d: ConnectionsResponse & { error?: string }) => {
        if (d.error) { setError(d.error); return }
        setData(d)
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const panelStyle = {
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 8,
    padding: '20px 24px',
  }

  if (loading) return <div style={{ ...panelStyle, minHeight: 200 }} />

  if (error) {
    return (
      <div
        style={{
          ...panelStyle,
          color: 'var(--color-critical)',
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
        }}
      >
        {error}
      </div>
    )
  }

  if (!data) return null

  return (
    <div style={panelStyle}>
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-label)',
          fontWeight: 600,
          color: 'var(--color-text-muted)',
          marginBottom: 16,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        Connections
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {data.connections.map((c) => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: statusColor(c.status),
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-body)',
                  color: 'var(--color-text-primary)',
                }}
              >
                {c.name}
              </span>
            </div>
            <span
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                color: 'var(--color-text-muted)',
              }}
            >
              {c.status === 'pending'
                ? 'B5 pending'
                : c.lastActivityAt
                  ? timeAgo(c.lastActivityAt)
                  : c.status === 'connected'
                    ? 'connected'
                    : 'not connected'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
