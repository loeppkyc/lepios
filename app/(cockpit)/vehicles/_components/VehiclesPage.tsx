'use client'

import { useEffect, useState } from 'react'
import type { VehiclesResponse, VehicleSummary } from '@/app/api/vehicles/route'

const fmt = (n: number) =>
  n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

const fmtKm = (n: number) => Math.round(n).toLocaleString('en-CA') + ' km'

export function VehiclesPage() {
  const [data, setData] = useState<VehiclesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    fetch('/api/vehicles')
      .then((r) => r.json())
      .then((d: VehiclesResponse & { error?: string }) => {
        if (cancelled) return
        if (d.error) setError(d.error)
        else setData(d)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(String(e))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div
      style={{
        padding: '28px 32px',
        maxWidth: 1080,
        margin: '0 auto',
        fontFamily: 'var(--font-ui)',
      }}
    >
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
        Vehicles
      </h1>
      <p
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-muted)',
          margin: '6px 0 24px',
        }}
      >
        Tesla (business) + Toyota Corolla (personal). Insurance, charging, repairs, parking,
        mileage.
      </p>

      {loading && (
        <div style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)' }}>
          Loading…
        </div>
      )}
      {error && <div style={{ color: '#e5534b', fontSize: 'var(--text-small)' }}>{error}</div>}

      {data && !loading && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
            <Kpi label="Combined YTD Cost" value={fmt(data.combinedYtdCost)} />
            <Kpi label="YTD Mileage Logged" value={fmtKm(data.ytdMileageKm)} />
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {data.vehicles.map((v) => (
              <VehicleCard key={v.name} v={v} />
            ))}
          </div>

          <p
            style={{
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
              marginTop: 18,
              lineHeight: 1.6,
            }}
          >
            Tesla insurance assumed Pembridge $334.96/mo combined Tesla+Corolla policy with 60%
            Tesla / 40% Corolla split (per Colin 2026-05-06). Corolla figures show only insurance
            share — gas, parking ($150/mo personal spot), and other Corolla costs are tracked in
            personal expenses, not business books.
          </p>
        </>
      )}
    </div>
  )
}

function VehicleCard({ v }: { v: VehicleSummary }) {
  const isBusiness = v.name === 'Tesla Model Y'
  return (
    <div
      style={{
        flex: '1 1 420px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '18px 22px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display, var(--font-ui))',
            fontSize: '1rem',
            fontWeight: 800,
            color: 'var(--color-text-primary)',
          }}
        >
          {v.name}
        </div>
        <span
          style={{
            fontSize: '0.62rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: isBusiness ? 'var(--color-pillar-money)' : 'var(--color-text-disabled)',
          }}
        >
          {isBusiness ? 'Business' : 'Personal'}
        </span>
      </div>

      <Row label="Book Value" value={v.bookValue != null ? fmt(v.bookValue) : '—'} />
      <Row
        label="Loan Remaining"
        value={v.loanRemaining > 0 ? fmt(v.loanRemaining) : 'Paid off'}
        valueColor={v.loanRemaining > 0 ? '#e5534b' : 'var(--color-pillar-health)'}
      />
      <div
        style={{
          height: 1,
          background: 'var(--color-border)',
          margin: '10px 0',
        }}
      />
      <Row label="Insurance YTD" value={v.ytdInsurance > 0 ? fmt(v.ytdInsurance) : '—'} />
      <Row label="Charging YTD" value={v.ytdCharging > 0 ? fmt(v.ytdCharging) : '—'} />
      <Row
        label="Maintenance/Repairs YTD"
        value={v.ytdMaintenance > 0 ? fmt(v.ytdMaintenance) : '—'}
      />
      <Row label="Parking YTD" value={v.ytdParking > 0 ? fmt(v.ytdParking) : '—'} />
      <div
        style={{
          height: 1,
          background: 'var(--color-border)',
          margin: '10px 0',
        }}
      />
      <Row label="Total YTD" value={fmt(v.ytdTotal)} valueColor="var(--color-accent-gold)" bold />
      <Row
        label="Monthly Avg"
        value={v.monthlyAvg > 0 ? fmt(v.monthlyAvg) : '—'}
        valueColor="var(--color-text-muted)"
      />
    </div>
  )
}

function Row({
  label,
  value,
  valueColor,
  bold,
}: {
  label: string
  value: string
  valueColor?: string
  bold?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '5px 0',
        fontSize: 'var(--text-small)',
      }}
    >
      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          color: valueColor ?? 'var(--color-text-primary)',
          fontWeight: bold ? 700 : 400,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        padding: '14px 18px',
        minWidth: 180,
        flex: 1,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.3rem',
          fontWeight: 700,
          color: 'var(--color-accent-gold)',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: '0.65rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--color-text-disabled)',
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  )
}
