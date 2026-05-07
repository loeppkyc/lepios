'use client'

import { useEffect, useState } from 'react'
import { useDevMode } from '@/lib/hooks/useDevMode'
import { DebugSection } from '@/components/cockpit/DebugSection'

// Inline types — do NOT import from route files. Route handlers import lib/amazon/client
// which uses Node.js `crypto`. Turbopack traverses the import type graph and leaks
// server-only modules into the client bundle, silently breaking the component.
interface LastPayout {
  amountCad: number
  transferDate: string
  status: 'Processing' | 'Succeeded'
}

interface SettlementResponse {
  grossPendingCad: number
  deferredCad: number
  totalBalanceCad: number
  lastPayout: LastPayout | null
  ddbrCad: number | null
  ddbrAvailable: boolean
  fetchedAt: string
}

interface FbaInventoryResponse {
  fulfillableUnits: number
  fetchedAt: string
}

// ── Primitive: single stat cell ───────────────────────────────────────────────

function StatCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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
      {sub && (
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
          }}
        >
          {sub}
        </span>
      )}
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function PanelSkeleton() {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      <span className="label-caps" style={{ color: 'var(--color-pillar-money)' }}>
        What You&apos;re Owed
      </span>
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-disabled)',
        }}
      >
        Loading…
      </div>
    </div>
  )
}

// ── "Minutes ago" helper ──────────────────────────────────────────────────────

function minutesAgo(isoTimestamp: string): string {
  const fetchedAt = new Date(isoTimestamp).getTime()
  const now = Date.now()
  const diffMs = now - fetchedAt
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins === 1) return '1 min ago'
  return `${mins} min ago`
}

// ── Date formatting for last payout ───────────────────────────────────────────

function shortDate(isoTimestamp: string): string {
  const d = new Date(isoTimestamp)
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

// ── Main exported component ───────────────────────────────────────────────────

// Auto-refresh interval — settlement reflects same-day withdrawals as soon as
// SP-API publishes them. FBA inventory route is server-cached for 30 min;
// polling at 15 min cadence is harmless (cache hit until ttl expires).
const REFRESH_INTERVAL_MS = 15 * 60 * 1000

export function WhatYouOwePanel() {
  const [settlement, setSettlement] = useState<SettlementResponse | null>(null)
  const [settlementError, setSettlementError] = useState<string | null>(null)

  const [fbaInventory, setFbaInventory] = useState<FbaInventoryResponse | null>(null)
  const [fbaError, setFbaError] = useState<string | null>(null)

  const [settlementLoading, setSettlementLoading] = useState(true)
  const [fbaLoading, setFbaLoading] = useState(true)
  const [devMode] = useDevMode()

  // Fetch both routes independently — Constraint B-9: settlement renders immediately
  // without waiting for the 30-min-cached FBA route
  useEffect(() => {
    let cancelled = false

    const load = () => {
      fetch('/api/business-review/settlement', { cache: 'no-store' })
        .then(async (res) => {
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string }
            throw new Error(body.error ?? `HTTP ${res.status}`)
          }
          return res.json() as Promise<SettlementResponse>
        })
        .then((payload) => {
          if (cancelled) return
          setSettlement(payload)
          setSettlementError(null)
          setSettlementLoading(false)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setSettlementError(err instanceof Error ? err.message : String(err))
          setSettlementLoading(false)
        })
    }

    load()
    const interval = setInterval(load, REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const load = () => {
      fetch('/api/business-review/fba-inventory', { cache: 'no-store' })
        .then(async (res) => {
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string }
            throw new Error(body.error ?? `HTTP ${res.status}`)
          }
          return res.json() as Promise<FbaInventoryResponse>
        })
        .then((payload) => {
          if (cancelled) return
          setFbaInventory(payload)
          setFbaError(null)
          setFbaLoading(false)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setFbaError(err instanceof Error ? err.message : String(err))
          setFbaLoading(false)
        })
    }

    load()
    const interval = setInterval(load, REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  if (settlementLoading && fbaLoading) {
    return <PanelSkeleton />
  }

  const fmt = (n: number) => `$${n.toFixed(2)}`

  const totalBalanceValue = settlementLoading
    ? 'Loading…'
    : settlementError
      ? '—'
      : settlement
        ? fmt(settlement.totalBalanceCad)
        : '—'

  // "Funds Available Now" — Amazon UI label for Standard open balance
  const fundsAvailableValue = settlementLoading
    ? 'Loading…'
    : settlementError
      ? '—'
      : settlement
        ? fmt(settlement.grossPendingCad)
        : '—'

  const deferredValue = settlementLoading
    ? 'Loading…'
    : settlementError
      ? '—'
      : settlement
        ? fmt(settlement.deferredCad)
        : '—'

  // Sub-label flags FEG-fallback when DDBR API isn't returning data
  const deferredSubLabel =
    settlement && !settlement.ddbrAvailable && settlement.deferredCad === 0
      ? 'Awaiting v2024-06-19 access'
      : undefined

  // Last payout — mirrors Amazon "Recent Payouts" line
  const lastPayoutValue = settlementLoading
    ? 'Loading…'
    : settlementError
      ? '—'
      : settlement?.lastPayout
        ? fmt(settlement.lastPayout.amountCad)
        : '—'

  const lastPayoutSubLabel = settlement?.lastPayout
    ? `${shortDate(settlement.lastPayout.transferDate)} · ${settlement.lastPayout.status}`
    : undefined

  // FBA units — fulfillable only (Constraint B-7)
  const fbaValue = fbaLoading
    ? 'Loading…'
    : fbaError
      ? '—'
      : fbaInventory
        ? fbaInventory.fulfillableUnits.toString()
        : '—'

  // Constraint B-8: sub-label shows cache age from fetchedAt
  const fbaSubLabel = fbaInventory
    ? `Last updated: ${minutesAgo(fbaInventory.fetchedAt)}`
    : fbaError
      ? fbaError
      : undefined

  const settlementSubLabel = settlementError ? settlementError : undefined

  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      {/* Panel heading */}
      <span className="label-caps" style={{ color: 'var(--color-pillar-money)' }}>
        What You&apos;re Owed
      </span>

      {/* 6-stat grid: 2 rows × 3 columns — mirrors Amazon Payments page layout */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '16px 24px',
        }}
      >
        {/* Row 1 — balance breakdown matches Amazon "All Accounts" view */}
        <StatCell label="Total Balance" value={totalBalanceValue} sub={settlementSubLabel} />
        <StatCell label="Funds Available Now" value={fundsAvailableValue} />
        <StatCell label="Deferred" value={deferredValue} sub={deferredSubLabel} />

        {/* Row 2 — secondary signals */}
        <StatCell label="Last Payout" value={lastPayoutValue} sub={lastPayoutSubLabel} />
        <StatCell label="FBA Units" value={fbaValue} sub={fbaSubLabel} />
        <StatCell label="Avg Cost / Unit" value="—" sub="Coming in Sprint 5" />
      </div>

      {devMode && (
        <DebugSection heading="Debug — What You're Owed">
          <pre
            style={{
              color: 'var(--color-text-primary)',
              fontSize: 'var(--text-nano)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {JSON.stringify({ settlement, fbaInventory }, null, 2)}
          </pre>
        </DebugSection>
      )}
    </div>
  )
}
