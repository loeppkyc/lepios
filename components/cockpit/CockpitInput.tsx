'use client'

import type { InputHTMLAttributes } from 'react'

interface CockpitInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
}

export function CockpitInput({ label, error, hint, id, ...props }: CockpitInputProps) {
  const inputId = id ?? `ci-${label.toLowerCase().replace(/\s+/g, '-')}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label
        htmlFor={inputId}
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: error ? 'var(--color-critical)' : 'var(--color-text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {label}
        {hint && (
          <span
            title={hint}
            style={{
              cursor: 'help',
              color: 'var(--color-text-disabled)',
              fontWeight: 400,
              textTransform: 'none',
              letterSpacing: 0,
              fontSize: '0.8em',
              userSelect: 'none',
            }}
          >
            ⓘ
          </span>
        )}
      </label>
      <input
        id={inputId}
        {...props}
        style={{
          fontFamily:
            props.type === 'number' || props.inputMode === 'numeric'
              ? 'var(--font-mono)'
              : 'var(--font-ui)',
          fontSize: 'var(--text-body)',
          color: 'var(--color-text-primary)',
          backgroundColor: 'var(--color-surface-2)',
          border: `1px solid ${error ? 'var(--color-critical)' : 'var(--color-border-accent)'}`,
          borderRadius: 'var(--radius-md)',
          padding: '6px 10px',
          outline: 'none',
          width: '100%',
          transition: 'border-color var(--transition-fast)',
          fontVariantNumeric: 'tabular-nums',
          ...props.style,
        }}
      />
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
