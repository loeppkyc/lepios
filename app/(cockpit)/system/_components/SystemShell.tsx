'use client'

import { useState, useEffect } from 'react'
import { Line, LineChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { GpuStatsResponse, GpuMetrics } from '@/app/api/system/gpu-stats/route'
import type { WindowActivityResponse } from '@/app/api/system/window-activity/route'

// ── Gauge ─────────────────────────────────────────────────────────────────────

function GaugeArc({
  value,
  max,
  color,
  label,
  unit,
  warnAt,
  critAt,
}: {
  value: number | null
  max: number
  color: string
  label: string
  unit: string
  warnAt?: number
  critAt?: number
}) {
  const pct = value != null ? Math.min(value / max, 1) : 0
  const R = 44
  const CX = 56
  const CY = 56
  const SIZE = 112
  // Half-circle arc: from 180° to 0° (left to right)
  const startAngle = Math.PI
  const endAngle = 0
  const sweep = startAngle - endAngle
  const filledAngle = startAngle - sweep * pct
  const toXY = (angle: number) => ({
    x: CX + R * Math.cos(angle),
    y: CY + R * Math.sin(angle),
  })
  const start = toXY(startAngle)
  const end = toXY(endAngle)
  const filled = toXY(filledAngle)
  const largeArc = sweep * pct > Math.PI ? 1 : 0
  const trackPath = `M ${start.x} ${start.y} A ${R} ${R} 0 1 1 ${end.x} ${end.y}`
  const fillPath =
    pct > 0 ? `M ${start.x} ${start.y} A ${R} ${R} 0 ${largeArc} 1 ${filled.x} ${filled.y}` : ''

  const activeColor =
    critAt && value != null && value >= critAt
      ? '#cc3030'
      : warnAt && value != null && value >= warnAt
        ? '#c89b37'
        : color

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minWidth: 100,
      }}
    >
      <svg width={SIZE} height={SIZE * 0.6} viewBox={`0 0 ${SIZE} ${SIZE * 0.6}`}>
        <path d={trackPath} fill="none" stroke="#1e1e30" strokeWidth={10} strokeLinecap="butt" />
        {fillPath && (
          <path
            d={fillPath}
            fill="none"
            stroke={activeColor}
            strokeWidth={10}
            strokeLinecap="butt"
            style={{ transition: 'stroke-dasharray 0.7s ease, stroke 0.4s ease' }}
          />
        )}
        <text
          x={CX}
          y={CY - 4}
          textAnchor="middle"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '1.1rem',
            fontWeight: 700,
            fill: activeColor,
          }}
        >
          {value != null ? value : '—'}
        </text>
        <text
          x={CX}
          y={CY + 12}
          textAnchor="middle"
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '0.6rem',
            fill: 'var(--color-text-muted)',
          }}
        >
          {unit}
        </text>
      </svg>
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: '0.72rem',
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  )
}

// ── Stat pill ─────────────────────────────────────────────────────────────────

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: '#1e1e2e',
        borderRadius: 8,
        padding: '10px 14px',
        minWidth: 110,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: '0.68rem',
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1rem',
          fontWeight: 700,
          color: 'var(--color-text-primary)',
        }}
      >
        {value}
      </div>
    </div>
  )
}

// ── Section header ─────────────────────────────────────────────────────────────

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontWeight: 600,
          fontSize: '1rem',
          color: 'var(--color-text-primary)',
        }}
      >
        {title}
      </div>
      {sub && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '0.72rem',
            color: 'var(--color-text-muted)',
            marginTop: 2,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  )
}

function card(children: React.ReactNode, extraStyle: React.CSSProperties = {}) {
  return (
    <div
      style={{
        background: '#14141e',
        border: '1px solid #2a2a3a',
        borderRadius: 10,
        padding: '20px 24px',
        marginBottom: 20,
        ...extraStyle,
      }}
    >
      {children}
    </div>
  )
}

// ── GPU history charts ────────────────────────────────────────────────────────

const tempChartConfig = {
  temp_c: { label: 'Temp °C', color: '#f0a030' },
} satisfies ChartConfig

const utilChartConfig = {
  gpu_util_pct: { label: 'GPU %', color: '#6b8cff' },
  mem_util_pct: { label: 'VRAM %', color: '#9b59b6' },
} satisfies ChartConfig

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })
}

function GpuHistoryCharts({ history }: { history: GpuStatsResponse['history'] }) {
  if (history.length < 2) return null

  // Downsample to last 60 points max
  const sample = history.length > 60 ? history.slice(history.length - 60) : history

  return (
    <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '0.68rem',
            color: 'var(--color-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 8,
          }}
        >
          Temperature (last 2h)
        </div>
        <ChartContainer config={tempChartConfig} className="h-28 w-full">
          <LineChart data={sample} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.3} />
            <XAxis
              dataKey="time"
              tickFormatter={fmtTime}
              tickLine={false}
              axisLine={false}
              interval={Math.floor(sample.length / 5)}
              tick={{ fontSize: 10, fill: 'var(--color-text-muted)', fontFamily: 'var(--font-ui)' }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={36}
              domain={['auto', 'auto']}
              tick={{ fontSize: 10, fill: 'var(--color-text-muted)', fontFamily: 'var(--font-ui)' }}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line type="monotone" dataKey="temp_c" stroke="#f0a030" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartContainer>
      </div>

      <div>
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '0.68rem',
            color: 'var(--color-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 8,
          }}
        >
          Utilization % (last 2h)
        </div>
        <ChartContainer config={utilChartConfig} className="h-28 w-full">
          <LineChart data={sample} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.3} />
            <XAxis
              dataKey="time"
              tickFormatter={fmtTime}
              tickLine={false}
              axisLine={false}
              interval={Math.floor(sample.length / 5)}
              tick={{ fontSize: 10, fill: 'var(--color-text-muted)', fontFamily: 'var(--font-ui)' }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={36}
              domain={[0, 100]}
              tick={{ fontSize: 10, fill: 'var(--color-text-muted)', fontFamily: 'var(--font-ui)' }}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line
              type="monotone"
              dataKey="gpu_util_pct"
              stroke="#6b8cff"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="mem_util_pct"
              stroke="#9b59b6"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </div>
    </div>
  )
}

// ── Window activity charts ────────────────────────────────────────────────────

const windowChartConfig = {
  sessions_started: { label: 'Sessions', color: '#37c85a' },
  drift_events: { label: 'Drift events', color: '#cc3030' },
} satisfies ChartConfig

function fmtDate(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

function WindowActivityChart({ data }: { data: WindowActivityResponse['drift_by_day'] }) {
  const hasData = data.some((d) => d.sessions_started > 0 || d.drift_events > 0)
  if (!hasData) {
    return (
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: '0.82rem',
          color: 'var(--color-text-muted)',
          padding: '12px 0',
        }}
      >
        No session data for last 7 days. Windows start/end events are written by{' '}
        <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
          window-start.mjs
        </code>{' '}
        /{' '}
        <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>window-end.mjs</code>.
      </div>
    )
  }

  return (
    <ChartContainer config={windowChartConfig} className="h-36 w-full">
      <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.4} />
        <XAxis
          dataKey="date"
          tickFormatter={fmtDate}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: 'var(--color-text-muted)', fontFamily: 'var(--font-ui)' }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={28}
          allowDecimals={false}
          tick={{ fontSize: 10, fill: 'var(--color-text-muted)', fontFamily: 'var(--font-ui)' }}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="sessions_started" fill="#37c85a" radius={[2, 2, 0, 0]} opacity={0.85} />
        <Bar dataKey="drift_events" fill="#cc3030" radius={[2, 2, 0, 0]} opacity={0.85} />
      </BarChart>
    </ChartContainer>
  )
}

// ── Main shell ────────────────────────────────────────────────────────────────

export function SystemShell() {
  const [gpu, setGpu] = useState<GpuStatsResponse | null>(null)
  const [windows, setWindows] = useState<WindowActivityResponse | null>(null)
  const [gpuAge, setGpuAge] = useState<string>('')

  function fetchGpu() {
    fetch('/api/system/gpu-stats')
      .then((r) => r.json())
      .then((d) => setGpu(d as GpuStatsResponse))
      .catch(() => {})
  }

  function fetchWindows() {
    fetch('/api/system/window-activity')
      .then((r) => r.json())
      .then((d) => setWindows(d as WindowActivityResponse))
      .catch(() => {})
  }

  useEffect(() => {
    fetchGpu()
    fetchWindows()
    const gpuInterval = setInterval(fetchGpu, 60_000)
    const winInterval = setInterval(fetchWindows, 30_000)
    return () => {
      clearInterval(gpuInterval)
      clearInterval(winInterval)
    }
  }, [])

  // Update "X min ago" label
  useEffect(() => {
    if (!gpu?.latest_at) return
    const update = () => {
      const mins = Math.round((Date.now() - new Date(gpu.latest_at!).getTime()) / 60_000)
      setGpuAge(mins === 0 ? 'just now' : `${mins}m ago`)
    }
    update()
    const t = setInterval(update, 30_000)
    return () => clearInterval(t)
  }, [gpu?.latest_at])

  const m: GpuMetrics | null = gpu?.latest ?? null
  const noData = !m

  return (
    <div>
      {/* ── GPU Monitor ─────────────────────────────────────── */}
      {card(
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 16,
            }}
          >
            <SectionHeader
              title="GPU Monitor — RTX 3060"
              sub="Updated every minute by local-ai-worker"
            />
            {gpuAge && (
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: '0.7rem',
                  color: 'var(--color-text-muted)',
                }}
              >
                last reading: {gpuAge}
              </div>
            )}
          </div>

          {noData ? (
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.85rem',
                color: 'var(--color-text-muted)',
                padding: '12px 0',
              }}
            >
              No GPU data yet. Start local-ai-worker to begin polling:
              <br />
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
                node scripts/local-ai-worker.mjs
              </code>
            </div>
          ) : (
            <>
              {/* Gauges row */}
              <div
                style={{
                  display: 'flex',
                  gap: 24,
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  marginBottom: 20,
                }}
              >
                <GaugeArc
                  value={m?.temp_c ?? null}
                  max={100}
                  color="#f0a030"
                  label="Temp"
                  unit="°C"
                  warnAt={75}
                  critAt={85}
                />
                <GaugeArc
                  value={m?.gpu_util_pct ?? null}
                  max={100}
                  color="#6b8cff"
                  label="GPU"
                  unit="%"
                />
                <GaugeArc
                  value={
                    m?.mem_used_mb != null && m?.mem_total_mb != null
                      ? Math.round((m.mem_used_mb / m.mem_total_mb) * 100)
                      : null
                  }
                  max={100}
                  color="#9b59b6"
                  label="VRAM"
                  unit="%"
                  warnAt={90}
                />
                <GaugeArc
                  value={m?.fan_speed_pct ?? null}
                  max={100}
                  color="#37c8c8"
                  label="Fan"
                  unit="%"
                />
                <GaugeArc
                  value={m?.power_draw_w != null ? Math.round(m.power_draw_w) : null}
                  max={m?.power_limit_w ?? 170}
                  color="#f08c30"
                  label="Power"
                  unit="W"
                  warnAt={Math.round((m?.power_limit_w ?? 170) * 0.9)}
                />
              </div>

              {/* Stat pills */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                <StatPill
                  label="VRAM used"
                  value={m?.mem_used_mb != null ? `${m.mem_used_mb} / ${m.mem_total_mb} MB` : '—'}
                />
                <StatPill
                  label="GPU clock"
                  value={m?.clock_graphics_mhz != null ? `${m.clock_graphics_mhz} MHz` : '—'}
                />
                <StatPill
                  label="Mem clock"
                  value={m?.clock_memory_mhz != null ? `${m.clock_memory_mhz} MHz` : '—'}
                />
                <StatPill
                  label="Power"
                  value={
                    m?.power_draw_w != null
                      ? `${m.power_draw_w.toFixed(1)} / ${m.power_limit_w} W`
                      : '—'
                  }
                />
              </div>

              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: '0.7rem',
                  color: 'var(--color-text-muted)',
                  marginTop: 10,
                  padding: '8px 12px',
                  background: '#1a1a28',
                  borderRadius: 6,
                  border: '1px solid #2a2a3a',
                }}
              >
                Fan control requires MSI Afterburner — this page shows live readings only. Fans stop
                automatically below ~50°C (0 RPM mode is normal at idle).
              </div>
            </>
          )}

          {gpu?.history && <GpuHistoryCharts history={gpu.history} />}
        </>
      )}

      {/* ── Window Activity ──────────────────────────────────── */}
      {card(
        <>
          <SectionHeader
            title="Window Activity"
            sub="Active Claude Code windows + scope drift events (last 7 days)"
          />

          {/* Active sessions */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.68rem',
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 8,
              }}
            >
              Active now
            </div>
            {windows?.active_sessions.length === 0 || !windows ? (
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: '0.82rem',
                  color: 'var(--color-text-muted)',
                }}
              >
                No active windows
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {windows.active_sessions.map((s) => (
                  <div
                    key={s.session_id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      background: '#1e1e2e',
                      borderRadius: 6,
                    }}
                  >
                    <div>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.78rem',
                          color: 'var(--color-text-primary)',
                        }}
                      >
                        {s.session_id}
                      </span>
                      {s.current_task && (
                        <span
                          style={{
                            fontFamily: 'var(--font-ui)',
                            fontSize: '0.72rem',
                            color: 'var(--color-text-muted)',
                            marginLeft: 10,
                          }}
                        >
                          {s.current_task}
                        </span>
                      )}
                    </div>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 8,
                        background: '#1a4a2044',
                        color: '#37c85a',
                        border: '1px solid #37c85a44',
                        fontSize: '0.7rem',
                        fontFamily: 'var(--font-ui)',
                      }}
                    >
                      active
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 7-day chart */}
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: '0.68rem',
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 8,
            }}
          >
            Sessions started &amp; drift events — last 7 days
          </div>
          {windows ? (
            <WindowActivityChart data={windows.drift_by_day} />
          ) : (
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.82rem',
                color: 'var(--color-text-muted)',
              }}
            >
              Loading…
            </div>
          )}

          {/* Legend */}
          <div
            style={{
              display: 'flex',
              gap: 16,
              marginTop: 10,
              fontFamily: 'var(--font-ui)',
              fontSize: '0.7rem',
              color: 'var(--color-text-muted)',
            }}
          >
            <span>
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: '#37c85a',
                  marginRight: 5,
                }}
              />
              Sessions started
            </span>
            <span>
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: '#cc3030',
                  marginRight: 5,
                }}
              />
              Scope drift events — 0 = guards working
            </span>
          </div>
        </>
      )}
    </div>
  )
}
