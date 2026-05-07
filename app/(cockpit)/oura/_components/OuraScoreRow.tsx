'use client'

import type { OuraDailyRow } from '@/lib/oura/sync'
import { pickLatest } from '@/lib/oura/helpers'

function formatLatestDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--color-text-disabled)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-pillar-value)',
          fontWeight: 700,
          color: 'var(--color-text-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  )
}

export function OuraScoreRow({ rows }: { rows: OuraDailyRow[] }) {
  const latest = pickLatest(rows)
  if (!latest) return null

  const fmt = (v: number | null, digits = 0): string =>
    v == null ? '—' : digits === 0 ? Math.round(v).toString() : v.toFixed(digits)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-muted)',
          letterSpacing: '0.04em',
        }}
      >
        Latest · {formatLatestDate(latest.date)}
      </span>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 16,
        }}
      >
        <MetricCell label="Sleep" value={fmt(latest.sleep_score)} />
        <MetricCell label="Readiness" value={fmt(latest.readiness_score)} />
        <MetricCell label="Activity" value={fmt(latest.activity_score)} />
        <MetricCell label="HRV" value={fmt(latest.hrv)} />
        <MetricCell label="Resting HR" value={fmt(latest.resting_hr)} />
      </div>
    </div>
  )
}
