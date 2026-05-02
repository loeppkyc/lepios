'use client'

import { useState } from 'react'

export function DebugSection({
  heading,
  children,
}: {
  heading: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div
      style={{
        marginTop: 8,
        backgroundColor: 'var(--color-surface-2)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--color-border)',
        fontSize: 'var(--text-nano)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-nano)',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '0.6rem' }}>{open ? '▾' : '▸'}</span>
        {'🔍 ' + heading}
      </button>
      {open && (
        <div style={{ padding: '0 10px 10px' }}>
          {children}
        </div>
      )}
    </div>
  )
}
