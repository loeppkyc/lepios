/**
 * Autonomous Agent Health Dashboard — Step 4 scoring dashboard.
 *
 * Server component. Fetches all metric data in parallel, renders inline SVG
 * charts (no chart library dependency). Logs a dashboard.view event on load
 * (fire-and-forget — does not block render).
 */

import QualityTrends from './_components/QualityTrends'
import { logEvent } from '@/lib/knowledge/client'
import { healthCheck, type OllamaHealthResult } from '@/lib/ollama/client'
import {
  getDailySuccessRate,
  getSafetyFlagTrend,
  getTopErrorTypes,
  getKnowledgeHealth,
  getAutonomousRunSummary,
  type DailySuccessRate,
  type DailyFlagCount,
  type ErrorTypeSummary,
} from '@/lib/metrics/rollups'

export const dynamic = 'force-dynamic'

// ── Inline SVG chart primitives ───────────────────────────────────────────────

function LineChart({
  data,
  width = 480,
  height = 72,
}: {
  data: DailySuccessRate[]
  width?: number
  height?: number
}) {
  if (!data.length) return <EmptyChart width={width} height={height} label="no data yet" />

  const padT = 6
  const padB = 6
  const chartH = height - padT - padB
  const n = data.length

  const points = data.map((d, i) => ({
    x: n > 1 ? (i / (n - 1)) * width : width / 2,
    y: padT + (1 - d.rate / 100) * chartH,
    rate: d.rate,
    day: d.day,
  }))

  const polyPts = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaPath = [
    `M${points[0].x.toFixed(1)},${height}`,
    ...points.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    `L${points[n - 1].x.toFixed(1)},${height}`,
    'Z',
  ].join(' ')

  const latest = points[n - 1]

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label="Daily success rate line chart"
    >
      {/* 50% reference line */}
      <line
        x1={0}
        y1={padT + chartH * 0.5}
        x2={width}
        y2={padT + chartH * 0.5}
        stroke="var(--color-border)"
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      {/* Area fill */}
      <path d={areaPath} fill="var(--color-positive)" fillOpacity={0.12} />
      {/* Line */}
      <polyline
        points={polyPts}
        fill="none"
        stroke="var(--color-positive)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Latest point dot */}
      <circle cx={latest.x} cy={latest.y} r={3} fill="var(--color-positive)" />
    </svg>
  )
}

function HBarChart({ data, width = 400 }: { data: ErrorTypeSummary[]; width?: number }) {
  if (!data.length) return <EmptyChart width={width} height={32} label="no errors" />

  const barH = 16
  const gap = 8
  const labelW = 150
  const countW = 30
  const barMaxW = width - labelW - countW - 8
  const maxCount = Math.max(...data.map((d) => d.count), 1)
  const totalH = data.length * (barH + gap) - gap

  return (
    <svg
      width={width}
      height={totalH}
      viewBox={`0 0 ${width} ${totalH}`}
      aria-label="Top error types bar chart"
    >
      {data.map((d, i) => {
        const y = i * (barH + gap)
        const barW = Math.max((d.count / maxCount) * barMaxW, 2)
        const label = d.error_type.length > 22 ? d.error_type.slice(0, 21) + '…' : d.error_type
        return (
          <g key={d.error_type}>
            <text
              x={0}
              y={y + barH * 0.72}
              fill="var(--color-text-muted)"
              fontSize={11}
              fontFamily="var(--font-mono)"
            >
              {label}
            </text>
            <rect
              x={labelW}
              y={y + 1}
              width={barW}
              height={barH - 2}
              fill="var(--color-critical)"
              fillOpacity={0.75}
              rx={2}
            />
            <text
              x={labelW + barW + 6}
              y={y + barH * 0.72}
              fill="var(--color-text-secondary)"
              fontSize={11}
              fontFamily="var(--font-mono)"
              fontWeight={600}
            >
              {d.count}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function StackedBarChart({
  data,
  width,
  height = 64,
}: {
  data: DailyFlagCount[]
  width?: number
  height?: number
}) {
  if (!data.length)
    return <EmptyChart width={width ?? 480} height={height} label="no safety checks yet" />

  const n = data.length
  const resolvedWidth = width ?? Math.min(n * 20, 480)
  const barW = Math.max(Math.floor((resolvedWidth / n) * 0.75), 4)
  const gap = Math.max(Math.floor(resolvedWidth / n) - barW, 1)
  const maxTotal = Math.max(...data.map((d) => d.total), 1)

  const SEV_COLORS: Record<string, string> = {
    critical: 'var(--color-critical)',
    high: 'var(--color-warning)',
    medium: 'var(--color-info)',
    low: 'var(--color-text-disabled)',
  }
  const SEV_KEYS = ['critical', 'high', 'medium', 'low'] as const

  return (
    <svg
      width={resolvedWidth}
      height={height}
      viewBox={`0 0 ${resolvedWidth} ${height}`}
      aria-label="Safety flags stacked bar chart by severity"
    >
      {data.map((d, i) => {
        const x = i * (barW + gap)
        let yOffset = height
        return (
          <g key={d.day}>
            {SEV_KEYS.map((sev) => {
              const h = maxTotal > 0 ? Math.round((d[sev] / maxTotal) * height) : 0
              if (h === 0) return null
              yOffset -= h
              return (
                <rect
                  key={sev}
                  x={x}
                  y={yOffset}
                  width={barW}
                  height={h}
                  fill={SEV_COLORS[sev]}
                  fillOpacity={0.85}
                />
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}

function EmptyChart({ width, height, label }: { width: number; height: number; label: string }) {
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <text
        x={width / 2}
        y={height / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="var(--color-text-disabled)"
        fontSize={11}
        fontFamily="var(--font-ui)"
        letterSpacing="0.06em"
      >
        {label}
      </text>
    </svg>
  )
}

// ── Ollama status card ────────────────────────────────────────────────────────

function OllamaStatusCard({ health }: { health: OllamaHealthResult }) {
  const color = health.reachable ? 'var(--color-positive)' : 'var(--color-critical)'
  const label = health.reachable ? 'ONLINE' : 'OFFLINE'
  const sub = health.reachable
    ? `${health.latency_ms}ms · ${health.models.length} model(s)${health.tunnel_used ? ' · tunnel' : ' · local'}`
    : health.tunnel_used
      ? 'tunnel unreachable'
      : 'localhost:11434 unreachable'

  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        border: `1px solid ${color}`,
        borderRadius: 'var(--radius-md)',
        padding: '14px 18px',
        flex: 1,
        minWidth: 160,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--color-text-disabled)',
          marginBottom: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {/* Status light */}
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: color,
            boxShadow: health.reachable ? `0 0 6px ${color}` : 'none',
            flexShrink: 0,
          }}
        />
        Ollama
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.6rem',
          fontWeight: 700,
          color,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          color: 'var(--color-text-disabled)',
          marginTop: 4,
        }}
      >
        {sub}
      </div>
    </div>
  )
}

// ── Scorecard tile ────────────────────────────────────────────────────────────

function ScoreTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: string
}) {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '14px 18px',
        flex: 1,
        minWidth: 120,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--color-text-disabled)',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.6rem',
          fontWeight: 700,
          color: accent ?? 'var(--color-text-primary)',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
            marginTop: 4,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  )
}

// ── Chart section wrapper ─────────────────────────────────────────────────────

function ChartSection({
  title,
  sub,
  children,
}: {
  title: string
  sub: string
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '16px 20px',
        marginBottom: 16,
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            fontWeight: 600,
            color: 'var(--color-text-secondary)',
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
            marginLeft: 8,
          }}
        >
          {sub}
        </span>
      </div>
      {children}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function AutonomousPage() {
  // Fire-and-forget dashboard view log — does not block render
  void logEvent('system', 'dashboard.view', {
    actor: 'colin',
    status: 'success',
    outputSummary: 'autonomous dashboard viewed',
  })

  const [summary7, rates30, flagTrend14, topErrors7, knowledge, ollama] = await Promise.all([
    getAutonomousRunSummary(7),
    getDailySuccessRate(30),
    getSafetyFlagTrend(14),
    getTopErrorTypes(7, 6),
    getKnowledgeHealth(),
    healthCheck(),
  ])

  // 7-day average from the rates data
  const last7Rates = rates30.slice(-7)
  const avg7 =
    last7Rates.length > 0
      ? Math.round(last7Rates.reduce((s, r) => s + r.rate, 0) / last7Rates.length)
      : 0

  const todayKey = new Date().toISOString().slice(0, 10)
  const todayRate = rates30.find((r) => r.day === todayKey)?.rate ?? null

  const blockingFlags = flagTrend14
    .filter((d) => d.day === todayKey)
    .reduce((s, d) => s + d.critical, 0)

  const rateColor = (r: number) =>
    r >= 90 ? 'var(--color-positive)' : r >= 70 ? 'var(--color-warning)' : 'var(--color-critical)'

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--color-base)',
        padding: '24px',
        maxWidth: 900,
        margin: '0 auto',
      }}
    >
      {/* Rail */}
      <div
        style={{
          height: 2,
          backgroundColor: 'var(--color-rail)',
          boxShadow: '0 0 12px var(--color-rail-glow)',
          marginBottom: 24,
        }}
      />

      <QualityTrends />

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-heading)',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            margin: 0,
          }}
        >
          Autonomous Agent Health
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
            margin: '4px 0 0',
          }}
        >
          {summary7.totalEvents} events in last 7 days &middot; last updated{' '}
          {new Date().toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>

      {/* Scorecard */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        <ScoreTile
          label="Today success rate"
          value={todayRate !== null ? `${todayRate}%` : '—'}
          sub={`7-day avg: ${avg7}%`}
          accent={todayRate !== null ? rateColor(todayRate) : undefined}
        />
        <ScoreTile
          label="7-day success rate"
          value={`${summary7.successRate}%`}
          sub={`${summary7.totalEvents} total events`}
          accent={rateColor(summary7.successRate)}
        />
        <ScoreTile
          label="Blocking safety flags"
          value={blockingFlags === 0 ? '0' : String(blockingFlags)}
          sub={`${summary7.safetyFlagsTotal} total flags (7d)`}
          accent={blockingFlags > 0 ? 'var(--color-critical)' : 'var(--color-positive)'}
        />
        <ScoreTile
          label="Knowledge entries"
          value={String(knowledge.total)}
          sub={`avg conf ${knowledge.avgConfidence.toFixed(2)} · ${knowledge.usedLast7Days} used (7d)`}
        />
        <OllamaStatusCard health={ollama} />
      </div>

      {/* Chart 1: Daily success rate */}
      <ChartSection title="Daily success rate" sub="last 30 days">
        <LineChart data={rates30} width={840} height={80} />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 4,
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
          }}
        >
          <span>{rates30[0]?.day ?? ''}</span>
          <span>100%</span>
          <span>{rates30[rates30.length - 1]?.day ?? ''}</span>
        </div>
      </ChartSection>

      {/* Chart 2: Top error types */}
      <ChartSection title="Top error types" sub="last 7 days">
        {topErrors7.length === 0 ? (
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-positive)',
            }}
          >
            No errors in the last 7 days
          </span>
        ) : (
          <HBarChart data={topErrors7} width={720} />
        )}
      </ChartSection>

      {/* Chart 3: Safety flags stacked bar */}
      <ChartSection title="Safety flags by severity" sub="last 14 days">
        <StackedBarChart data={flagTrend14} width={840} height={64} />
        <div
          style={{
            display: 'flex',
            gap: 16,
            marginTop: 8,
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
          }}
        >
          {(
            [
              { label: 'Critical', color: 'var(--color-critical)' },
              { label: 'High', color: 'var(--color-warning)' },
              { label: 'Medium', color: 'var(--color-info)' },
              { label: 'Low', color: 'var(--color-text-disabled)' },
            ] as const
          ).map(({ label, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  backgroundColor: color,
                  flexShrink: 0,
                }}
              />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </ChartSection>

      {/* Summary row */}
      <div
        style={{
          display: 'flex',
          gap: 24,
          padding: '12px 16px',
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-muted)',
          flexWrap: 'wrap',
        }}
      >
        <span>
          error rate:{' '}
          <strong
            style={{
              color:
                summary7.errorRate > 10 ? 'var(--color-critical)' : 'var(--color-text-secondary)',
            }}
          >
            {summary7.errorRate}%
          </strong>
        </span>
        {summary7.avgDurationMs != null && (
          <span>
            avg duration: <strong>{summary7.avgDurationMs}ms</strong>
          </span>
        )}
        {summary7.totalTokensUsed > 0 && (
          <span>
            tokens used (7d): <strong>{summary7.totalTokensUsed.toLocaleString()}</strong>
          </span>
        )}
        <span>
          knowledge conf: <strong>{knowledge.avgConfidence.toFixed(2)}</strong>
        </span>
        {knowledge.decayedCount > 0 && (
          <span style={{ color: 'var(--color-warning)' }}>
            {knowledge.decayedCount} decayed entries
          </span>
        )}
      </div>
    </div>
  )
}
