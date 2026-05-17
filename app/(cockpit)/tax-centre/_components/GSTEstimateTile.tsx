'use client'

import { useState, useEffect } from 'react'

// Inline types per F11 — avoids server-only module leak
interface GstEstimateResponse {
  quarter: string
  gst_collected: number
  itc_credits: number
  net_owing: number
  set_aside_recommendation: number
  expense_count: number
  note: string
}

const QUARTERS = [
  { label: 'Q1 (Jan–Mar)', value: 'Q1' },
  { label: 'Q2 (Apr–Jun)', value: 'Q2' },
  { label: 'Q3 (Jul–Sep)', value: 'Q3' },
  { label: 'Q4 (Oct–Dec)', value: 'Q4' },
]

function getCurrentQuarter(): string {
  const month = new Date().getMonth() + 1
  if (month <= 3) return 'Q1'
  if (month <= 6) return 'Q2'
  if (month <= 9) return 'Q3'
  return 'Q4'
}

function fmt(n: number): string {
  return `$${Math.abs(n)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

export function GSTEstimateTile() {
  const [selectedQ, setSelectedQ] = useState(getCurrentQuarter)
  const [data, setData] = useState<GstEstimateResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const year = new Date().getFullYear()

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setFetchError(null)
      try {
        const res = await fetch(`/api/tax-centre/gst-estimate?quarter=${year}-${selectedQ}`)
        if (!res.ok) {
          const j = (await res.json()) as { error?: string }
          throw new Error(j.error ?? `HTTP ${res.status}`)
        }
        const json = (await res.json()) as GstEstimateResponse
        if (!cancelled) setData(json)
      } catch (e: unknown) {
        if (!cancelled) setFetchError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [selectedQ, year])

  const netOwing = data?.net_owing ?? 0
  const isCreditPosition = netOwing <= 0
  const positionColor = isCreditPosition
    ? 'var(--color-pillar-health)'
    : netOwing < 2000
      ? 'var(--color-accent-gold)'
      : '#e5534b'

  return (
    <section style={{ marginBottom: 28 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--color-text-muted)',
          }}
        >
          GST Estimate — Quarterly ITC Balance
        </div>
        {/* Quarter selector */}
        <div style={{ display: 'flex', gap: 4 }}>
          {QUARTERS.map((q) => (
            <button
              key={q.value}
              onClick={() => setSelectedQ(q.value)}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                padding: '3px 8px',
                background:
                  q.value === selectedQ ? 'var(--color-accent-gold)' : 'var(--color-surface-2)',
                color: q.value === selectedQ ? '#000' : 'var(--color-text-muted)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontWeight: q.value === selectedQ ? 700 : 400,
              }}
            >
              {q.value}
            </button>
          ))}
        </div>
      </div>

      {fetchError && (
        <div
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid #e5534b',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 16px',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-small)',
            color: '#e5534b',
          }}
        >
          {fetchError}
        </div>
      )}

      {loading && (
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
          }}
        >
          Loading…
        </p>
      )}

      {!loading && data && (
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            overflow: 'hidden',
          }}
        >
          {/* Quarter label */}
          <div
            style={{
              padding: '8px 18px',
              background: 'var(--color-surface-2)',
              borderBottom: '1px solid var(--color-border)',
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
            }}
          >
            {data.quarter} · {data.expense_count} expense{data.expense_count !== 1 ? 's' : ''} with
            GST
          </div>

          {/* Main stats grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr 1fr',
              gap: 20,
              padding: '16px 20px',
            }}
          >
            {/* GST collected */}
            <div>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  color: 'var(--color-text-disabled)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: 4,
                }}
              >
                GST Collected
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.1rem',
                  fontWeight: 700,
                  color: 'var(--color-text-muted)',
                }}
              >
                {fmt(data.gst_collected)}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  color: 'var(--color-text-disabled)',
                }}
              >
                Amazon remits on your behalf
              </div>
            </div>

            {/* ITCs */}
            <div>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  color: 'var(--color-text-disabled)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: 4,
                }}
              >
                ITCs (Credits)
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.1rem',
                  fontWeight: 700,
                  color: 'var(--color-pillar-health)',
                }}
              >
                {fmt(data.itc_credits)}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  color: 'var(--color-text-disabled)',
                }}
              >
                GST paid on business expenses
              </div>
            </div>

            {/* Net position */}
            <div>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  color: 'var(--color-text-disabled)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: 4,
                }}
              >
                Net Position
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.3rem',
                  fontWeight: 900,
                  color: positionColor,
                }}
              >
                {isCreditPosition ? fmt(Math.abs(netOwing)) + ' CR' : fmt(netOwing)}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  color: positionColor,
                  fontWeight: 600,
                }}
              >
                {isCreditPosition ? 'Credit — CRA owes you' : 'Owing to CRA'}
              </div>
            </div>

            {/* Set aside */}
            <div>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  color: 'var(--color-text-disabled)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: 4,
                }}
              >
                Set Aside
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.1rem',
                  fontWeight: 700,
                  color:
                    data.set_aside_recommendation > 0 ? '#e5534b' : 'var(--color-pillar-health)',
                }}
              >
                {data.set_aside_recommendation > 0 ? fmt(data.set_aside_recommendation) : '$0'}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  color: 'var(--color-text-disabled)',
                }}
              >
                {data.set_aside_recommendation > 0
                  ? 'Reserve in GST account'
                  : 'In credit — no reserve needed'}
              </div>
            </div>
          </div>

          {/* Note */}
          <div
            style={{
              padding: '8px 18px',
              background: 'var(--color-surface-2)',
              borderTop: '1px solid var(--color-border)',
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
            }}
          >
            {data.note}
          </div>
        </div>
      )}
    </section>
  )
}
