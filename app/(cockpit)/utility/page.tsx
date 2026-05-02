/**
 * Utility Tracker — Sprint 5 port from Streamlit pages/52_Utility_Tracker.py
 *
 * Data: Supabase utility_bills table. No Google Sheets dependency.
 * Auth: createServiceClient() — standard cockpit pattern (same as money/page.tsx).
 *
 * 20% Better improvements vs Streamlit baseline:
 *   - Month-over-month delta on Latest Bill metric (Streamlit showed static value only)
 *   - Provider column auto-hides when all rows share the same value
 *   - Upsert via Supabase ON CONFLICT — no linear scan over all rows like Streamlit
 *   - F18 agent_events logging per save
 */

import { createServiceClient } from '@/lib/supabase/service'
import { UtilityEntryForm } from './_components/UtilityEntryForm'
import { UtilityDebugPanel } from './_components/UtilityDebugPanel'

export const dynamic = 'force-dynamic'

// ── Types ──────────────────────────────────────────────────────────────────────

interface UtilityBill {
  id: string
  month: string
  kwh: number
  amount_cad: number
  provider: string
  notes: string | null
  updated_at: string
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

function fmtCad(n: number): string {
  return `$${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtKwh(n: number): string {
  return `${n.toFixed(1)} kWh`
}

/** Format YYYY-MM as "Jan 2026" */
function fmtMonthLabel(ym: string): string {
  const [year, mon] = ym.split('-')
  const d = new Date(Number(year), Number(mon) - 1, 1)
  return d.toLocaleDateString('en-CA', { month: 'short', year: 'numeric' })
}

// ── Summary metric tile ────────────────────────────────────────────────────────

function MetricTile({
  label,
  value,
  sub,
  subColor,
}: {
  label: string
  value: string
  sub?: string
  subColor?: string
}) {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
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
          fontSize: 'var(--text-heading)',
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
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-small)',
            color: subColor ?? 'var(--color-text-muted)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {sub}
        </span>
      )}
    </div>
  )
}

// ── Proportional bar chart (no recharts — consistent with AmazonDailyChart) ────

function MiniBarChart({
  data,
  color,
  label,
}: {
  data: { label: string; value: number }[]
  color: string
  label: string
}) {
  const maxVal = Math.max(...data.map((d) => d.value), 1)

  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        padding: '16px 20px',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--color-text-muted)',
          display: 'block',
          marginBottom: 12,
        }}
      >
        {label}
      </span>
      <div style={{ overflowX: 'auto' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 4,
            height: 100,
            minWidth: `${data.length * 24}px`,
          }}
        >
          {data.map((point) => {
            const barHeightPct = (point.value / maxVal) * 100
            const barHeightPx = Math.max(barHeightPct, point.value > 0 ? 3 : 0)
            return (
              <div
                key={point.label}
                title={`${point.label}: ${point.value}`}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  height: '100%',
                  cursor: 'default',
                }}
              >
                <div
                  style={{
                    width: '80%',
                    height: `${barHeightPx}%`,
                    backgroundColor: color,
                    borderRadius: '2px 2px 0 0',
                    opacity: 0.85,
                    minHeight: point.value > 0 ? 2 : 0,
                  }}
                />
              </div>
            )
          })}
        </div>
        {/* X-axis labels — show every 3rd to avoid crowding */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            minWidth: `${data.length * 24}px`,
            marginTop: 4,
          }}
        >
          {data.map((point, i) => (
            <div
              key={point.label}
              style={{
                flex: 1,
                textAlign: 'center',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-nano)',
                color: 'var(--color-text-disabled)',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                opacity: i % 3 === 0 ? 1 : 0,
              }}
            >
              {point.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function UtilityPage() {
  const supabase = createServiceClient()

  const { data: rawBills, error } = await supabase
    .from('utility_bills')
    .select('id, month, kwh, amount_cad, provider, notes, updated_at')
    .order('month', { ascending: false })
    .limit(60) // ~5 years

  const bills: UtilityBill[] = rawBills ?? []

  // ── Summary metrics ────────────────────────────────────────────────────────
  const totalBilled = bills.reduce((s, b) => s + Number(b.amount_cad), 0)
  const avgMonthlyCost = bills.length > 0 ? totalBilled / bills.length : 0
  const avgMonthlyKwh =
    bills.length > 0 ? bills.reduce((s, b) => s + Number(b.kwh), 0) / bills.length : 0

  const latest = bills[0] ?? null
  const prior = bills[1] ?? null
  const latestDelta = latest && prior ? Number(latest.amount_cad) - Number(prior.amount_cad) : null

  // ── Chart data (ascending order = oldest-to-newest on chart) ──────────────
  const ascending = [...bills].reverse()
  const kwhChartData = ascending.map((b) => ({
    label: fmtMonthLabel(b.month),
    value: Number(b.kwh),
  }))
  const costChartData = ascending.map((b) => ({
    label: fmtMonthLabel(b.month),
    value: Number(b.amount_cad),
  }))

  // ── Provider column visibility ─────────────────────────────────────────────
  const allSameProvider = bills.length === 0 || bills.every((b) => b.provider === bills[0].provider)

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--color-base)',
        padding: '24px',
      }}
    >
      {/* ── Cockpit top rail ────────────────────────────────────────────── */}
      <div
        style={{
          height: 2,
          backgroundColor: 'var(--color-rail)',
          boxShadow: '0 0 12px var(--color-rail-glow)',
          marginBottom: 24,
        }}
      />

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-heading)',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            margin: 0,
          }}
        >
          Utility Tracker
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            margin: '4px 0 0',
            letterSpacing: '0.04em',
          }}
        >
          Monthly power usage from Metergy statements
        </p>
      </div>

      {error && (
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-critical)',
            padding: '12px 20px',
            marginBottom: 16,
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-body)',
            color: 'var(--color-critical)',
          }}
        >
          Supabase error: {error.message}
        </div>
      )}

      {/* ── Summary metrics — 4 tiles ────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <MetricTile label="Total Billed" value={bills.length > 0 ? fmtCad(totalBilled) : '—'} />
        <MetricTile
          label="Avg Monthly Cost"
          value={bills.length > 0 ? fmtCad(avgMonthlyCost) : '—'}
        />
        <MetricTile
          label="Avg Monthly kWh"
          value={bills.length > 0 ? fmtKwh(avgMonthlyKwh) : '—'}
        />
        <MetricTile
          label="Latest Bill"
          value={latest ? fmtCad(Number(latest.amount_cad)) : '—'}
          sub={
            latest
              ? latestDelta !== null
                ? `${latestDelta >= 0 ? '▲' : '▼'} ${fmtCad(Math.abs(latestDelta))} vs prior`
                : latest.month
              : undefined
          }
          subColor={
            latestDelta !== null
              ? latestDelta > 0
                ? 'var(--color-warning)'
                : 'var(--color-positive)'
              : undefined
          }
        />
      </div>

      {/* ── Charts (only when data exists) ──────────────────────────────── */}
      {bills.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 16,
            marginBottom: 24,
          }}
        >
          <MiniBarChart
            data={kwhChartData}
            color="var(--color-pillar-growing)"
            label="Monthly kWh Usage"
          />
          <MiniBarChart
            data={costChartData}
            color="var(--color-pillar-money)"
            label="Monthly Cost (CAD)"
          />
        </div>
      )}

      {/* ── Data table ───────────────────────────────────────────────────── */}
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
          marginBottom: 24,
        }}
      >
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-text-muted)',
            }}
          >
            All Statements
          </span>
          {allSameProvider && bills.length > 0 && (
            <span
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                color: 'var(--color-text-disabled)',
              }}
            >
              Provider: {bills[0].provider}
            </span>
          )}
        </div>

        {bills.length === 0 ? (
          <div
            style={{
              padding: 32,
              textAlign: 'center',
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-body)',
              color: 'var(--color-text-muted)',
            }}
          >
            No utility data yet. Add your first entry below.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-small)',
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  {[
                    'Month',
                    'kWh',
                    'Amount',
                    ...(allSameProvider ? [] : ['Provider']),
                    'Notes',
                  ].map((col) => (
                    <th
                      key={col}
                      style={{
                        padding: '8px 16px',
                        textAlign:
                          col === 'Month' || col === 'Provider' || col === 'Notes'
                            ? 'left'
                            : 'right',
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-nano)',
                        fontWeight: 600,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: 'var(--color-text-disabled)',
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bills.map((bill, i) => (
                  <tr
                    key={bill.id}
                    style={{
                      borderBottom:
                        i < bills.length - 1 ? '1px solid var(--color-border-pillar)' : undefined,
                    }}
                  >
                    <td
                      style={{
                        padding: '10px 16px',
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      {fmtMonthLabel(bill.month)}
                    </td>
                    <td
                      style={{
                        padding: '10px 16px',
                        textAlign: 'right',
                        color: 'var(--color-text-secondary)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {Number(bill.kwh).toFixed(1)}
                    </td>
                    <td
                      style={{
                        padding: '10px 16px',
                        textAlign: 'right',
                        color: 'var(--color-text-secondary)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {fmtCad(Number(bill.amount_cad))}
                    </td>
                    {!allSameProvider && (
                      <td
                        style={{
                          padding: '10px 16px',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        {bill.provider}
                      </td>
                    )}
                    <td
                      style={{
                        padding: '10px 16px',
                        color: 'var(--color-text-disabled)',
                      }}
                    >
                      {bill.notes ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Add / Update form ────────────────────────────────────────────── */}
      <UtilityEntryForm />

      {/* ── Debug panel (dev mode only) ──────────────────────────────────── */}
      <UtilityDebugPanel
        bills={bills}
        summary={{ totalBilled, avgMonthlyCost, avgMonthlyKwh, latestDelta, billCount: bills.length }}
      />
    </div>
  )
}
