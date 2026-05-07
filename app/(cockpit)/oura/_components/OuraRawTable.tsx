'use client'

import type { OuraDailyRow } from '@/lib/oura/sync'

function formatNum(v: number | null, digits = 0): string {
  if (v == null) return '—'
  return digits === 0 ? Math.round(v).toString() : v.toFixed(digits)
}

const headerCell: React.CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-nano)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-text-disabled)',
  textAlign: 'right',
  padding: '8px 12px',
  borderBottom: '1px solid var(--color-border)',
  whiteSpace: 'nowrap',
}

const headerCellLeft: React.CSSProperties = { ...headerCell, textAlign: 'left' }

const cell: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-small)',
  color: 'var(--color-text-primary)',
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
  padding: '8px 12px',
  borderBottom: '1px solid var(--color-border)',
  whiteSpace: 'nowrap',
}

const cellLeft: React.CSSProperties = { ...cell, textAlign: 'left' }

export function OuraRawTable({ rows }: { rows: OuraDailyRow[] }) {
  // Already sorted desc by date from the page query, but defensive sort.
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        padding: '20px 24px',
        overflowX: 'auto',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={headerCellLeft}>Date</th>
            <th style={headerCell}>Sleep</th>
            <th style={headerCell}>Readiness</th>
            <th style={headerCell}>Activity</th>
            <th style={headerCell}>HRV</th>
            <th style={headerCell}>RHR</th>
            <th style={headerCell}>Total (hrs)</th>
            <th style={headerCell}>Deep (min)</th>
            <th style={headerCell}>REM (min)</th>
            <th style={headerCell}>Light (min)</th>
            <th style={headerCell}>Steps</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.date}>
              <td style={cellLeft}>{r.date}</td>
              <td style={cell}>{formatNum(r.sleep_score)}</td>
              <td style={cell}>{formatNum(r.readiness_score)}</td>
              <td style={cell}>{formatNum(r.activity_score)}</td>
              <td style={cell}>{formatNum(r.hrv)}</td>
              <td style={cell}>{formatNum(r.resting_hr)}</td>
              <td style={cell}>{formatNum(r.total_sleep_hours, 1)}</td>
              <td style={cell}>{formatNum(r.deep_sleep_min)}</td>
              <td style={cell}>{formatNum(r.rem_sleep_min)}</td>
              <td style={cell}>{formatNum(r.light_sleep_min)}</td>
              <td style={cell}>{formatNum(r.steps)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
