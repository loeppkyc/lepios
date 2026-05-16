'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { TokenStatsResponse, TokenDayPoint } from '@/app/api/local-ai/token-stats/route'

type OllamaModel = {
  name: string
  size: number
  details?: { parameter_size?: string }
}

type OllamaStatus = { ok: true; models: OllamaModel[] } | { ok: false; error: string } | null

function fmtGb(bytes: number) {
  return (bytes / 1e9).toFixed(1) + ' GB'
}

function fmtK(n: number) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n)
}

// ── Shared count-up hook ──────────────────────────────────────────────────────

function useCountUp(target: number, duration = 900) {
  const [display, setDisplay] = useState(target)
  const prevRef = useRef(target)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (target === prevRef.current) return
    const start = prevRef.current
    const startTime = performance.now()
    const animate = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(start + (target - start) * eased))
      if (t < 1) rafRef.current = requestAnimationFrame(animate)
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(animate)
    prevRef.current = target
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [target, duration])

  return display
}

// ── Single token wheel ────────────────────────────────────────────────────────

function TokenWheel({
  label,
  tokens,
  fillPct,
  color,
  moneyLabel,
  moneyValue,
  periodLabel,
}: {
  label: string
  tokens: number
  fillPct: number // 0–1, how full the arc is
  color: string
  moneyLabel: string // e.g. "API equiv" or "saved"
  moneyValue: string // e.g. "$299.32"
  periodLabel: string
}) {
  const display = useCountUp(tokens)
  const R = 48
  const CX = 64
  const CY = 64
  const SIZE = 128
  const circ = 2 * Math.PI * R
  const fill = circ * Math.min(Math.max(fillPct, 0), 1)
  const gap = circ - fill

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        minWidth: 128,
      }}
    >
      {/* Wheel */}
      <div style={{ position: 'relative', width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="#1e1e30" strokeWidth={11} />
          {fill > 0 && (
            <circle
              cx={CX}
              cy={CY}
              r={R}
              fill="none"
              stroke={color}
              strokeWidth={11}
              strokeLinecap="butt"
              strokeDasharray={`${fill} ${gap}`}
              transform={`rotate(-90 ${CX} ${CY})`}
              style={{ transition: 'stroke-dasharray 0.9s cubic-bezier(0.4,0,0.2,1)' }}
            />
          )}
        </svg>
        {/* Center */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '1.1rem',
              fontWeight: 700,
              color: '#fff',
              lineHeight: 1,
            }}
          >
            {fmtK(display)}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: '0.58rem',
              color: 'var(--color-text-muted)',
              marginTop: 3,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            {periodLabel}
          </div>
        </div>
      </div>
      {/* Label */}
      <div style={{ fontFamily: 'var(--font-ui)', fontSize: '0.78rem', fontWeight: 600, color }}>
        {label}
      </div>
      {/* Money */}
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '0.65rem',
            color: 'var(--color-text-muted)',
            marginBottom: 2,
          }}
        >
          {moneyLabel}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '1.3rem',
            fontWeight: 700,
            color,
            lineHeight: 1,
          }}
        >
          {moneyValue}
        </div>
      </div>
    </div>
  )
}

// ── Daily token history chart ─────────────────────────────────────────────────

const tokenChartConfig = {
  claude_tokens: { label: 'Claude', color: '#6b8cff' },
  ollama_tokens: { label: 'Ollama', color: '#37c85a' },
} satisfies ChartConfig

function fmtChartDate(dateStr: string) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
  })
}

function fmtTokenAxis(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(0) + 'k'
  return String(n)
}

function TokenHistoryChart({ daily }: { daily: TokenDayPoint[] }) {
  const hasData = daily.some((d) => d.claude_tokens > 0 || d.ollama_tokens > 0)
  if (!hasData) return null

  return (
    <div style={{ marginTop: 24 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '0.72rem',
            color: 'var(--color-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          Daily tokens — last 14 days
        </div>
        <div
          style={{
            display: 'flex',
            gap: 14,
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
                background: '#6b8cff',
                marginRight: 5,
              }}
            />
            Claude
          </span>
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
            Ollama
          </span>
        </div>
      </div>
      <ChartContainer config={tokenChartConfig} className="h-36 w-full">
        <BarChart data={daily} margin={{ top: 4, right: 0, left: -16, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.4} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtChartDate}
            tickLine={false}
            axisLine={false}
            interval={2}
            tick={{
              fontSize: 10,
              fill: 'var(--color-text-muted)',
              fontFamily: 'var(--font-ui)',
            }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={fmtTokenAxis}
            tick={{
              fontSize: 10,
              fill: 'var(--color-text-muted)',
              fontFamily: 'var(--font-ui)',
            }}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="claude_tokens" fill="#6b8cff" radius={[2, 2, 0, 0]} opacity={0.85} />
          <Bar dataKey="ollama_tokens" fill="#37c85a" radius={[2, 2, 0, 0]} opacity={0.85} />
        </BarChart>
      </ChartContainer>
    </div>
  )
}

// ── Dual wheel row ────────────────────────────────────────────────────────────

function LiveTokenWheels({ stats }: { stats: TokenStatsResponse | null }) {
  const claudeTokens = stats?.this_week.claude_tokens ?? 0
  const ollamaTokens = stats?.this_week.ollama_tokens ?? 0
  const total = claudeTokens + ollamaTokens
  const claudePct = total > 0 ? claudeTokens / total : 0
  const ollamaPct = total > 0 ? ollamaTokens / total : 0
  const claudeCost = stats?.this_week.claude_cost_usd ?? 0
  const ollamaSaved = stats?.this_week.ollama_saved_usd ?? 0

  return (
    <div
      style={{
        display: 'flex',
        gap: 40,
        alignItems: 'flex-start',
        justifyContent: 'center',
        flexWrap: 'wrap',
      }}
    >
      <TokenWheel
        label="Claude"
        tokens={claudeTokens}
        fillPct={claudePct}
        color="#6b8cff"
        moneyLabel="API equiv"
        moneyValue={`$${claudeCost.toFixed(2)}`}
        periodLabel="this week"
      />
      {/* Divider */}
      <div style={{ width: 1, background: '#2a2a3a', alignSelf: 'stretch', margin: '8px 0' }} />
      <TokenWheel
        label="Ollama"
        tokens={ollamaTokens}
        fillPct={ollamaPct}
        color="#37c85a"
        moneyLabel="saved"
        moneyValue={`$${ollamaSaved.toFixed(2)}`}
        periodLabel="this week"
      />
    </div>
  )
}

// ── Main shell ────────────────────────────────────────────────────────────────

export function LocalAIShell({
  memCount,
  hasTunnelConfig,
}: {
  memCount: number
  hasTunnelConfig: boolean
}) {
  const [status, setStatus] = useState<OllamaStatus>(null)
  const [loading, setLoading] = useState(true)
  const [tokenStats, setTokenStats] = useState<TokenStatsResponse | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [pulse, setPulse] = useState(false)

  function fetchTokenStats() {
    fetch('/api/local-ai/token-stats')
      .then((r) => r.json())
      .then((data) => {
        setTokenStats((prev) => {
          const next = data as TokenStatsResponse
          const prevC = prev?.this_week.claude_tokens ?? 0
          const prevO = prev?.this_week.ollama_tokens ?? 0
          if (next.this_week.claude_tokens !== prevC || next.this_week.ollama_tokens !== prevO)
            setPulse(true)
          return next
        })
        setLastUpdated(new Date())
      })
      .catch(() => {})
  }

  function checkOllama() {
    setLoading(true)
    fetch('/api/local-ai/status')
      .then((r) => r.json())
      .then((data) => setStatus(data as OllamaStatus))
      .catch(() => setStatus({ ok: false, error: 'Failed to reach status endpoint' }))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    let cancelled = false
    fetch('/api/local-ai/status')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setStatus(data as OllamaStatus)
      })
      .catch(() => {
        if (!cancelled) setStatus({ ok: false, error: 'Failed to reach status endpoint' })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    fetchTokenStats()

    // Poll token stats every 15 s
    const interval = setInterval(fetchTokenStats, 15_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  // Clear pulse after animation
  useEffect(() => {
    if (!pulse) return
    const t = setTimeout(() => setPulse(false), 1200)
    return () => clearTimeout(t)
  }, [pulse])

  const pillStyle = (active: boolean) => ({
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 10,
    fontSize: '0.78rem',
    fontFamily: 'var(--font-ui)',
    fontWeight: 600,
    background: active ? '#1a4a2044' : '#3a1a1a44',
    color: active ? '#37c85a' : '#cc1a1a',
    border: `1px solid ${active ? '#37c85a44' : '#cc1a1a44'}`,
  })

  const statCard = (label: string, value: string | number) => (
    <div
      style={{
        background: '#1a1a2a',
        border: '1px solid #2a2a3a',
        borderRadius: 10,
        padding: '16px 20px',
        minWidth: 140,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.4rem',
          fontWeight: 700,
          color: 'var(--color-text-primary)',
        }}
      >
        {value}
      </div>
    </div>
  )

  const ollamaUp = status?.ok === true
  const models = status?.ok ? status.models : []

  return (
    <div>
      {/* ── Live Token Wheel ─────────────────────────────────── */}
      <div
        style={{
          background: '#14141e',
          border: `1px solid ${pulse ? '#37c85a66' : '#2a2a3a'}`,
          borderRadius: 10,
          padding: '20px 24px',
          marginBottom: 20,
          transition: 'border-color 0.4s ease',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              fontSize: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            Token Usage
            {/* Pulsing live dot */}
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#37c85a',
                display: 'inline-block',
                animation: 'pulse-dot 2s ease-in-out infinite',
              }}
            />
          </div>
          {lastUpdated && (
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.7rem',
                color: 'var(--color-text-muted)',
              }}
            >
              updated {lastUpdated.toLocaleTimeString()}
            </div>
          )}
        </div>

        <LiveTokenWheels stats={tokenStats} />
        {tokenStats?.daily && <TokenHistoryChart daily={tokenStats.daily} />}
      </div>

      {/* ── Stat row ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 28 }}>
        {statCard('Status', loading ? '…' : ollamaUp ? 'Online' : 'Offline')}
        {statCard('Models', loading ? '…' : ollamaUp ? models.length : '—')}
        {statCard('Knowledge', memCount)}
        <div
          style={{
            background: '#1a1a2a',
            border: '1px solid #2a2a3a',
            borderRadius: 10,
            padding: '16px 20px',
            minWidth: 140,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: '0.75rem',
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 10,
            }}
          >
            Tunnel Config
          </div>
          <span style={pillStyle(hasTunnelConfig)}>
            {hasTunnelConfig ? 'Configured' : 'Not set'}
          </span>
        </div>
      </div>

      {/* ── Ollama status ─────────────────────────────────────── */}
      <div
        style={{
          background: '#14141e',
          border: '1px solid #2a2a3a',
          borderRadius: 10,
          padding: '20px 24px',
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              fontSize: '1rem',
            }}
          >
            Ollama (via tunnel)
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={pillStyle(ollamaUp)}>{ollamaUp ? 'Online' : 'Offline'}</span>
            <button
              onClick={checkOllama}
              disabled={loading}
              style={{
                background: 'none',
                border: '1px solid #444',
                borderRadius: 6,
                color: 'var(--color-text-muted)',
                cursor: loading ? 'default' : 'pointer',
                fontSize: '0.78rem',
                padding: '3px 10px',
                fontFamily: 'var(--font-ui)',
              }}
            >
              {loading ? 'Checking…' : 'Refresh'}
            </button>
          </div>
        </div>

        {!hasTunnelConfig && (
          <div
            style={{
              background: '#2a1818',
              border: '1px solid #cc1a1a44',
              borderRadius: 8,
              padding: '10px 14px',
              fontFamily: 'var(--font-ui)',
              fontSize: '0.82rem',
              color: '#c89b37',
              marginBottom: 12,
            }}
          >
            <strong>OLLAMA_TUNNEL_URL</strong> not set in Vercel env — tunnel checks will fail. Set
            it to your ngrok/Cloudflare tunnel URL.
          </div>
        )}

        {status?.ok === false && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: '#cc1a1a' }}>
            {status.error}
          </div>
        )}

        {ollamaUp && models.length > 0 && (
          <div>
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.78rem',
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 8,
              }}
            >
              Loaded models
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {models.map((m) => (
                <div
                  key={m.name}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: '#1e1e2e',
                    borderRadius: 6,
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.82rem',
                  }}
                >
                  <span style={{ color: 'var(--color-text-primary)' }}>{m.name}</span>
                  <span style={{ color: 'var(--color-text-muted)' }}>
                    {m.details?.parameter_size ?? '?'} · {fmtGb(m.size)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Period breakdown ──────────────────────────────────── */}
      {tokenStats && (
        <div
          style={{
            background: '#14141e',
            border: '1px solid #2a2a3a',
            borderRadius: 10,
            padding: '20px 24px',
            marginBottom: 20,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              marginBottom: 16,
            }}
          >
            Breakdown
          </div>
          {[tokenStats.this_week, tokenStats.this_month, tokenStats.all_time].map((period) => {
            const total = period.claude_tokens + period.ollama_tokens
            const ollamaPct = total > 0 ? Math.round((period.ollama_tokens / total) * 100) : 0
            return (
              <div key={period.label} style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: '0.72rem',
                    color: 'var(--color-text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: 8,
                  }}
                >
                  {period.label}
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                  <div
                    style={{
                      background: '#1e1e2e',
                      borderRadius: 8,
                      padding: '10px 14px',
                      minWidth: 130,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: '0.7rem',
                        color: '#6b8cff',
                        marginBottom: 4,
                      }}
                    >
                      Claude API
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '1rem',
                        fontWeight: 700,
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      {period.claude_tokens.toLocaleString()}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.75rem',
                        color: 'var(--color-text-muted)',
                      }}
                    >
                      ${period.claude_cost_usd.toFixed(4)}
                    </div>
                  </div>
                  <div
                    style={{
                      background: '#1e1e2e',
                      borderRadius: 8,
                      padding: '10px 14px',
                      minWidth: 130,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: '0.7rem',
                        color: '#37c85a',
                        marginBottom: 4,
                      }}
                    >
                      Ollama (local)
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '1rem',
                        fontWeight: 700,
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      {period.ollama_tokens.toLocaleString()}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.75rem',
                        color: '#37c85a',
                      }}
                    >
                      saved ~${period.ollama_saved_usd.toFixed(4)}
                    </div>
                  </div>
                  <div
                    style={{
                      background: '#1e1e2e',
                      borderRadius: 8,
                      padding: '10px 14px',
                      minWidth: 100,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: '0.7rem',
                        color: 'var(--color-text-muted)',
                        marginBottom: 4,
                      }}
                    >
                      Ollama %
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '1.2rem',
                        fontWeight: 700,
                        color: ollamaPct > 50 ? '#37c85a' : 'var(--color-text-primary)',
                      }}
                    >
                      {ollamaPct}%
                    </div>
                    <div
                      style={{ height: 4, borderRadius: 2, background: '#2a2a3a', marginTop: 6 }}
                    >
                      <div
                        style={{
                          height: 4,
                          borderRadius: 2,
                          background: '#37c85a',
                          width: `${ollamaPct}%`,
                          transition: 'width 0.8s ease',
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
          {tokenStats.by_feature.length > 0 && (
            <div>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: '0.72rem',
                  color: 'var(--color-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: 8,
                }}
              >
                Claude usage by feature (all time)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {tokenStats.by_feature.slice(0, 6).map((f) => (
                  <div
                    key={f.domain}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '6px 10px',
                      background: '#1e1e2e',
                      borderRadius: 6,
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.78rem',
                    }}
                  >
                    <span style={{ color: 'var(--color-text-primary)' }}>{f.domain}</span>
                    <span style={{ color: 'var(--color-text-muted)' }}>
                      {f.claude_tokens.toLocaleString()} · ${f.claude_cost_usd.toFixed(4)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Chat link ─────────────────────────────────────────── */}
      <div
        style={{
          background: '#14141e',
          border: '1px solid #2a2a3a',
          borderRadius: 10,
          padding: '20px 24px',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            marginBottom: 8,
          }}
        >
          AI Chat
        </div>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '0.85rem',
            color: 'var(--color-text-muted)',
            margin: '0 0 14px',
          }}
        >
          Conversation interface with RAG context from your {memCount} knowledge documents.
        </p>
        <Link
          href="/cockpit/chat"
          style={{
            display: 'inline-block',
            background: 'var(--color-rail)',
            color: '#fff',
            borderRadius: 8,
            padding: '8px 20px',
            fontFamily: 'var(--font-ui)',
            fontWeight: 600,
            fontSize: '0.85rem',
            textDecoration: 'none',
          }}
        >
          Open Chat →
        </Link>
      </div>

      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.7); }
        }
      `}</style>
    </div>
  )
}
