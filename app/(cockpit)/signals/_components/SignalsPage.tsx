'use client'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OuraRow {
  date: string
  sleep_score: number | null
  readiness_score: number | null
  activity_score: number | null
  hrv: number | null
  resting_hr: number | null
  steps: number | null
}

interface MoodRow {
  logged_at: string
  energy: number | null
  focus: number | null
  notes: string | null
}

interface WeatherRow {
  recorded_at: string
  temp_c: number | null
  feels_like_c: number | null
  condition: string | null
  humidity: number | null
}

interface TradeRow {
  trade_date: string
  dollar_pnl: number | null
  direction: string | null
  ticker: string | null
  mode: string | null
}

interface BetRow {
  bet_date: string
  pnl: number | null
  result: string | null
  sport: string | null
  stake: number | null
}

interface Props {
  oura: OuraRow[]
  moods: MoodRow[]
  weather: WeatherRow[]
  trades: TradeRow[]
  bets: BetRow[]
}

// ── Mini Sparkline (SVG) ──────────────────────────────────────────────────────

function Sparkline({ values, color = '#d4af37' }: { values: number[]; color?: string }) {
  if (values.length < 2) {
    return <span className="text-xs text-[var(--color-text-disabled)]">—</span>
  }
  const w = 80
  const h = 24
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - min) / range) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── Signal Status ─────────────────────────────────────────────────────────────

type Status = 'good' | 'ok' | 'warn' | 'empty'

function StatusDot({ status }: { status: Status }) {
  const map: Record<Status, string> = {
    good: 'bg-green-400',
    ok: 'bg-yellow-400',
    warn: 'bg-red-400',
    empty: 'bg-[var(--color-text-disabled)]',
  }
  return <span className={`inline-block h-2 w-2 rounded-full ${map[status]}`} />
}

// ── Signal Card ───────────────────────────────────────────────────────────────

interface SignalCardProps {
  label: string
  value: string
  sub?: string
  status: Status
  sparkValues?: number[]
  sparkColor?: string
  lastUpdated?: string
}

function SignalCard({
  label,
  value,
  sub,
  status,
  sparkValues,
  sparkColor,
  lastUpdated,
}: SignalCardProps) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-cockpit-surface)] px-4 py-3">
      <StatusDot status={status} />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
        <p className="text-lg font-bold text-[var(--color-text-primary)]">{value}</p>
        {sub && <p className="text-xs text-[var(--color-text-disabled)]">{sub}</p>}
        {lastUpdated && status === 'empty' && (
          <p className="text-xs text-[var(--color-text-disabled)]">No data (7d)</p>
        )}
      </div>
      {sparkValues && sparkValues.length >= 2 && (
        <Sparkline values={sparkValues} color={sparkColor} />
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function last<T>(arr: T[]): T | null {
  return arr.length > 0 ? arr[arr.length - 1] : null
}

function pnlStatus(pnl: number): Status {
  if (pnl > 0) return 'good'
  if (pnl === 0) return 'ok'
  return 'warn'
}

function scoreStatus(score: number, good: number, ok: number): Status {
  if (score >= good) return 'good'
  if (score >= ok) return 'ok'
  return 'warn'
}

function fmtPnl(v: number) {
  return `${v >= 0 ? '+' : ''}$${v.toFixed(2)}`
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function SignalsPage({ oura, moods, weather, trades, bets }: Props) {
  // ── Oura signals ──────────────────────────────────────────────────────────
  const latestOura = last(oura)
  const sleepSignal: SignalCardProps =
    latestOura?.sleep_score != null
      ? {
          label: 'Sleep Score',
          value: `${latestOura.sleep_score}`,
          sub: `${latestOura.date} · Readiness ${latestOura.readiness_score ?? '—'}`,
          status: scoreStatus(latestOura.sleep_score, 80, 65),
          sparkValues: oura.map((r) => r.sleep_score ?? 0).filter(Boolean),
          sparkColor:
            latestOura.sleep_score >= 80
              ? '#4ade80'
              : latestOura.sleep_score >= 65
                ? '#facc15'
                : '#f87171',
        }
      : { label: 'Sleep Score', value: '—', status: 'empty', lastUpdated: '' }

  const hrvSignal: SignalCardProps =
    latestOura?.hrv != null
      ? {
          label: 'HRV',
          value: `${latestOura.hrv.toFixed(0)} ms`,
          sub: `Resting HR: ${latestOura.resting_hr ?? '—'} bpm`,
          status: scoreStatus(latestOura.hrv, 60, 40),
          sparkValues: oura.map((r) => r.hrv ?? 0).filter(Boolean),
          sparkColor: '#d4af37',
        }
      : { label: 'HRV', value: '—', status: 'empty', lastUpdated: '' }

  const stepsSignal: SignalCardProps =
    latestOura?.steps != null
      ? {
          label: 'Steps',
          value: latestOura.steps.toLocaleString(),
          sub: `Activity ${latestOura.activity_score ?? '—'}/100`,
          status: scoreStatus(latestOura.steps, 8000, 5000),
          sparkValues: oura.map((r) => r.steps ?? 0).filter(Boolean),
          sparkColor: '#60a5fa',
        }
      : { label: 'Steps', value: '—', status: 'empty', lastUpdated: '' }

  // ── Mood signal ───────────────────────────────────────────────────────────
  const latestMood = last(moods)
  const moodSignal: SignalCardProps =
    latestMood?.energy != null
      ? {
          label: 'Energy / Focus',
          value: `${latestMood.energy}/10`,
          sub: `Focus: ${latestMood.focus ?? '—'}/10`,
          status: scoreStatus(latestMood.energy, 7, 5),
          sparkValues: moods.map((m) => m.energy ?? 0).filter(Boolean),
          sparkColor: '#a78bfa',
        }
      : { label: 'Energy / Focus', value: '—', status: 'empty', lastUpdated: '' }

  // ── Weather signal ────────────────────────────────────────────────────────
  const latestWeather = last(weather)
  const weatherSignal: SignalCardProps =
    latestWeather?.temp_c != null
      ? {
          label: 'Weather (YEG)',
          value: `${latestWeather.temp_c.toFixed(0)}°C`,
          sub: `${latestWeather.condition ?? ''} · Feels ${latestWeather.feels_like_c?.toFixed(0) ?? '—'}°`,
          status: 'ok',
          sparkValues: weather.map((w) => w.temp_c ?? 0),
          sparkColor: '#fb923c',
        }
      : { label: 'Weather (YEG)', value: '—', status: 'empty', lastUpdated: '' }

  // ── Trading P&L signal ────────────────────────────────────────────────────
  const tradePnl7d = trades.reduce((sum, t) => sum + (t.dollar_pnl ?? 0), 0)
  const tradeCount = trades.length
  const tradeDays = Array.from(new Set(trades.map((t) => t.trade_date))).sort()
  const tradePnlByDay = tradeDays.map((d) =>
    trades.filter((t) => t.trade_date === d).reduce((sum, t) => sum + (t.dollar_pnl ?? 0), 0)
  )
  const tradingSignal: SignalCardProps =
    tradeCount > 0
      ? {
          label: 'Trading P&L (7d)',
          value: fmtPnl(tradePnl7d),
          sub: `${tradeCount} trade${tradeCount !== 1 ? 's' : ''} · live + paper`,
          status: pnlStatus(tradePnl7d),
          sparkValues: tradePnlByDay,
          sparkColor: tradePnl7d >= 0 ? '#4ade80' : '#f87171',
        }
      : { label: 'Trading P&L (7d)', value: '—', status: 'empty', lastUpdated: '' }

  // ── Betting P&L signal ────────────────────────────────────────────────────
  const betPnl7d = bets.reduce((sum, b) => sum + (b.pnl ?? 0), 0)
  const betCount = bets.length
  const betDays = Array.from(new Set(bets.map((b) => b.bet_date))).sort()
  const betPnlByDay = betDays.map((d) =>
    bets.filter((b) => b.bet_date === d).reduce((sum, b) => sum + (b.pnl ?? 0), 0)
  )
  const bettingSignal: SignalCardProps =
    betCount > 0
      ? {
          label: 'Betting P&L (7d)',
          value: fmtPnl(betPnl7d),
          sub: `${betCount} bet${betCount !== 1 ? 's' : ''}`,
          status: pnlStatus(betPnl7d),
          sparkValues: betPnlByDay,
          sparkColor: betPnl7d >= 0 ? '#4ade80' : '#f87171',
        }
      : { label: 'Betting P&L (7d)', value: '—', status: 'empty', lastUpdated: '' }

  const allSignals: SignalCardProps[] = [
    sleepSignal,
    hrvSignal,
    stepsSignal,
    moodSignal,
    weatherSignal,
    tradingSignal,
    bettingSignal,
  ]

  const liveCount = allSignals.filter((s) => s.status !== 'empty').length
  const goodCount = allSignals.filter((s) => s.status === 'good').length

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Life Signals</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            {liveCount} active signal{liveCount !== 1 ? 's' : ''} · {goodCount} green
          </p>
        </div>
        <p className="text-xs text-[var(--color-text-disabled)]">Rolling 7 days</p>
      </div>

      <div className="space-y-2">
        {allSignals.map((signal) => (
          <SignalCard key={signal.label} {...signal} />
        ))}
      </div>
    </div>
  )
}
