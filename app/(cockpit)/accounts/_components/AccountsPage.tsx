'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { AccountsResponse, AccountRow } from '@/app/api/accounts/route'

const fmt = (n: number) =>
  n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

const fmtFull = (n: number) =>
  n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
  })

const CATEGORY_LABELS: Record<string, string> = {
  bank: 'Business Banking',
  personal_bank: 'Personal Banking',
  cash: 'Cash',
  amazon: 'Amazon Receivables',
  prepaid: 'Prepaid',
  inventory: 'Inventory',
  equipment: 'Equipment & Vehicles',
  receivable: 'Money Owed To You',
  personal_investment: 'Investments',
  credit_card: 'Credit Cards',
  loan: 'Loans',
  tax: 'Tax Owing',
  other: 'Other',
}

const CATEGORY_ORDER: string[] = [
  // Assets
  'bank',
  'personal_bank',
  'cash',
  'amazon',
  'personal_investment',
  'inventory',
  'equipment',
  'receivable',
  'prepaid',
  // Liabilities
  'credit_card',
  'loan',
  'tax',
  'other',
]

export function AccountsPage() {
  const [data, setData] = useState<AccountsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    fetch('/api/accounts')
      .then((r) => r.json())
      .then((d: AccountsResponse & { error?: string }) => {
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
        maxWidth: 1100,
        margin: '0 auto',
        fontFamily: 'var(--font-ui)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
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
            Accounts
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-text-muted)',
              margin: '6px 0 0',
            }}
          >
            Bank balances, credit cards, loans — what every account shows on its most recent
            statement.
          </p>
        </div>
        <Link
          href="/balance-sheet"
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            padding: '7px 14px',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-muted)',
            textDecoration: 'none',
          }}
        >
          Edit Balances →
        </Link>
      </div>

      {loading && (
        <div
          style={{
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
            marginTop: 24,
          }}
        >
          Loading…
        </div>
      )}
      {error && (
        <div style={{ color: '#e5534b', fontSize: 'var(--text-small)', marginTop: 16 }}>
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* KPI grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
              margin: '24px 0',
            }}
          >
            <Kpi label="Cash" value={fmt(data.totalCash)} color="var(--color-pillar-money)" />
            <Kpi
              label="Investments"
              value={fmt(data.totalInvestments)}
              color="var(--color-accent-gold)"
            />
            <Kpi
              label="Cards Owing"
              value={fmt(data.totalCardsOwing)}
              color={data.totalCardsOwing > 0 ? '#e5534b' : 'var(--color-text-muted)'}
            />
            <Kpi
              label="Loans"
              value={fmt(data.totalLoans)}
              color={data.totalLoans > 0 ? '#e5534b' : 'var(--color-text-muted)'}
            />
            <Kpi
              label="Tax Owing"
              value={fmt(data.totalTaxOwing)}
              color={data.totalTaxOwing > 0 ? '#FF9800' : 'var(--color-text-muted)'}
            />
            <Kpi
              label="Net Worth"
              value={fmt(data.netWorth)}
              color="var(--color-pillar-health)"
              big
            />
          </div>

          {data.staleCount > 0 && (
            <div
              style={{
                background: 'rgba(255,152,0,0.08)',
                border: '1px solid rgba(255,152,0,0.3)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 14px',
                marginBottom: 16,
                fontSize: 'var(--text-small)',
                color: '#FF9800',
              }}
            >
              ⚠ {data.staleCount} account{data.staleCount === 1 ? '' : 's'} not updated in 60+ days.
              Stale rows shown faded below — update on{' '}
              <Link
                href="/balance-sheet"
                style={{
                  color: '#FF9800',
                  textDecoration: 'underline',
                  fontWeight: 600,
                }}
              >
                /balance-sheet
              </Link>
              .
            </div>
          )}

          {/* Assets */}
          <Section
            title="Assets"
            color="var(--color-accent-gold)"
            accounts={data.accounts.filter((a) => a.account_type === 'asset')}
          />

          {/* Liabilities */}
          <Section
            title="Liabilities"
            color="#e5534b"
            accounts={data.accounts.filter((a) => a.account_type === 'liability')}
          />

          <p
            style={{
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
              marginTop: 16,
              lineHeight: 1.6,
            }}
          >
            Cash = bank + personal banking + cash rows. Investments = FHSA / RRSP / TFSA / similar.
            &ldquo;Days ago&rdquo; is from the row&apos;s as-of date — update those when statements
            arrive to keep this dashboard fresh. Click any number to edit on{' '}
            <Link
              href="/balance-sheet"
              style={{ color: 'var(--color-accent-gold)', textDecoration: 'underline' }}
            >
              /balance-sheet
            </Link>
            .
          </p>
        </>
      )}
    </div>
  )
}

function Section({
  title,
  color,
  accounts,
}: {
  title: string
  color: string
  accounts: AccountRow[]
}) {
  // Group by category, ordered
  const byCategory = new Map<string, AccountRow[]>()
  for (const a of accounts) {
    if (a.balance === 0 && title === 'Liabilities') continue // hide $0 liabilities
    if (!byCategory.has(a.category)) byCategory.set(a.category, [])
    byCategory.get(a.category)!.push(a)
  }
  const orderedCats = CATEGORY_ORDER.filter((c) => byCategory.has(c)).concat(
    [...byCategory.keys()].filter((c) => !CATEGORY_ORDER.includes(c))
  )

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        marginBottom: 24,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 16px',
          background: 'var(--color-surface-2)',
          borderBottom: '1px solid var(--color-border)',
          fontSize: '0.65rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color,
        }}
      >
        {title}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {orderedCats.map((cat) => {
            const rows = byCategory.get(cat) ?? []
            if (rows.length === 0) return null
            const catTotal = rows.reduce((s, r) => s + r.balance, 0)
            return (
              <CategoryGroup
                key={cat}
                label={CATEGORY_LABELS[cat] ?? cat}
                rows={rows}
                total={catTotal}
              />
            )
          })}
          {orderedCats.length === 0 && (
            <tr>
              <td
                colSpan={4}
                style={{
                  padding: '20px',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-disabled)',
                }}
              >
                Nothing here.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function CategoryGroup({
  label,
  rows,
  total,
}: {
  label: string
  rows: AccountRow[]
  total: number
}) {
  return (
    <>
      <tr style={{ background: 'color-mix(in srgb, var(--color-surface-2) 50%, transparent)' }}>
        <td
          colSpan={3}
          style={{
            padding: '7px 16px',
            fontSize: '0.62rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--color-text-disabled)',
          }}
        >
          {label}
        </td>
        <td
          style={{
            padding: '7px 16px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.78rem',
            fontWeight: 700,
            color: 'var(--color-text-muted)',
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {fmt(total)}
        </td>
      </tr>
      {rows.map((r) => (
        <AccountRowRender key={r.id} row={r} />
      ))}
    </>
  )
}

function AccountRowRender({ row }: { row: AccountRow }) {
  const dot =
    row.freshness === 'fresh'
      ? 'var(--color-pillar-health)'
      : row.freshness === 'aging'
        ? 'var(--color-accent-gold)'
        : '#e5534b'
  const opacity = row.freshness === 'stale' ? 0.65 : 1

  return (
    <tr
      style={{
        borderBottom: '1px solid var(--color-border)',
        opacity,
      }}
    >
      <td
        style={{
          padding: '8px 16px 8px 28px',
          width: '4px',
          verticalAlign: 'middle',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: dot,
          }}
          title={`${row.freshness}: ${row.days_since_update} days since last update`}
        />
      </td>
      <td
        style={{
          padding: '8px 16px 8px 0',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-primary)',
        }}
      >
        {row.name}
      </td>
      <td
        style={{
          padding: '8px 16px',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.72rem',
          color: 'var(--color-text-disabled)',
          whiteSpace: 'nowrap',
          textAlign: 'right',
        }}
      >
        {row.as_of_date} ({row.days_since_update}d ago)
      </td>
      <td
        style={{
          padding: '8px 16px',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-primary)',
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          width: 130,
          whiteSpace: 'nowrap',
        }}
      >
        {fmtFull(row.balance)}
      </td>
    </tr>
  )
}

function Kpi({
  label,
  value,
  color,
  big,
}: {
  label: string
  value: string
  color: string
  big?: boolean
}) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        padding: '14px 16px',
        gridColumn: big ? 'span 2' : 'auto',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: big ? '1.6rem' : '1.2rem',
          fontWeight: 700,
          color,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: '0.62rem',
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
