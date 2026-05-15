/**
 * Money Pillar — live P&L wiring (cockpit-money-pnl-wiring)
 *
 * Inline primitives (ArcGauge, PillBar, StatusLight, Sparkline) are flagged
 * for extraction into components/cockpit/ in a future sprint.
 *
 * Data: amazon_settlements + business_expenses (live current-month queries).
 * Arc gauge = net profit margin; Amazon + Expenses PillBars live.
 * 6-month amazon_net sparkline below PillBars.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { BettingTileClient } from './_components/BettingTileClient'

export const dynamic = 'force-dynamic'

// ── Sprint 4: extract to components/cockpit/ArcGauge.tsx ─────────────────────
function arcPath(pct: number, cx: number, cy: number, r: number) {
  const START_CW = 200  // degrees clockwise from 12 o'clock
  const SWEEP = 200

  const toXY = (deg: number) => ({
    x: +(cx + r * Math.sin((deg * Math.PI) / 180)).toFixed(2),
    y: +(cy - r * Math.cos((deg * Math.PI) / 180)).toFixed(2),
  })

  const s = toXY(START_CW)
  const e = toXY(START_CW + SWEEP)
  const fe = toXY(START_CW + pct * SWEEP)
  const fillSweep = pct * SWEEP

  return {
    bg: `M ${s.x} ${s.y} A ${r} ${r} 0 1 1 ${e.x} ${e.y}`,
    fill: pct > 0.001
      ? `M ${s.x} ${s.y} A ${r} ${r} 0 ${fillSweep > 180 ? 1 : 0} 1 ${fe.x} ${fe.y}`
      : '',
  }
}

function fillColor(pct: number): string {
  if (pct < 0.3) return 'var(--color-critical)'
  if (pct < 0.7) return 'var(--color-warning)'
  return 'var(--color-positive)'
}

// Sprint 4: extract to components/cockpit/ArcGauge.tsx
function ArcGauge({
  value, label, size = 120,
}: { value: number; label: string; size?: number }) {
  const cx = size / 2, cy = size / 2 + 5, r = size * 0.38
  const pct = Math.max(0, Math.min(1, value / 100))
  const paths = arcPath(pct, cx, cy, r)
  const color = fillColor(pct)

  return (
    <div style={{ width: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`${label}: ${value}%`}>
        <path d={paths.bg} fill="none" stroke="var(--color-surface-2)" strokeWidth={4} strokeLinecap="round" />
        {paths.fill && (
          <path d={paths.fill} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round"
            style={{ transition: 'var(--transition-fast)' }} />
        )}
        <text x={cx} y={cy + 2} textAnchor="middle" dominantBaseline="middle"
          fill={color}
          style={{ fontFamily: 'var(--font-mono)', fontSize: size * 0.18, fontWeight: 700 }}>
          {value}
        </text>
        <text x={cx} y={cy + size * 0.19} textAnchor="middle"
          fill="var(--color-text-muted)"
          style={{ fontFamily: 'var(--font-ui)', fontSize: size * 0.1, fontWeight: 600,
            letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {label}
        </text>
      </svg>
    </div>
  )
}

// Sprint 4: extract to components/cockpit/PillBar.tsx
function PillBar({
  label, value, max, unit = '', color = 'var(--color-pillar-money)', height = 10,
}: {
  label: string; value: number; max: number; unit?: string
  color?: string; height?: number
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
      <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)',
        fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: 'var(--color-text-muted)', width: 80, flexShrink: 0 }}>
        {label}
      </span>
      <div style={{ flex: 1, backgroundColor: 'var(--color-surface-2)',
        borderRadius: 'var(--radius-pill)', height, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: color,
          borderRadius: 'var(--radius-pill)',
          transition: 'var(--transition-fast)' }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)',
        color: 'var(--color-text-secondary)', width: 64, textAlign: 'right',
        flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        {value > 0 ? `+` : ''}{value}{unit}
      </span>
    </div>
  )
}

// Sprint 4: extract to components/cockpit/StatusLight.tsx
function StatusLight({ status, label }: { status: 'ok' | 'warn' | 'error' | 'info'; label: string }) {
  const colors = { ok: 'var(--color-positive)', warn: 'var(--color-warning)',
    error: 'var(--color-critical)', info: 'var(--color-info)' }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 10, height: 10, borderRadius: '50%',
        backgroundColor: colors[status], opacity: 0.9, flexShrink: 0 }} />
      <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)',
        fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: 'var(--color-text-muted)' }}>
        {label}
      </span>
    </div>
  )
}

// Sprint 4: extract to components/cockpit/Sparkline.tsx
function MoneySparkline({ data }: { data: { month: string; amazon_net: number }[] }) {
  const W = 600
  const H = 40
  const padV = 4
  const chartH = H - padV * 2
  const n = data.length

  if (n === 0) {
    return (
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} aria-label="no trend data">
        <text x={W / 2} y={H / 2} textAnchor="middle" dominantBaseline="middle"
          fill="var(--color-text-disabled)" fontSize={9} fontFamily="var(--font-ui)">
          no trend data
        </text>
      </svg>
    )
  }

  const maxVal = Math.max(...data.map((d) => d.amazon_net), 1)
  const xFor = (i: number) => ((n > 1 ? i / (n - 1) : 0.5) * W).toFixed(1)
  const yFor = (v: number) => (padV + (1 - v / maxVal) * chartH).toFixed(1)

  const parts: string[] = data.map((d, i) =>
    `${i === 0 ? 'M' : 'L'}${xFor(i)},${yFor(d.amazon_net)}`
  )
  const lastIdx = data.length - 1
  const lastVal = data[lastIdx].amazon_net

  // Month labels: abbreviated month name from ISO date string
  const monthAbbrev = (iso: string) => {
    const d = new Date(iso + 'T12:00:00Z')
    return d.toLocaleString('en-CA', { month: 'short', timeZone: 'UTC' })
  }

  return (
    <div style={{ width: '100%' }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        aria-label="6-month Amazon net trend">
        <line x1={0} y1={padV + chartH * 0.5} x2={W} y2={padV + chartH * 0.5}
          stroke="var(--color-border)" strokeWidth={1} strokeDasharray="3 3" />
        <path d={parts.join(' ')} fill="none"
          stroke="var(--color-pillar-money)" strokeWidth={1.5}
          strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={xFor(lastIdx)} cy={yFor(lastVal)} r={3}
          fill="var(--color-pillar-money)" />
      </svg>
      {/* Month labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between',
        marginTop: 2, paddingBottom: 2 }}>
        {data.map((d) => (
          <span key={d.month} style={{ fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)',
            letterSpacing: '0.04em', textAlign: 'center', flex: 1 }}>
            {monthAbbrev(d.month)}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function MoneyPage() {
  const supabase = createServiceClient()

  // ── Bets query ────────────────────────────────────────────────────────────
  // SPRINT5-GATE: person_handle filter is hardcoded; see ARCHITECTURE.md §7.3
  const { data: bets } = await supabase
    .from('bets')
    .select(
      'id, bet_date, sport, league, bet_on, bet_type, odds, stake, result, pnl, bankroll_before, kelly_pct, book',
    )
    .eq('person_handle', 'colin')
    .order('bet_date', { ascending: false })
    .limit(80)

  const allBets = bets ?? []
  const pending = allBets.filter((b) => b.result === 'pending')
  const completed30 = allBets
    .filter((b) => ['win', 'loss', 'push'].includes(b.result))
    .slice(0, 30)
  const settledCount = allBets.filter((b) => ['win', 'loss', 'push'].includes(b.result)).length
  const wins = allBets.filter((b) => b.result === 'win').length
  const losses = allBets.filter((b) => b.result === 'loss').length
  const totalPnl = allBets.reduce((s, b) => s + (b.pnl ?? 0), 0)
  const rolling30Pnl = completed30.reduce((s, b) => s + (b.pnl ?? 0), 0)

  const { data: deals, error } = await supabase
    .from('deals')
    .select('id, asin, title, product_type, source, sell_price_cad, roi_pct, sales_rank, status, found_date')
    .eq('status', 'found')
    .order('found_date', { ascending: false })
    .order('roi_pct', { ascending: false })
    .limit(50)

  const dealCount = deals?.length ?? 0
  const topRoi = deals?.[0]?.roi_pct ?? 0
  const avgRoi = dealCount > 0
    ? Math.round(deals!.reduce((s, d) => s + (d.roi_pct ?? 0), 0) / dealCount)
    : 0

  // ── Amazon income — current calendar month ────────────────────────────────
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()

  const { data: amazonData, error: amazonError } = await supabase
    .from('amazon_settlements')
    .select('net_payout')
    .gte('period_end_at', monthStart)
    .lt('period_end_at', nextMonthStart)

  const amazonNet = (amazonData ?? []).reduce((s, r) => s + (Number(r.net_payout) || 0), 0)

  // ── Business expenses — current calendar month ────────────────────────────
  const monthStartDate = monthStart.slice(0, 10)
  const nextMonthStartDate = nextMonthStart.slice(0, 10)

  const { data: expenseData, error: expenseError } = await supabase
    .from('business_expenses')
    .select('pretax, business_use_pct')
    .gte('date', monthStartDate)
    .lt('date', nextMonthStartDate)

  const expensesCad = (expenseData ?? []).reduce(
    (s, r) => s + (Number(r.pretax) || 0) * (Number(r.business_use_pct) || 100) / 100,
    0
  )

  // ── 6-month trend data ────────────────────────────────────────────────────
  const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)).toISOString()

  const { data: trendRaw } = await supabase
    .from('amazon_settlements')
    .select('net_payout, period_end_at')
    .gte('period_end_at', sixMonthsAgo)
    .order('period_end_at', { ascending: true })

  // Group by month (YYYY-MM) — aggregate net_payout per calendar month
  const trendMap = new Map<string, number>()
  for (const row of trendRaw ?? []) {
    const d = new Date(row.period_end_at)
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
    trendMap.set(key, (trendMap.get(key) ?? 0) + (Number(row.net_payout) || 0))
  }
  const trendData = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amazon_net]) => ({ month, amazon_net }))

  // ── P&L computed values ───────────────────────────────────────────────────
  // Colin-approved formula (Telegram 2026-05-15T14:40:07Z): net profit margin
  // TODO: tune with real data — net margin may evolve to goal attainment vs monthly target
  const pnlGaugePct = amazonNet > 0
    ? Math.round(Math.max(0, Math.min(100, ((amazonNet - expensesCad) / amazonNet) * 100)))
    : 0

  const netProfit = amazonNet - expensesCad
  const netProfitDisplay = netProfit >= 0
    ? `+$${Math.round(netProfit).toLocaleString('en-CA')}`
    : `-$${Math.round(Math.abs(netProfit)).toLocaleString('en-CA')}`

  const currentMonthName = now.toLocaleString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  // Kill signal: if settlement query errors, surface it rather than showing $0 silently
  const dataError = amazonError || expenseError

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-base)', padding: '24px' }}>

      {/* ── Cockpit top rail ──────────────────────────────────────────── */}
      <div style={{ height: 2, backgroundColor: 'var(--color-rail)',
        boxShadow: '0 0 12px var(--color-rail-glow)', marginBottom: 24 }} />

      {/* ── Page header ───────────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-heading)',
          fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
          Money
        </h1>
        <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)',
          color: 'var(--color-text-muted)', margin: '4px 0 0', letterSpacing: '0.04em' }}>
          Money pillar — live Amazon settlements + expenses · {currentMonthName}
        </p>
      </div>

      {/* ── Money CockpitRow ──────────────────────────────────────────── */}
      <div className="pillar-rail-money" style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        padding: '16px 20px',
        marginBottom: 16,
      }}>

        {/* Pillar header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 16 }}>
          <span className="label-caps" style={{ color: 'var(--color-pillar-money)' }}>
            Money
          </span>
          <div style={{ display: 'flex', gap: 16 }}>
            <StatusLight status={dealCount > 0 ? 'ok' : 'warn'} label="Amazon feed" />
            <StatusLight status={dataError ? 'error' : 'ok'} label="Supabase" />
          </div>
        </div>

        {/* Gauge + PillBars row */}
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>

          {/* Arc gauge — net profit margin (Colin-approved 2026-05-15) */}
          <ArcGauge value={pnlGaugePct} label="P&L" size={120} />

          {/* Sub-metrics */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Amazon PillBar — max=15000 CAD (Colin-approved 2026-05-15) */}
            <PillBar label="Amazon" value={Math.round(amazonNet)} max={15000} unit=" CAD"
              color="var(--color-pillar-money)" />
            <PillBar label="Trading" value={0} max={2000} unit=" CAD"
              color="var(--color-pillar-money)" height={6} />
            <PillBar label="Betting" value={Math.round(rolling30Pnl)} max={1000} unit=" CAD"
              color="var(--color-pillar-money)" height={6} />
            {/* Expenses PillBar — max=5000 CAD (Colin-approved 2026-05-15) */}
            <PillBar label="Expenses" value={Math.round(expensesCad)} max={5000} unit=" CAD"
              color="var(--color-critical)" height={6} />

            {/* 6-month Amazon net trend sparkline (Colin-approved 2026-05-15) */}
            {trendData.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)',
                  color: 'var(--color-text-disabled)', letterSpacing: '0.06em',
                  textTransform: 'uppercase', marginBottom: 2 }}>
                  6-mo Amazon net
                </div>
                <MoneySparkline data={trendData} />
              </div>
            )}
          </div>

          {/* Summary readout — net profit for current month */}
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-pillar-value)',
              fontWeight: 700,
              color: netProfit >= 0 ? 'var(--color-positive)' : 'var(--color-critical)',
              fontVariantNumeric: 'tabular-nums' }}>
              {dataError ? '—' : netProfitDisplay}
            </div>
            <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)',
              color: 'var(--color-text-disabled)', letterSpacing: '0.04em' }}>
              {dataError ? 'data error' : 'net profit'}
            </div>
          </div>

        </div>
      </div>

      {/* ── Betting Tile ─────────────────────────────────────────────── */}
      <div style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        overflow: 'hidden',
        marginBottom: 16,
      }}>
        <BettingTileClient
          pending={pending}
          completed30={completed30}
          settledCount={settledCount}
          totalPnl={totalPnl}
          wins={wins}
          losses={losses}
        />
      </div>

      {/* ── Amazon Tile — Deals ───────────────────────────────────────── */}
      <div style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        overflow: 'hidden',
      }}>

        {/* Tile header */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="label-caps">Amazon Deals</span>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            {dealCount > 0 && (
              <>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)',
                  color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  top ROI: <span style={{ color: 'var(--color-positive)' }}>{topRoi?.toFixed(0)}%</span>
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)',
                  color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  avg: <span style={{ color: 'var(--color-warning)' }}>{avgRoi}%</span>
                </span>
              </>
            )}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)',
              color: 'var(--color-text-disabled)' }}>
              {dealCount} deal{dealCount !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Deal rows */}
        {error ? (
          <div style={{ padding: 24, color: 'var(--color-critical)',
            fontFamily: 'var(--font-ui)', fontSize: 'var(--text-body)' }}>
            Supabase error: {error.message}
          </div>
        ) : dealCount === 0 ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-body)',
              color: 'var(--color-text-muted)' }}>
              No deals yet — run deal_scan.py to populate
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)',
              color: 'var(--color-text-disabled)', marginTop: 8 }}>
              python scripts/deal_scan.py --dry-run
            </div>
          </div>
        ) : (
          <div>
            {deals!.map((deal, i) => (
              <div key={deal.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 20px',
                borderBottom: i < deals!.length - 1 ? '1px solid var(--color-border-pillar)' : undefined,
                transition: 'var(--transition-normal)',
              }}>

                {/* Product type badge */}
                <span style={{
                  fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)',
                  fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: deal.product_type === 'lego' ? 'var(--color-pillar-growing)'
                    : deal.product_type === 'book' ? 'var(--color-pillar-happy)'
                    : 'var(--color-pillar-money)',
                  border: '1px solid currentColor', borderRadius: 'var(--radius-sm)',
                  padding: '2px 5px', flexShrink: 0, width: 72, textAlign: 'center',
                }}>
                  {deal.product_type}
                </span>

                {/* Title */}
                <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-body)',
                  color: 'var(--color-text-primary)', flex: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {deal.title ?? deal.asin}
                </span>

                {/* ROI */}
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-body)',
                  fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                  color: (deal.roi_pct ?? 0) >= 50 ? 'var(--color-positive)'
                    : (deal.roi_pct ?? 0) >= 25 ? 'var(--color-warning)'
                    : 'var(--color-text-muted)',
                  width: 56, textAlign: 'right', flexShrink: 0,
                }}>
                  {deal.roi_pct?.toFixed(0) ?? '—'}%
                </span>

                {/* Sell price */}
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-body)',
                  color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums',
                  width: 64, textAlign: 'right', flexShrink: 0 }}>
                  ${deal.sell_price_cad?.toFixed(2) ?? '—'}
                </span>

                {/* Rank */}
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)',
                  color: 'var(--color-text-disabled)', fontVariantNumeric: 'tabular-nums',
                  width: 72, textAlign: 'right', flexShrink: 0 }}>
                  #{deal.sales_rank?.toLocaleString() ?? '—'}
                </span>

              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
