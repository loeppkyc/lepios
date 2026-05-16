'use client'

import { type CSSProperties, type ReactNode, useState } from 'react'

// ── Shared style tokens ───────────────────────────────────────────────────────

export const PILLAR_COLOR = 'var(--color-pillar-health)'

export const cardStyle: CSSProperties = {
  backgroundColor: 'var(--color-surface)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  padding: '20px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
}

export const labelStyle: CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-nano)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-text-disabled)',
}

export const inputStyle: CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-small)',
  padding: '8px 12px',
  background: 'var(--color-base)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  width: '100%',
}

export const tableHeaderCell: CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-nano)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-text-disabled)',
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '1px solid var(--color-border)',
  whiteSpace: 'nowrap',
}

export const tableCell: CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-small)',
  color: 'var(--color-text-primary)',
  padding: '8px 12px',
  borderBottom: '1px solid var(--color-border)',
  verticalAlign: 'top',
}

export const buttonPrimary: CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-nano)',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  padding: '8px 16px',
  background: PILLAR_COLOR,
  color: 'var(--color-base)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
}

export const buttonGhost: CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-nano)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  padding: '6px 12px',
  background: 'none',
  color: 'var(--color-text-muted)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
}

export const sectionTitle: CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-small)',
  fontWeight: 700,
  letterSpacing: '0.04em',
  color: PILLAR_COLOR,
}

export const captionStyle: CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-nano)',
  color: 'var(--color-text-disabled)',
}

// ── Disclosure ────────────────────────────────────────────────────────────────

export function Disclosure({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 16px',
          background: 'none',
          color: 'var(--color-text-primary)',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          fontWeight: 600,
          letterSpacing: '0.04em',
        }}
      >
        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-disabled)' }}>
          {open ? '▾' : '▸'}
        </span>
        {title}
      </button>
      {open && <div style={{ padding: '0 16px 16px' }}>{children}</div>}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

export function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        padding: '24px',
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-small)',
        color: 'var(--color-text-disabled)',
      }}
    >
      {message}
    </div>
  )
}

// ── Status line ───────────────────────────────────────────────────────────────

export function StatusLine({
  status,
}: {
  status: { tone: 'ok' | 'error'; message: string } | null
}) {
  if (!status) return null
  return (
    <span
      style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-nano)',
        color: status.tone === 'error' ? 'var(--color-critical)' : PILLAR_COLOR,
        marginLeft: 8,
      }}
    >
      {status.message}
    </span>
  )
}

// ── Metric row ────────────────────────────────────────────────────────────────

export function MetricRow({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
      }}
    >
      <span style={captionStyle}>{label}</span>
      <span
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          fontWeight: 700,
          color: 'var(--color-text-primary)',
        }}
      >
        {value}
      </span>
    </div>
  )
}
