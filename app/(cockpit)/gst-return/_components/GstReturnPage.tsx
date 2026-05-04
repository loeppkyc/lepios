'use client'

import { useState, useEffect } from 'react'

interface GstReturnData {
  period: { year: number; quarter: number | null; start: string; end: string }
  revenue: number
  gstOnRevenue: number
  line106Itcs: number
  line109NetTax: number
  settlementCount: number
  expenseCount: number
  gstEligibleCount: number
  zeroRatedCount: number
  gstEligiblePretax: number
  zeroRatedPretax: number
}

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 4 }, (_, i) => CURRENT_YEAR - i)

const fmt = (n: number) =>
  n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 })

function LineRow({
  num,
  label,
  value,
  highlight,
  note,
}: {
  num: string
  label: string
  value: number
  highlight?: 'refund' | 'remit' | 'gold'
  note?: string
}) {
  const color =
    highlight === 'refund'
      ? 'var(--color-pillar-health)'
      : highlight === 'remit'
        ? '#e5534b'
        : highlight === 'gold'
          ? 'var(--color-accent-gold)'
          : 'var(--color-text-primary)'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
        padding: '10px 16px',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.7rem',
          color: 'var(--color-accent-gold)',
          width: 64,
          flexShrink: 0,
        }}
      >
        {num}
      </span>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-primary)',
          }}
        >
          {label}
        </div>
        {note && (
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: '0.7rem',
              color: 'var(--color-text-disabled)',
              marginTop: 2,
            }}
          >
            {note}
          </div>
        )}
      </div>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.95rem',
          fontWeight: 700,
          color,
          minWidth: 120,
          textAlign: 'right',
        }}
      >
        {fmt(value)}
      </span>
    </div>
  )
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        padding: '8px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.95rem',
          fontWeight: 700,
          color: 'var(--color-text-primary)',
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: '0.68rem',
          color: 'var(--color-text-disabled)',
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
        }}
      >
        {label}
      </span>
    </div>
  )
}

export function GstReturnPage() {
  const [year, setYear] = useState(CURRENT_YEAR)
  const [quarter, setQuarter] = useState<string>('') // '' = annual
  const [data, setData] = useState<GstReturnData | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setErr(null)
      try {
        const qs = quarter ? `&quarter=${quarter}` : ''
        const r = await fetch(`/api/tax/gst-return?year=${year}${qs}`)
        const j = (await r.json()) as GstReturnData & { error?: string }
        if (!r.ok) throw new Error(j.error ?? 'Failed to load')
        if (!cancelled) setData(j)
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [year, quarter])

  const periodLabel = quarter ? `Q${quarter} ${year}` : `${year} Annual`

  const isRefund = data && data.line109NetTax < 0

  return (
    <div
      style={{
        padding: '24px 32px',
        maxWidth: 760,
        fontFamily: 'var(--font-ui)',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontFamily: 'var(--font-display, var(--font-ui))',
            fontSize: '1.15rem',
            fontWeight: 800,
            letterSpacing: '0.06em',
            color: 'var(--color-text-primary)',
            textTransform: 'uppercase',
            margin: 0,
          }}
        >
          GST Return
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            margin: '6px 0 0',
          }}
        >
          CRA filing numbers — Lines 101, 106, 109
        </p>
      </div>

      {/* Period selector */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          marginBottom: 28,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-small)',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-primary)',
            padding: '7px 12px',
            cursor: 'pointer',
          }}
        >
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <select
          value={quarter}
          onChange={(e) => setQuarter(e.target.value)}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-primary)',
            padding: '7px 12px',
            cursor: 'pointer',
          }}
        >
          <option value="">Annual</option>
          <option value="1">Q1 — Jan–Mar</option>
          <option value="2">Q2 — Apr–Jun</option>
          <option value="3">Q3 — Jul–Sep</option>
          <option value="4">Q4 — Oct–Dec</option>
        </select>

        {loading && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              color: 'var(--color-text-disabled)',
            }}
          >
            Loading…
          </span>
        )}
      </div>

      {err && (
        <div
          style={{
            background: '#2a1a1a',
            border: '1px solid #e5534b',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 14px',
            color: '#e5534b',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8rem',
            marginBottom: 20,
          }}
        >
          {err}
        </div>
      )}

      {data && !loading && (
        <>
          {/* Period + verdict banner */}
          <div
            style={{
              background: isRefund ? 'rgba(63, 185, 80, 0.08)' : 'rgba(229, 83, 75, 0.08)',
              border: `1px solid ${isRefund ? 'rgba(63, 185, 80, 0.3)' : 'rgba(229, 83, 75, 0.3)'}`,
              borderRadius: 'var(--radius-sm)',
              padding: '14px 20px',
              marginBottom: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: 'var(--font-display, var(--font-ui))',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  letterSpacing: '0.08em',
                  color: 'var(--color-text-primary)',
                  textTransform: 'uppercase',
                }}
              >
                {periodLabel}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: '0.72rem',
                  color: 'var(--color-text-muted)',
                  marginTop: 2,
                }}
              >
                {data.period.start} → {data.period.end}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: isRefund ? 'var(--color-pillar-health)' : '#e5534b',
                }}
              >
                {fmt(Math.abs(data.line109NetTax))}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: '0.7rem',
                  color: isRefund ? 'var(--color-pillar-health)' : '#e5534b',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                }}
              >
                {isRefund ? 'Refund Due' : 'Remit to CRA'}
              </div>
            </div>
          </div>

          {/* CRA return lines */}
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
              marginBottom: 24,
            }}
          >
            <div
              style={{
                padding: '10px 16px',
                background: 'var(--color-surface-2)',
                borderBottom: '1px solid var(--color-border)',
                fontFamily: 'var(--font-ui)',
                fontSize: '0.65rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                color: 'var(--color-text-disabled)',
                textTransform: 'uppercase',
              }}
            >
              GST/HST Return Lines
            </div>

            <LineRow
              num="Line 101"
              label="Total revenue (Amazon net payouts)"
              value={data.revenue}
              note={`${data.settlementCount} settlement${data.settlementCount !== 1 ? 's' : ''} — gross column deferred; using net_payout as proxy`}
            />
            <LineRow
              num="GST est."
              label="Estimated GST collected on revenue (5%)"
              value={data.gstOnRevenue}
              highlight="gold"
              note="Amazon typically collects & remits GST as marketplace facilitator — confirm with accountant"
            />
            <LineRow
              num="Line 106"
              label="Input Tax Credits (ITCs) — GST paid on business expenses"
              value={data.line106Itcs}
              highlight="gold"
              note={`${data.gstEligibleCount} GST-eligible expenses · ${data.zeroRatedCount} zero-rated excluded`}
            />
            <LineRow
              num="Line 109"
              label={
                isRefund ? 'Net tax — Refund due from CRA' : 'Net tax — Amount to remit to CRA'
              }
              value={data.line109NetTax}
              highlight={isRefund ? 'refund' : 'remit'}
            />
          </div>

          {/* Expense breakdown stats */}
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
              marginBottom: 24,
            }}
          >
            <div
              style={{
                padding: '10px 16px',
                background: 'var(--color-surface-2)',
                borderBottom: '1px solid var(--color-border)',
                fontFamily: 'var(--font-ui)',
                fontSize: '0.65rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                color: 'var(--color-text-disabled)',
                textTransform: 'uppercase',
              }}
            >
              Expense Breakdown
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <StatPill label="Total expenses" value={String(data.expenseCount)} />
              <StatPill label="GST-eligible pretax" value={fmt(data.gstEligiblePretax)} />
              <StatPill label="GST ITCs claimed" value={fmt(data.line106Itcs)} />
              <StatPill label="Zero-rated pretax" value={fmt(data.zeroRatedPretax)} />
            </div>
          </div>

          {/* Zero-rated categories note */}
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: '0.7rem',
              color: 'var(--color-text-disabled)',
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: 'var(--color-text-muted)' }}>Zero-rated categories</strong>{' '}
            (excluded from ITCs): Inventory — Books, Bank Charges, Insurance, Amazon Advertising,
            Loan Repayments. These are GST-exempt or not ITC-eligible.
          </div>
        </>
      )}
    </div>
  )
}
