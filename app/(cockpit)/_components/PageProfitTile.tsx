'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface PageProfitStats {
  scans24h: number
  activePallets: number
  pendingRouting: number
  profitPotentialCad: number
}

export function PageProfitTile() {
  const [stats, setStats] = useState<PageProfitStats | null>(null)

  useEffect(() => {
    fetch('/api/cockpit/pageprofit-stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStats(d as PageProfitStats | null))
      .catch(() => {})
  }, [])

  if (!stats || (stats.scans24h === 0 && stats.activePallets === 0)) return null

  return (
    <div
      style={{
        padding: '4px 14px 6px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: '0.58rem',
          color: 'var(--color-text-disabled)',
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
        }}
      >
        PageProfit · 24h
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Link
          href="/scan"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.6rem',
            color:
              stats.scans24h > 0
                ? 'var(--color-status-success, #22c55e)'
                : 'var(--color-text-disabled)',
            textDecoration: 'none',
          }}
        >
          {stats.scans24h} scan{stats.scans24h !== 1 ? 's' : ''}
        </Link>
        {stats.activePallets > 0 && (
          <Link
            href="/pallets"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.6rem',
              color: 'var(--color-accent-gold)',
              textDecoration: 'none',
            }}
          >
            {stats.activePallets} pallet{stats.activePallets !== 1 ? 's' : ''}
          </Link>
        )}
        {stats.pendingRouting > 0 && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.6rem',
              color: 'var(--color-text-muted)',
            }}
          >
            {stats.pendingRouting} pending
          </span>
        )}
      </div>
    </div>
  )
}
