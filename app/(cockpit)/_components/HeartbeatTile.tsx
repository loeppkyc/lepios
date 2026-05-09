'use client'

import { useEffect, useState } from 'react'

interface LeaseResponse {
  status: 'alive' | 'stale'
  last_heartbeat_at: string | null
  age_seconds: number | null
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3600)}h ago`
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  // Edmonton = America/Edmonton (MT: UTC-7 MDT / UTC-6 MST)
  const mt = d.toLocaleTimeString('en-CA', {
    timeZone: 'America/Edmonton',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const utc = d.toLocaleTimeString('en-CA', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${mt} MT / ${utc} UTC`
}

export function HeartbeatTile() {
  const [lease, setLease] = useState<LeaseResponse | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    async function fetch_() {
      try {
        const res = await fetch('/api/health/lease')
        const json = (await res.json()) as LeaseResponse
        setLease(json)
      } catch {
        setLease(null)
      }
    }
    void fetch_()
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [tick])

  // Color thresholds
  const color =
    !lease || lease.status === 'stale' || lease.age_seconds === null
      ? 'var(--color-status-error, #ef4444)'
      : lease.age_seconds < 300
        ? 'var(--color-status-success, #22c55e)'
        : 'var(--color-status-warning, #f59e0b)'

  const label = !lease
    ? 'Heartbeat: …'
    : lease.last_heartbeat_at === null
      ? 'Heartbeat: never'
      : `Heartbeat: ${formatAge(lease.age_seconds ?? 0)}`

  const tooltip = lease?.last_heartbeat_at ? formatTimestamp(lease.last_heartbeat_at) : undefined

  return (
    <div
      title={tooltip}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 14px 6px',
        cursor: tooltip ? 'default' : undefined,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: '0.6rem',
          color: 'var(--color-text-muted)',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </span>
    </div>
  )
}
