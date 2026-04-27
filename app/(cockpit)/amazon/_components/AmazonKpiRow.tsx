'use client'

import type { KpiRowData } from '@/lib/amazon/reports'

// ── Delta badge ───────────────────────────────────────────────────────────────

function DeltaBadge({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          color: 'var(--color-text-disabled)',
        }}
      >
        —
      </span>
    )
  }
  if (value > 0) {
    return (
      <span
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          color: 'var(--color-positive)',
        }}
      >
        ▲ +{value}
      </span>
    )
  }
  if (value < 0) {
    return (
      <span
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          color: 'var(--color-critical)',
        }}
      >
        ▼ {value}
      </span>
    )
  }
  return (
    <span
      style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-nano)',
        color: 'var(--color-text-disabled)',
      }}
    >
      — 0
    </span>
  )
}

function DeltaBadgeCurrency({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          color: 'var(--color-text-disabled)',
        }}
      >
        —
      </span>
    )
  }
  if (value > 0) {
    return (
      <span
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          color: 'var(--color-positive)',
        }}
      >
        ▲ +${value.toFixed(2)}
      </span>
    )
  }
  if (value < 0) {
    return (
      <span
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          color: 'var(--color-critical)',
        }}
      >
        ▼ -${Math.abs(value).toFixed(2)}
      </span>
    )
  }
  return (
    <span
      style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-nano)',
        color: 'var(--color-text-disabled)',
      }}
    >
      — $0.00
    </span>
  )
}

// ── Single KPI cell ───────────────────────────────────────────────────────────

function KpiCell({
  label,
  value,
  delta,
  isCurrency = false,
}: {
  label: string
  value: string
  delta: number | null
  isCurrency?: boolean
}) {
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
      <div>
        {isCurrency ? <DeltaBadgeCurrency value={delta} /> : <DeltaBadge value={delta} />}
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
            marginLeft: 4,
          }}
        >
          vs prior 30d
        </span>
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function AmazonKpiRow({ data }: { data: KpiRowData }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 16,
      }}
    >
      <KpiCell
        label="Orders (30d)"
        value={data.totalOrders.toString()}
        delta={data.deltas.totalOrders}
      />
      <KpiCell
        label="Gross Revenue (CAD)"
        value={`$${data.grossRevenue.toFixed(2)}`}
        delta={data.deltas.grossRevenue}
        isCurrency
      />
      <KpiCell
        label="Units Shipped"
        value={data.unitsShipped.toString()}
        delta={data.deltas.unitsShipped}
      />
      <KpiCell
        label="Net Payout (35d)"
        value={data.netPayout > 0 ? `$${data.netPayout.toFixed(2)}` : '—'}
        delta={data.deltas.netPayout}
        isCurrency
      />
    </div>
  )
}
