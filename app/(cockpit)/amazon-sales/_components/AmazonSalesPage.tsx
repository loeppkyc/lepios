'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

type WindowKey = '30d' | '60d' | '90d' | 'ytd' | 'all'

interface DailyPoint {
  date: string
  revenue: number
  units: number
  roll7: number
  roll30: number
}

interface RollingWindow {
  label: '7d' | '30d' | '60d' | '90d'
  total: number
  avgPerDay: number
  days: number
}

interface DayRow {
  date: string
  revenue: number
  units: number
}

interface SettlementRow {
  id: string
  periodStart: string
  periodEnd: string
  netPayout: number
  fundTransferStatus: string
}

interface Payload {
  window: WindowKey
  rangeStart: string | null
  rangeEnd: string | null
  kpis: {
    monthSales: number
    monthSalesPrev: number
    monthNet: number
    monthNetPrev: number
    avgPerDay: number
    bestDay: number
    bestDayDate: string | null
  }
  dailySeries: DailyPoint[]
  rollingWindows: RollingWindow[]
  topDays: DayRow[]
  bottomDays: DayRow[]
  settlements: SettlementRow[]
  monthlyAvailable: boolean
}

const WINDOWS: WindowKey[] = ['30d', '60d', '90d', 'ytd', 'all']
const WINDOW_LABEL: Record<WindowKey, string> = {
  '30d': '30d',
  '60d': '60d',
  '90d': '90d',
  ytd: 'YTD',
  all: 'All',
}

function fmt(n: number): string {
  return n.toLocaleString('en-CA', { maximumFractionDigits: 0 })
}

function fmtMoney(n: number): string {
  return `$${fmt(n)}`
}

function deltaPct(curr: number, prev: number): { pct: string; positive: boolean } | null {
  if (prev === 0) return null
  const pct = ((curr - prev) / Math.abs(prev)) * 100
  return { pct: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`, positive: pct >= 0 }
}

function fmtShortDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

const dailyChartConfig = {
  revenue: { label: 'Revenue', color: 'var(--color-pillar-money)' },
  roll7: { label: '7-day Avg', color: 'var(--color-text-muted)' },
  roll30: { label: '30-day Avg', color: 'var(--color-text-disabled)' },
} satisfies ChartConfig

const settlementsChartConfig = {
  netPayout: { label: 'Net Payout', color: 'var(--color-pillar-money)' },
} satisfies ChartConfig

export function AmazonSalesPage() {
  const [windowKey, setWindowKey] = useState<WindowKey>('90d')
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [refetchKey, setRefetchKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setFetchError(null)
      try {
        const res = await fetch(`/api/amazon-sales?window=${windowKey}`, { cache: 'no-store' })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        const j = (await res.json()) as Payload
        if (!cancelled) setData(j)
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
  }, [windowKey, refetchKey])

  const monthDelta = useMemo(
    () => (data ? deltaPct(data.kpis.monthSales, data.kpis.monthSalesPrev) : null),
    [data]
  )
  const netDelta = useMemo(
    () => (data ? deltaPct(data.kpis.monthNet, data.kpis.monthNetPrev) : null),
    [data]
  )

  return (
    <div className="mx-auto max-w-[1100px] px-8 py-7">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <span className="font-[family-name:var(--font-ui)] text-[length:var(--text-small)] font-bold tracking-[0.1em] text-[var(--color-pillar-money)] uppercase">
          Sales Charts — Amazon
        </span>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-1">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setWindowKey(w)}
                className={`rounded-[var(--radius-sm)] px-3 py-1 font-[family-name:var(--font-ui)] text-[length:var(--text-small)] transition-colors ${
                  w === windowKey
                    ? 'bg-[var(--color-pillar-money)] font-semibold text-[var(--color-bg)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {WINDOW_LABEL[w]}
              </button>
            ))}
          </div>
          <button
            onClick={() => setRefetchKey((k) => k + 1)}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-1 font-[family-name:var(--font-ui)] text-[length:var(--text-small)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading && (
        <div className="font-[family-name:var(--font-ui)] text-[length:var(--text-small)] text-[var(--color-text-disabled)]">
          Loading…
        </div>
      )}
      {fetchError && (
        <div className="font-[family-name:var(--font-ui)] text-[length:var(--text-small)] text-[var(--color-critical)]">
          Error: {fetchError}
        </div>
      )}

      {!loading && !fetchError && data && (
        <>
          {/* KPI strip */}
          <div className="mb-4 grid grid-cols-4 gap-3">
            <KpiCard
              label="This Month — Sales"
              value={fmtMoney(data.kpis.monthSales)}
              delta={monthDelta}
            />
            <KpiCard
              label="This Month — Net"
              value={fmtMoney(data.kpis.monthNet)}
              delta={netDelta}
            />
            <KpiCard
              label={`Avg/Day (${WINDOW_LABEL[data.window]})`}
              value={fmtMoney(data.kpis.avgPerDay)}
            />
            <KpiCard
              label={`Best Day (${WINDOW_LABEL[data.window]})`}
              value={fmtMoney(data.kpis.bestDay)}
              footnote={data.kpis.bestDayDate ? fmtShortDate(data.kpis.bestDayDate) : undefined}
            />
          </div>

          {/* Daily revenue chart */}
          <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
            <div className="mb-3 flex items-baseline justify-between">
              <span className="label-caps text-[var(--color-pillar-money)]">
                Daily Revenue + Rolling Averages
              </span>
              <div className="flex gap-3 font-[family-name:var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
                <span>
                  <span className="mr-1 inline-block size-2.5 rounded-sm bg-[var(--color-pillar-money)] opacity-85" />
                  Daily
                </span>
                <span>
                  <span className="mr-1 inline-block size-2.5 rounded-sm bg-[var(--color-text-muted)]" />
                  7d Avg
                </span>
                <span>
                  <span className="mr-1 inline-block size-2.5 rounded-sm bg-[var(--color-text-disabled)]" />
                  30d Avg
                </span>
              </div>
            </div>
            {data.dailySeries.length === 0 ? (
              <p className="font-[family-name:var(--font-ui)] text-[length:var(--text-small)] text-[var(--color-text-disabled)]">
                No order data in this window.
              </p>
            ) : (
              <ChartContainer config={dailyChartConfig} className="h-56 w-full">
                <ComposedChart
                  data={data.dailySeries}
                  margin={{ top: 4, right: 0, left: -16, bottom: 0 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="var(--color-border)"
                    strokeOpacity={0.5}
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={fmtShortDate}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    minTickGap={24}
                    tick={{
                      fontSize: 10,
                      fill: 'var(--color-text-disabled)',
                      fontFamily: 'var(--font-ui)',
                    }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    tickFormatter={(v: number) => `$${v}`}
                    tick={{
                      fontSize: 10,
                      fill: 'var(--color-text-disabled)',
                      fontFamily: 'var(--font-ui)',
                    }}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="revenue"
                    fill="var(--color-revenue)"
                    radius={[2, 2, 0, 0]}
                    opacity={0.85}
                  />
                  <Line
                    type="monotone"
                    dataKey="roll7"
                    stroke="var(--color-text-muted)"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="roll30"
                    stroke="var(--color-text-disabled)"
                    strokeWidth={2}
                    dot={false}
                    strokeDasharray="3 3"
                  />
                </ComposedChart>
              </ChartContainer>
            )}
          </div>

          {/* Rolling window strip */}
          <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
            <div className="label-caps mb-3 text-[var(--color-text-muted)]">
              Rolling Window Comparison
            </div>
            <div className="grid grid-cols-4 gap-3">
              {data.rollingWindows.map((rw) => (
                <div key={rw.label}>
                  <div className="font-[family-name:var(--font-ui)] text-[length:var(--text-nano)] tracking-[0.08em] text-[var(--color-text-disabled)] uppercase">
                    Last {rw.label}
                  </div>
                  <div className="font-[family-name:var(--font-mono)] text-[1.1rem] font-bold text-[var(--color-text-primary)]">
                    {fmtMoney(rw.total)}
                  </div>
                  <div className="font-[family-name:var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
                    {fmtMoney(rw.avgPerDay)}/day · {rw.days} days
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top / Bottom days */}
          {data.dailySeries.length > 0 && (
            <div className="mb-4 grid grid-cols-2 gap-3">
              <DayList title={`Top 5 Days (${WINDOW_LABEL[data.window]})`} rows={data.topDays} />
              <DayList
                title={`Bottom 5 Days (${WINDOW_LABEL[data.window]})`}
                rows={data.bottomDays}
              />
            </div>
          )}

          {/* Settlements */}
          <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
            <div className="mb-3 flex items-baseline justify-between">
              <span className="label-caps text-[var(--color-pillar-money)]">
                Actual Payouts (Amazon Settlements)
              </span>
              <span className="font-[family-name:var(--font-mono)] text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
                {data.settlements.length} settlements · $
                {fmt(data.settlements.reduce((s, x) => s + x.netPayout, 0))} total
              </span>
            </div>
            {data.settlements.length === 0 ? (
              <p className="font-[family-name:var(--font-ui)] text-[length:var(--text-small)] text-[var(--color-text-disabled)]">
                No settlements in this window.
              </p>
            ) : (
              <ChartContainer config={settlementsChartConfig} className="h-40 w-full">
                <BarChart
                  data={data.settlements}
                  margin={{ top: 4, right: 0, left: -16, bottom: 0 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="var(--color-border)"
                    strokeOpacity={0.5}
                  />
                  <XAxis
                    dataKey="periodEnd"
                    tickFormatter={fmtShortDate}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    minTickGap={24}
                    tick={{
                      fontSize: 10,
                      fill: 'var(--color-text-disabled)',
                      fontFamily: 'var(--font-ui)',
                    }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    tickFormatter={(v: number) => `$${v}`}
                    tick={{
                      fontSize: 10,
                      fill: 'var(--color-text-disabled)',
                      fontFamily: 'var(--font-ui)',
                    }}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="netPayout"
                    fill="var(--color-pillar-money)"
                    radius={[2, 2, 0, 0]}
                    opacity={0.85}
                  />
                </BarChart>
              </ChartContainer>
            )}
          </div>

          {/* Monthly placeholder */}
          {!data.monthlyAvailable && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
              <div className="label-caps mb-2 text-[var(--color-text-muted)]">
                Monthly Breakdown — Prior Year
              </div>
              <p className="font-[family-name:var(--font-ui)] text-[length:var(--text-small)] text-[var(--color-text-disabled)]">
                Backfill 2025 orders to enable. Currently {data.dailySeries.length} day(s) of order
                data — need ≥180 to render the monthly comparison.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function KpiCard({
  label,
  value,
  delta,
  footnote,
}: {
  label: string
  value: string
  delta?: { pct: string; positive: boolean } | null
  footnote?: string
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
      <div className="font-[family-name:var(--font-ui)] text-[length:var(--text-nano)] tracking-[0.08em] text-[var(--color-text-disabled)] uppercase">
        {label}
      </div>
      <div className="font-[family-name:var(--font-mono)] text-[1.3rem] font-bold text-[var(--color-text-primary)]">
        {value}
      </div>
      {delta && (
        <div
          className={`font-[family-name:var(--font-ui)] text-[length:var(--text-nano)] ${
            delta.positive ? 'text-[var(--color-positive,#4caf50)]' : 'text-[var(--color-critical)]'
          }`}
        >
          {delta.pct} vs prev
        </div>
      )}
      {footnote && (
        <div className="font-[family-name:var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
          {footnote}
        </div>
      )}
    </div>
  )
}

function DayList({ title, rows }: { title: string; rows: DayRow[] }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
      <div className="label-caps mb-3 text-[var(--color-text-muted)]">{title}</div>
      {rows.length === 0 ? (
        <p className="font-[family-name:var(--font-ui)] text-[length:var(--text-small)] text-[var(--color-text-disabled)]">
          —
        </p>
      ) : (
        <table className="w-full">
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} className="border-b border-[var(--color-border)] last:border-0">
                <td className="py-1 font-[family-name:var(--font-mono)] text-[length:var(--text-small)] text-[var(--color-text-secondary)]">
                  {fmtShortDate(r.date)}
                </td>
                <td className="py-1 text-right font-[family-name:var(--font-mono)] text-[length:var(--text-small)] text-[var(--color-text-primary)]">
                  {fmtMoney(r.revenue)}
                </td>
                <td className="py-1 pl-3 text-right font-[family-name:var(--font-mono)] text-[length:var(--text-small)] text-[var(--color-text-disabled)]">
                  {r.units}u
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
