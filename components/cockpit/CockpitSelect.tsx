'use client'

import type { SelectHTMLAttributes } from 'react'

interface CockpitSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  error?: string
  options: Array<{ value: string; label: string }>
}

export function CockpitSelect({ label, error, id, options, ...props }: CockpitSelectProps) {
  const selectId = id ?? `cs-${label.toLowerCase().replace(/\s+/g, '-')}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label
        htmlFor={selectId}
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: error ? 'var(--color-critical)' : 'var(--color-text-muted)',
        }}
      >
        {label}
      </label>
      <select
        id={selectId}
        {...props}
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-body)',
          color: 'var(--color-text-primary)',
          backgroundColor: 'var(--color-surface-2)',
          border: `1px solid ${error ? 'var(--color-critical)' : 'var(--color-border-accent)'}`,
          borderRadius: 'var(--radius-md)',
          padding: '6px 10px',
          outline: 'none',
          width: '100%',
          transition: 'border-color var(--transition-fast)',
          appearance: 'none',
          cursor: 'pointer',
          ...props.style,
        }}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && (
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-critical)',
          }}
        >
          {error}
        </span>
      )}
    </div>
  )
}
