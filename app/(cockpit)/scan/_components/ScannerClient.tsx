'use client'

import { useState } from 'react'
import { CockpitInput } from '@/components/cockpit/CockpitInput'

interface ScanResult {
  isbn: string
  asin: string
  title: string
  imageUrl: string
  bsr: number
  bsrCategory: string
  buyBoxPrice: number
  fbaFees: number
  costPaid: number
  profit: number
  roi: number
  decision: 'buy' | 'skip'
}

const cell = {
  background: 'var(--color-surface-2)',
  borderRadius: 'var(--radius-sm)',
  padding: '10px 12px',
} as const

const cellLabel = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-nano)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  color: 'var(--color-text-disabled)',
  marginBottom: 4,
}

const cellValue = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-body)',
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums' as const,
}

export function ScannerClient() {
  const [isbn, setIsbn] = useState('')
  const [costPaid, setCostPaid] = useState('0.25')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleScan(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)
    setLoading(true)

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbn: isbn.trim(), cost_paid: parseFloat(costPaid) }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'Scan failed')
      else setResult(data as ScanResult)
    } catch {
      setError('Network error — check connection')
    } finally {
      setLoading(false)
    }
  }

  const isBuy = result?.decision === 'buy'
  const profitColor = result
    ? result.profit >= 3
      ? 'var(--color-positive)'
      : 'var(--color-critical)'
    : 'var(--color-text-primary)'
  const roiColor = result
    ? result.roi >= 50
      ? 'var(--color-positive)'
      : 'var(--color-critical)'
    : 'var(--color-text-primary)'

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
          PageProfit Scanner
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            margin: '4px 0 0',
          }}
        >
          Amazon CA · Chunk A
        </p>
      </div>

      <form onSubmit={handleScan} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <CockpitInput
          label="ISBN"
          value={isbn}
          onChange={(e) => setIsbn(e.target.value)}
          placeholder="9780307888037"
          inputMode="numeric"
          required
          autoFocus
        />
        <CockpitInput
          label="Cost Paid (CAD)"
          type="number"
          value={costPaid}
          onChange={(e) => setCostPaid(e.target.value)}
          step="0.01"
          min="0.01"
          max="999.99"
          required
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-body)',
            fontWeight: 600,
            padding: '10px 24px',
            background: loading ? 'var(--color-surface-2)' : 'var(--color-accent-gold)',
            color: loading ? 'var(--color-text-disabled)' : 'var(--color-base)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'background var(--transition-fast)',
          }}
        >
          {loading ? 'Scanning…' : 'Scan'}
        </button>
      </form>

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

      {result && (
        <div
          style={{
            background: 'var(--color-surface)',
            border: `1px solid ${isBuy ? 'var(--color-positive)' : 'var(--color-border-accent)'}`,
            borderRadius: 'var(--radius-lg)',
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* Header row — cover + title + decision badge */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            {result.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={result.imageUrl}
                alt={result.title}
                width={52}
                height={72}
                style={{ objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-body)',
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                  lineHeight: 1.3,
                  marginBottom: 4,
                }}
              >
                {result.title || 'Unknown Title'}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {result.asin}
                {result.bsr > 0 && <span> · BSR {result.bsr.toLocaleString()}</span>}
              </div>
            </div>
            <span
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                fontWeight: 700,
                letterSpacing: '0.06em',
                padding: '4px 10px',
                borderRadius: 'var(--radius-sm)',
                background: isBuy ? 'var(--color-positive)' : 'var(--color-overlay)',
                color: isBuy ? 'var(--color-base)' : 'var(--color-text-muted)',
                flexShrink: 0,
              }}
            >
              {isBuy ? 'BUY' : 'SKIP'}
            </span>
          </div>

          {/* Price breakdown — 3 cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {(
              [
                {
                  label: 'Buy Box',
                  value: `$${result.buyBoxPrice.toFixed(2)}`,
                  color: 'var(--color-text-primary)',
                },
                {
                  label: 'FBA Fees',
                  value: `-$${result.fbaFees.toFixed(2)}`,
                  color: 'var(--color-critical)',
                },
                {
                  label: 'Cost',
                  value: `-$${result.costPaid.toFixed(2)}`,
                  color: 'var(--color-text-muted)',
                },
              ] as const
            ).map(({ label, value, color }) => (
              <div key={label} style={cell}>
                <div style={cellLabel}>{label}</div>
                <div style={{ ...cellValue, color }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Profit + ROI — 2 larger cells */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={cell}>
              <div style={cellLabel}>Profit</div>
              <div
                style={{ ...cellValue, fontSize: '1.25rem', fontWeight: 700, color: profitColor }}
              >
                ${result.profit.toFixed(2)}
              </div>
            </div>
            <div style={cell}>
              <div style={cellLabel}>ROI</div>
              <div style={{ ...cellValue, fontSize: '1.25rem', fontWeight: 700, color: roiColor }}>
                {result.roi.toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
