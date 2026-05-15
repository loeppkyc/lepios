'use client'

/**
 * StatsTab — trading statistics panel.
 *
 * Originally built in Chunk A (equity curve, mood/ticker/grade charts, streaks).
 * Chunk C additions: Calibration chart (§9) + Bankroll Health section (§9).
 *
 * F20: No style={} — Tailwind only. All charts use shadcn/ui ChartContainer.
 */

import { useMemo, useEffect, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ReferenceLine,
} from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { TradeRow } from '@/lib/trading/types'
import type { CalibrationBucket } from '@/lib/trading/calibration'
import { CALIBRATION_MIN_TOTAL_BETS } from '@/lib/trading/calibration'
import type { BankrollSummary } from '@/lib/trading/bankroll'

interface StatsTabProps {
  trades: TradeRow[]
}

// ── Chart configs ─────────────────────────────────────────────────────────────

const equityChartConfig = {
  paper: { label: 'Paper P&L', color: 'var(--color-pillar-money)' },
  live: { label: 'Live P&L', color: 'var(--color-pillar-wealth)' },
} satisfies ChartConfig

const moodChartConfig = {
  win_rate: { label: 'Win %', color: 'var(--color-pillar-money)' },
} satisfies ChartConfig

const tickerChartConfig = {
  win_rate: { label: 'Win %', color: 'var(--color-pillar-money)' },
} satisfies ChartConfig

const calibrationChartConfig = {
  actual: { label: 'Actual Win %', color: 'var(--color-pillar-money)' },
} satisfies ChartConfig

const bankrollChartConfig = {
  bankroll: { label: 'Bankroll', color: 'var(--color-pillar-money)' },
  high_water_mark: { label: 'High-Water Mark', color: 'var(--color-pillar-wealth)' },
} satisfies ChartConfig

// ── Calibration chart (Chunk C) ───────────────────────────────────────────────

function CalibrationSection() {
  const [buckets, setBuckets] = useState<CalibrationBucket[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [totalBets, setTotalBets] = useState(0)

  useEffect(() => {
    Promise.all([
      fetch('/api/trading/calibration').then((r) => r.json()) as Promise<CalibrationBucket[]>,
      // Get total bet count with win_prob_pct for unlock threshold
      fetch('/api/trading/calibration?from=2000-01-01').then((r) => r.json()),
    ])
      .then(([data]) => {
        // data is CalibrationBucket[] — count all bets via summing counts
        const total = (data as CalibrationBucket[]).reduce((s, b) => s + b.count, 0)
        setTotalBets(total)
        setBuckets(data as CalibrationBucket[])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
      <span className="label-caps text-[var(--color-text-secondary)]">
        Win Probability Calibration
      </span>
      <p className="mt-1 text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
        Are your estimates accurate? Dots above the line = you&apos;re underconfident.
      </p>

      {loading && (
        <p className="mt-4 text-[length:var(--text-small)] text-[var(--color-text-disabled)]">
          Loading…
        </p>
      )}

      {!loading && (!buckets || totalBets < CALIBRATION_MIN_TOTAL_BETS) && (
        <p className="mt-4 text-[length:var(--text-small)] text-[var(--color-text-disabled)]">
          Log {CALIBRATION_MIN_TOTAL_BETS}+ bets with win probability estimates to unlock
        </p>
      )}

      {!loading && buckets && totalBets >= CALIBRATION_MIN_TOTAL_BETS && (
        <ChartContainer config={calibrationChartConfig} className="mt-4 h-48 w-full">
          <ScatterChart margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-border)" strokeOpacity={0.4} />
            <XAxis
              type="number"
              dataKey="predicted"
              domain={[40, 100]}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 9, fill: 'var(--color-text-disabled)' }}
              label={{
                value: 'Estimated %',
                position: 'insideBottom',
                offset: -2,
                fontSize: 9,
                fill: 'var(--color-text-disabled)',
              }}
            />
            <YAxis
              type="number"
              dataKey="actual"
              domain={[0, 100]}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 9, fill: 'var(--color-text-disabled)' }}
              tickFormatter={(v: number) => `${v}%`}
            />
            {/* Perfect calibration reference line (y = x) */}
            <ReferenceLine
              segment={[
                { x: 40, y: 40 },
                { x: 100, y: 100 },
              ]}
              stroke="var(--color-text-disabled)"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) =>
                    name === 'actual' ? [`${value}%`, 'Actual'] : [`${value}%`, 'Predicted']
                  }
                />
              }
            />
            <Scatter data={buckets} fill="var(--color-pillar-money)" fillOpacity={0.8} />
          </ScatterChart>
        </ChartContainer>
      )}
    </div>
  )
}

// ── Bankroll health section (Chunk C) ─────────────────────────────────────────

function BankrollSection() {
  const [summary, setSummary] = useState<BankrollSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/trading/bankroll')
      .then((r) => r.json() as Promise<BankrollSummary>)
      .then((d) => {
        setSummary(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
        <span className="label-caps text-[var(--color-text-secondary)]">Bankroll Health</span>
        <p className="mt-2 text-[length:var(--text-small)] text-[var(--color-text-disabled)]">
          Loading…
        </p>
      </div>
    )
  }

  if (!summary || summary.history.length === 0) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
        <span className="label-caps text-[var(--color-text-secondary)]">Bankroll Health</span>
        <p className="mt-2 text-[length:var(--text-small)] text-[var(--color-text-disabled)]">
          Log bets with bankroll readings to unlock health tracking.
        </p>
      </div>
    )
  }

  const drawdownColor =
    summary.current_drawdown_pct < -10
      ? 'text-red-400'
      : summary.current_drawdown_pct < 0
        ? 'text-yellow-400'
        : 'text-green-400'

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
      <span className="label-caps text-[var(--color-text-secondary)]">Bankroll Health</span>

      {/* Stat tiles */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <p className="text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
            Current
          </p>
          <p className="font-mono text-base font-semibold text-[var(--color-text-primary)]">
            ${summary.current.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
            High-Water Mark
          </p>
          <p className="font-mono text-base font-semibold text-[var(--color-pillar-wealth)]">
            ${summary.high_water_mark.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
            Drawdown
          </p>
          <p className={`font-mono text-base font-semibold ${drawdownColor}`}>
            {summary.current_drawdown_pct > 0 ? '+' : ''}
            {summary.current_drawdown_pct}%
          </p>
        </div>
      </div>

      {/* Bankroll area chart */}
      <ChartContainer config={bankrollChartConfig} className="mt-4 h-40 w-full">
        <AreaChart data={summary.history} margin={{ top: 4, right: 0, left: -10, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.4} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 9, fill: 'var(--color-text-disabled)' }}
            interval="preserveStartEnd"
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 9, fill: 'var(--color-text-disabled)' }}
            tickFormatter={(v: number) => `$${v}`}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Area
            type="monotone"
            dataKey="bankroll"
            stroke="var(--color-pillar-money)"
            fill="var(--color-pillar-money)"
            fillOpacity={0.1}
            strokeWidth={1.5}
          />
          <Area
            type="monotone"
            dataKey="high_water_mark"
            stroke="var(--color-pillar-wealth)"
            fill="none"
            strokeDasharray="4 4"
            strokeWidth={1}
            strokeOpacity={0.6}
          />
        </AreaChart>
      </ChartContainer>

      {/* Kelly recommendation */}
      {summary.kelly_stake > 0 && (
        <p className="mt-3 text-[length:var(--text-small)] text-[var(--color-text-secondary)]">
          At ${summary.current.toFixed(2)} bankroll, quarter Kelly suggests{' '}
          <span className="font-mono font-semibold text-[var(--color-pillar-money)]">
            ${summary.kelly_stake.toFixed(2)}
          </span>{' '}
          max stake
          <span className="ml-1 text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
            (estimates use placeholder odds — TODO: tune with real data)
          </span>
        </p>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function StatsTab({ trades }: StatsTabProps) {
  const settledTrades = trades.filter((t) => t.dollar_pnl != null)

  // ── Equity curve ────────────────────────────────────────────────────────────
  const equityData = useMemo(() => {
    const sorted = [...settledTrades].sort((a, b) =>
      (a.date_out ?? a.trade_date) < (b.date_out ?? b.trade_date) ? -1 : 1
    )
    type EquityPoint = { date: string; paper: number; live: number }
    return sorted.reduce<{ rows: EquityPoint[]; paperCum: number; liveCum: number }>(
      (acc, t) => {
        const pnl = t.dollar_pnl ?? 0
        const paperCum = t.mode === 'paper' ? acc.paperCum + pnl : acc.paperCum
        const liveCum = t.mode !== 'paper' ? acc.liveCum + pnl : acc.liveCum
        return {
          rows: [
            ...acc.rows,
            {
              date: t.date_out ?? t.trade_date,
              paper: parseFloat(paperCum.toFixed(2)),
              live: parseFloat(liveCum.toFixed(2)),
            },
          ],
          paperCum,
          liveCum,
        }
      },
      { rows: [], paperCum: 0, liveCum: 0 }
    ).rows
  }, [settledTrades])

  // ── Win rate by mood ─────────────────────────────────────────────────────────
  const moodData = useMemo(() => {
    const map: Record<string, { wins: number; total: number }> = {}
    for (const t of settledTrades) {
      if (!t.mood) continue
      map[t.mood] ??= { wins: 0, total: 0 }
      map[t.mood].total++
      if ((t.dollar_pnl ?? 0) > 0) map[t.mood].wins++
    }
    return Object.entries(map)
      .filter(([, v]) => v.total >= 2)
      .map(([mood, { wins, total }]) => ({
        mood,
        win_rate: parseFloat(((wins / total) * 100).toFixed(1)),
        total,
      }))
      .sort((a, b) => b.win_rate - a.win_rate)
  }, [settledTrades])

  // ── Win rate by ticker ───────────────────────────────────────────────────────
  const tickerData = useMemo(() => {
    const map: Record<string, { wins: number; total: number }> = {}
    for (const t of settledTrades) {
      map[t.ticker] ??= { wins: 0, total: 0 }
      map[t.ticker].total++
      if ((t.dollar_pnl ?? 0) > 0) map[t.ticker].wins++
    }
    return Object.entries(map)
      .filter(([, v]) => v.total >= 1)
      .map(([ticker, { wins, total }]) => ({
        ticker,
        win_rate: parseFloat(((wins / total) * 100).toFixed(1)),
        total,
      }))
      .sort((a, b) => b.win_rate - a.win_rate)
  }, [settledTrades])

  // ── By grade ──────────────────────────────────────────────────────────────
  const gradeData = useMemo(() => {
    const map: Record<string, { wins: number; losses: number; r_sum: number }> = {}
    for (const t of settledTrades) {
      const grade = (t.ai_notes as Record<string, unknown> | null)?.grade as string | null
      const g = grade ?? 'Unlinked'
      map[g] ??= { wins: 0, losses: 0, r_sum: 0 }
      if ((t.dollar_pnl ?? 0) > 0) map[g].wins++
      else map[g].losses++
      map[g].r_sum += t.r_multiple ?? 0
    }
    return Object.entries(map).map(([grade, { wins, losses, r_sum }]) => ({
      grade,
      wins,
      losses,
      total: wins + losses,
      win_pct: wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '—',
      avg_r: wins + losses > 0 ? (r_sum / (wins + losses)).toFixed(2) : '—',
    }))
  }, [settledTrades])

  // ── Streak ───────────────────────────────────────────────────────────────────
  const { currentStreak, longestWinStreak } = useMemo(() => {
    const sorted = [...settledTrades].sort((a, b) =>
      (a.date_out ?? a.trade_date) > (b.date_out ?? b.trade_date) ? -1 : 1
    )
    let cur = 0
    let curSign = 0
    let longest = 0
    let curWinRun = 0
    for (const t of sorted) {
      const won = (t.dollar_pnl ?? 0) > 0
      const sign = won ? 1 : -1
      if (cur === 0 || sign === curSign) {
        cur++
        curSign = sign
        if (won) curWinRun++
        else curWinRun = 0
      } else {
        break
      }
      longest = Math.max(longest, curWinRun)
    }
    return {
      currentStreak: { count: cur, direction: curSign > 0 ? 'wins' : 'losses' },
      longestWinStreak: longest,
    }
  }, [settledTrades])

  if (settledTrades.length === 0) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-8 text-center">
        <p className="text-[length:var(--text-small)] text-[var(--color-text-disabled)]">
          No settled trades yet. Log and settle some trades to see stats.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Streak counters */}
      <div className="flex gap-4">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          <p className="text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
            Current Streak
          </p>
          <p
            className={`text-lg font-semibold ${
              currentStreak.direction === 'wins' ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {currentStreak.count} {currentStreak.direction}
          </p>
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          <p className="text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
            Longest Win Run
          </p>
          <p className="text-lg font-semibold text-green-400">{longestWinStreak}</p>
        </div>
      </div>

      {/* Equity curve */}
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
        <span className="label-caps text-[var(--color-pillar-money)]">P&L Equity Curve</span>
        <ChartContainer config={equityChartConfig} className="mt-4 h-44 w-full">
          <AreaChart data={equityData} margin={{ top: 4, right: 0, left: -10, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.4} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: 'var(--color-text-disabled)' }}
              interval="preserveStartEnd"
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: 'var(--color-text-disabled)' }}
              tickFormatter={(v: number) => `$${v}`}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area
              type="monotone"
              dataKey="paper"
              stroke="var(--color-pillar-money)"
              fill="var(--color-pillar-money)"
              fillOpacity={0.1}
              strokeWidth={1.5}
            />
            <Area
              type="monotone"
              dataKey="live"
              stroke="var(--color-pillar-wealth)"
              fill="var(--color-pillar-wealth)"
              fillOpacity={0.1}
              strokeWidth={1.5}
            />
          </AreaChart>
        </ChartContainer>
      </div>

      {/* Win rate by mood */}
      {moodData.length > 0 && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
          <span className="label-caps text-[var(--color-text-secondary)]">Win Rate by Mood</span>
          <ChartContainer config={moodChartConfig} className="mt-4 h-36 w-full">
            <BarChart data={moodData} margin={{ top: 4, right: 0, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.4} />
              <XAxis
                dataKey="mood"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 9, fill: 'var(--color-text-disabled)' }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 9, fill: 'var(--color-text-disabled)' }}
                tickFormatter={(v: number) => `${v}%`}
                domain={[0, 100]}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="win_rate" fill="var(--color-pillar-money)" radius={[2, 2, 0, 0]}>
                {moodData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={
                      entry.win_rate >= 50
                        ? 'var(--color-pillar-money)'
                        : 'var(--color-text-disabled)'
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </div>
      )}

      {/* Win rate by ticker */}
      {tickerData.length > 0 && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
          <span className="label-caps text-[var(--color-text-secondary)]">Win Rate by Ticker</span>
          <ChartContainer config={tickerChartConfig} className="mt-4 h-36 w-full">
            <BarChart
              layout="vertical"
              data={tickerData}
              margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
            >
              <CartesianGrid horizontal={false} stroke="var(--color-border)" strokeOpacity={0.4} />
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 9, fill: 'var(--color-text-disabled)' }}
                tickFormatter={(v: number) => `${v}%`}
                domain={[0, 100]}
              />
              <YAxis
                dataKey="ticker"
                type="category"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 9, fill: 'var(--color-text-disabled)' }}
                width={40}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="win_rate" fill="var(--color-pillar-money)" radius={[0, 2, 2, 0]} />
            </BarChart>
          </ChartContainer>
        </div>
      )}

      {/* By grade table */}
      {gradeData.length > 0 && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
          <span className="label-caps mb-3 block text-[var(--color-text-secondary)]">
            Results by AI Grade
          </span>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[var(--color-text-disabled)]">
                <th className="pb-2 text-left font-medium">Grade</th>
                <th className="pb-2 text-right font-medium">W</th>
                <th className="pb-2 text-right font-medium">L</th>
                <th className="pb-2 text-right font-medium">Total</th>
                <th className="pb-2 text-right font-medium">Win %</th>
                <th className="pb-2 text-right font-medium">Avg R</th>
              </tr>
            </thead>
            <tbody>
              {gradeData.map((row) => (
                <tr
                  key={row.grade}
                  className="border-t border-[var(--color-border)] text-[var(--color-text-primary)]"
                >
                  <td className="py-1.5 font-semibold">{row.grade}</td>
                  <td className="py-1.5 text-right text-green-400">{row.wins}</td>
                  <td className="py-1.5 text-right text-red-400">{row.losses}</td>
                  <td className="py-1.5 text-right">{row.total}</td>
                  <td className="py-1.5 text-right">{row.win_pct}%</td>
                  <td className="py-1.5 text-right">{row.avg_r}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Chunk C additions ──────────────────────────────────────────────────── */}

      {/* Calibration chart */}
      <CalibrationSection />

      {/* Bankroll health */}
      <BankrollSection />
    </div>
  )
}
