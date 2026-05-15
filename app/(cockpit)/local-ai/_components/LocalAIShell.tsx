'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { TokenStatsResponse } from '@/app/api/local-ai/token-stats/route'

type OllamaModel = {
  name: string
  size: number
  details?: { parameter_size?: string }
}

type OllamaStatus = { ok: true; models: OllamaModel[] } | { ok: false; error: string } | null

function fmtGb(bytes: number) {
  return (bytes / 1e9).toFixed(1) + ' GB'
}

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
    fetch('/api/local-ai/token-stats')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setTokenStats(data as TokenStatsResponse)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

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
      {/* Stat row */}
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

      {/* Ollama status */}
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

      {/* Token usage */}
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
          Token Usage
        </div>
        {!tokenStats ? (
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: '0.82rem',
              color: 'var(--color-text-muted)',
            }}
          >
            Loading…
          </div>
        ) : (
          <>
            {/* Period tabs */}
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
                      {/* Mini bar */}
                      <div
                        style={{ height: 4, borderRadius: 2, background: '#2a2a3a', marginTop: 6 }}
                      >
                        <div
                          style={{
                            height: 4,
                            borderRadius: 2,
                            background: '#37c85a',
                            width: `${ollamaPct}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            {/* By feature */}
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
                        {f.claude_tokens.toLocaleString()} tokens · ${f.claude_cost_usd.toFixed(4)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Chat link */}
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
    </div>
  )
}
