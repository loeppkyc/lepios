'use client'

import { useEffect, useState } from 'react'

// Inline types — do NOT import from route files. Route handlers may import
// server-only modules that Turbopack would leak into the client bundle.
interface StatementCoverageBand {
  label: string
  months: string[] // "YYYY-MM" strings
}

interface StatementCoverageAccount {
  key: string
  label: string
  coverage: Record<string, boolean> // "YYYY-MM" → present
}

interface StatementCoverageResponse {
  bands: StatementCoverageBand[]
  accounts: StatementCoverageAccount[]
  fetchedAt: string
}

// ── Month label formatter ─────────────────────────────────────────────────────

/** Converts "2025-04" → "Apr" for column headers */
function shortMonthLabel(yyyyMM: string): string {
  const [year, month] = yyyyMM.split('-')
  const date = new Date(Number(year), Number(month) - 1, 1)
  return date.toLocaleString('en-CA', { month: 'short' })
}

// ── Cell ──────────────────────────────────────────────────────────────────────

function CoverageCell({ present }: { present: boolean }) {
  return (
    <td
      style={{
        width: 28,
        height: 28,
        padding: 0,
        border: '1px solid var(--color-border)',
        backgroundColor: present ? 'var(--color-positive)' : 'var(--color-critical)',
        opacity: present ? 1 : 0.7,
      }}
      title={present ? 'Statement present' : 'No statement found'}
    />
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function GridSkeleton() {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <span className="label-caps" style={{ color: 'var(--color-pillar-money)' }}>
        Statement Coverage · Bank & Credit
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

// ── Error state ───────────────────────────────────────────────────────────────

function GridError({ message }: { message: string }) {
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
      <span className="label-caps" style={{ color: 'var(--color-pillar-money)' }}>
        Statement Coverage · Bank & Credit
      </span>
      <span
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-critical)',
        }}
      >
        Failed to load: {message}
      </span>
    </div>
  )
}

// ── Band header row ───────────────────────────────────────────────────────────

function BandHeaderRow({
  bands,
  accountLabelWidth,
  cellWidth,
}: {
  bands: StatementCoverageBand[]
  accountLabelWidth: number
  cellWidth: number
}) {
  return (
    <tr>
      <th style={{ width: accountLabelWidth, padding: 0 }} />
      {bands.map((band) => (
        <th
          key={band.label}
          colSpan={band.months.length}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--color-text-muted)',
            textAlign: 'center',
            padding: '0 0 8px 0',
            borderBottom: '1px solid var(--color-border)',
            width: band.months.length * cellWidth,
          }}
        >
          {band.label}
        </th>
      ))}
    </tr>
  )
}

// ── Month header row ──────────────────────────────────────────────────────────

function MonthHeaderRow({
  bands,
  accountLabelWidth,
}: {
  bands: StatementCoverageBand[]
  accountLabelWidth: number
}) {
  const allMonths = bands.flatMap((b) => b.months)
  return (
    <tr>
      <th style={{ width: accountLabelWidth, padding: 0 }} />
      {allMonths.map((yyyyMM) => (
        <th
          key={yyyyMM}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 400,
            color: 'var(--color-text-disabled)',
            textAlign: 'center',
            padding: '4px 0',
            width: 28,
          }}
        >
          {shortMonthLabel(yyyyMM)}
        </th>
      ))}
    </tr>
  )
}

// ── Main exported component ───────────────────────────────────────────────────

export function StatementCoverageGrid() {
  const [data, setData] = useState<StatementCoverageResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/business-review/statement-coverage')
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string
            paths?: string[]
          }
          const detail = body.paths?.length
            ? `${body.error}: ${body.paths.join(', ')}`
            : (body.error ?? `HTTP ${res.status}`)
          throw new Error(detail)
        }
        return res.json() as Promise<StatementCoverageResponse>
      })
      .then((payload) => {
        setData(payload)
        setLoading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }, [])

  if (loading) return <GridSkeleton />
  if (error) return <GridError message={error} />
  if (!data) return null

  const ACCOUNT_LABEL_WIDTH = 160
  const CELL_WIDTH = 28
  const allMonths = data.bands.flatMap((b) => b.months)

  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        overflowX: 'auto',
      }}
    >
      {/* Section heading */}
      <span className="label-caps" style={{ color: 'var(--color-pillar-money)' }}>
        Statement Coverage · Bank & Credit
      </span>

      {/* Grid table */}
      <table
        style={{
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
        }}
      >
        <colgroup>
          <col style={{ width: ACCOUNT_LABEL_WIDTH }} />
          {allMonths.map((m) => (
            <col key={m} style={{ width: CELL_WIDTH }} />
          ))}
        </colgroup>

        <thead>
          <BandHeaderRow
            bands={data.bands}
            accountLabelWidth={ACCOUNT_LABEL_WIDTH}
            cellWidth={CELL_WIDTH}
          />
          <MonthHeaderRow bands={data.bands} accountLabelWidth={ACCOUNT_LABEL_WIDTH} />
        </thead>

        <tbody>
          {data.accounts.map((account) => (
            <tr key={account.key}>
              {/* Account label cell */}
              <td
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-primary)',
                  padding: '4px 12px 4px 0',
                  whiteSpace: 'nowrap',
                }}
              >
                {account.label}
              </td>

              {/* Coverage cells — one per month across all bands */}
              {allMonths.map((yyyyMM) => (
                <CoverageCell
                  key={`${account.key}-${yyyyMM}`}
                  present={account.coverage[yyyyMM] ?? false}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Fetched-at timestamp */}
      <span
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          color: 'var(--color-text-disabled)',
        }}
      >
        Fetched:{' '}
        {new Date(data.fetchedAt).toLocaleString('en-CA', { timeZone: 'America/Edmonton' })} MT
      </span>
    </div>
  )
}
