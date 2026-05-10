'use client'

import { useState } from 'react'

type CheckStatus = 'pending' | 'running' | 'pass' | 'fail' | 'local-only'

type CheckResult = {
  label: string
  status: CheckStatus
  message: string
  localOnly: boolean
}

type RunResponse = {
  results: Record<string, { ok: boolean; message: string }>
}

const CHECKS: { key: string; label: string; localOnly: boolean }[] = [
  { key: 'ollama', label: 'Ollama Running', localOnly: false },
  { key: 'gpu', label: 'GPU Detected', localOnly: true },
  { key: 'colin_model', label: 'colin-assistant Model', localOnly: false },
  { key: 'chromadb', label: 'ChromaDB Accessible', localOnly: true },
  { key: 'proxy', label: 'Memory Proxy (port 11435)', localOnly: true },
  { key: 'embed_model', label: 'nomic-embed-text', localOnly: false },
  { key: 'web_search', label: 'Web Search Tool', localOnly: true },
  { key: 'file_tools', label: 'File Tools (colin_agent.py)', localOnly: true },
  { key: 'anthropic', label: 'Claude Escalation', localOnly: false },
  { key: 'memory', label: 'Knowledge Documents', localOnly: false },
]

function statusIcon(s: CheckStatus) {
  if (s === 'pending') return '⚪'
  if (s === 'running') return '⏳'
  if (s === 'pass') return '🟢'
  if (s === 'fail') return '🔴'
  if (s === 'local-only') return '🔵'
  return '⚪'
}

function statusLabel(s: CheckStatus) {
  if (s === 'local-only') return 'local only'
  return s
}

function statusColor(s: CheckStatus) {
  if (s === 'pass') return '#37c85a'
  if (s === 'fail') return '#cc1a1a'
  if (s === 'local-only') return '#6699cc'
  return 'var(--color-text-muted)'
}

export function GpuDayShell({
  hasTunnelConfig,
  hasAnthropicKey,
  memCount,
}: {
  hasTunnelConfig: boolean
  hasAnthropicKey: boolean
  memCount: number
}) {
  const [checks, setChecks] = useState<CheckResult[]>(
    CHECKS.map((c) => ({
      label: c.label,
      status: c.localOnly ? 'local-only' : 'pending',
      message: c.localOnly ? 'Run locally — not checkable from Vercel' : '—',
      localOnly: c.localOnly,
    }))
  )
  const [running, setRunning] = useState(false)

  async function runChecks() {
    setRunning(true)
    setChecks((prev) =>
      prev.map((c) => (c.localOnly ? c : { ...c, status: 'running', message: 'checking…' }))
    )

    try {
      const r = await fetch('/api/gpu-day/run')
      const data = (await r.json()) as RunResponse
      setChecks((prev) =>
        prev.map((c) => {
          const key = CHECKS.find((k) => k.label === c.label)?.key
          if (!key || c.localOnly) return c
          const res = data.results[key]
          if (!res) return c
          return { ...c, status: res.ok ? 'pass' : 'fail', message: res.message }
        })
      )
    } catch {
      setChecks((prev) =>
        prev.map((c) =>
          c.localOnly || c.status !== 'running'
            ? c
            : { ...c, status: 'fail', message: 'Request failed' }
        )
      )
    } finally {
      setRunning(false)
    }
  }

  const remotePassed = checks.filter((c) => !c.localOnly && c.status === 'pass').length
  const remoteTotal = checks.filter((c) => !c.localOnly).length
  const anyRan = checks.some((c) => !c.localOnly && c.status !== 'pending')

  return (
    <div>
      <div
        style={{
          background: '#14141e',
          border: '1px solid #2a2a3a',
          borderRadius: 10,
          padding: '14px 20px',
          marginBottom: 20,
          fontFamily: 'var(--font-ui)',
          fontSize: '0.85rem',
          color: 'var(--color-text-muted)',
        }}
      >
        <strong style={{ color: 'var(--color-text-primary)' }}>GPU Day checklist.</strong> Run this
        when your GPU arrives to confirm every system is connected. 🔵 = local-only check — must be
        verified from your machine, not from Vercel.
      </div>

      <div style={{ marginBottom: 20 }}>
        <button
          onClick={runChecks}
          disabled={running}
          style={{
            background: running ? '#2a2a3a' : 'var(--color-rail)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '10px 24px',
            fontFamily: 'var(--font-ui)',
            fontWeight: 600,
            fontSize: '0.9rem',
            cursor: running ? 'default' : 'pointer',
          }}
        >
          {running ? '⏳ Running…' : '▶ Run System Check'}
        </button>
      </div>

      <div
        style={{
          background: '#14141e',
          border: '1px solid #2a2a3a',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        {checks.map((c, i) => (
          <div
            key={c.label}
            style={{
              display: 'grid',
              gridTemplateColumns: '32px 1fr auto',
              alignItems: 'center',
              gap: 12,
              padding: '12px 20px',
              borderBottom: i < checks.length - 1 ? '1px solid #1e1e2e' : 'none',
            }}
          >
            <span style={{ fontSize: '1.1rem', textAlign: 'center' }}>{statusIcon(c.status)}</span>
            <div>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontWeight: 600,
                  fontSize: '0.88rem',
                  color: c.localOnly ? '#6699cc88' : 'var(--color-text-primary)',
                }}
              >
                {c.label}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.76rem',
                  color: statusColor(c.status),
                  marginTop: 2,
                }}
              >
                {c.message}
              </div>
            </div>
            <span
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.72rem',
                color: statusColor(c.status),
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              {statusLabel(c.status)}
            </span>
          </div>
        ))}
      </div>

      {anyRan && (
        <div
          style={{
            marginTop: 16,
            padding: '14px 20px',
            background:
              remotePassed === remoteTotal
                ? 'linear-gradient(135deg, #102a15, #0a1a0d)'
                : '#2a1a10',
            border: `1px solid ${remotePassed === remoteTotal ? '#37c85a44' : '#c89b3744'}`,
            borderRadius: 10,
            fontFamily: 'var(--font-ui)',
          }}
        >
          {remotePassed === remoteTotal ? (
            <div style={{ color: '#37c85a', fontWeight: 600 }}>
              ✅ All {remoteTotal} remote checks passed. Local checks require on-machine run.
            </div>
          ) : (
            <div style={{ color: '#c89b37', fontWeight: 600 }}>
              {remotePassed}/{remoteTotal} remote checks ready. Fix the red items above, then
              re-run.
            </div>
          )}
        </div>
      )}

      {/* Quick reference */}
      <div
        style={{
          marginTop: 20,
          background: '#14141e',
          border: '1px solid #2a2a3a',
          borderRadius: 10,
          padding: '16px 20px',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            marginBottom: 12,
          }}
        >
          Quick Commands (run locally)
        </div>
        {[
          ['Start Ollama', 'ollama serve'],
          [
            'Build colin-assistant',
            'ollama create colin-assistant -f tools/colin_assistant.Modelfile',
          ],
          ['Pull embedding model', 'ollama pull nomic-embed-text'],
          ['Index memories', 'python tools/memory_export.py'],
          ['Start memory proxy', 'python tools/start_proxy.bat'],
        ].map(([label, cmd]) => (
          <div key={cmd} style={{ marginBottom: 10 }}>
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.75rem',
                color: 'var(--color-text-muted)',
                marginBottom: 3,
              }}
            >
              {label}
            </div>
            <code
              style={{
                display: 'block',
                background: '#0e0e1a',
                border: '1px solid #2a2a3a',
                borderRadius: 6,
                padding: '6px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
                color: '#a0c0ff',
              }}
            >
              {cmd}
            </code>
          </div>
        ))}
        <div
          style={{
            marginTop: 14,
            padding: '10px 12px',
            background: '#0e0e1a',
            border: '1px solid #2a2a3a',
            borderRadius: 6,
            fontFamily: 'var(--font-ui)',
            fontSize: '0.78rem',
            color: 'var(--color-text-muted)',
          }}
        >
          <strong style={{ color: 'var(--color-text-primary)' }}>24TB day:</strong> flip one line in{' '}
          <code style={{ fontFamily: 'var(--font-mono)', color: '#a0c0ff' }}>
            utils/local_ai.py
          </code>{' '}
          — change{' '}
          <code style={{ fontFamily: 'var(--font-mono)', color: '#a0c0ff' }}>AI_DATA_ROOT</code> to{' '}
          <code style={{ fontFamily: 'var(--font-mono)', color: '#a0c0ff' }}>
            Path(&apos;D:/AI_Data&apos;)
          </code>
        </div>
      </div>

      {/* Server-side config status */}
      <div
        style={{
          marginTop: 12,
          padding: '10px 16px',
          background: '#14141e',
          border: '1px solid #2a2a3a',
          borderRadius: 10,
          display: 'flex',
          gap: 20,
          fontFamily: 'var(--font-ui)',
          fontSize: '0.8rem',
          color: 'var(--color-text-muted)',
        }}
      >
        <span>
          OLLAMA_TUNNEL_URL:{' '}
          <strong style={{ color: hasTunnelConfig ? '#37c85a' : '#cc1a1a' }}>
            {hasTunnelConfig ? 'set' : 'missing'}
          </strong>
        </span>
        <span>
          ANTHROPIC_API_KEY:{' '}
          <strong style={{ color: hasAnthropicKey ? '#37c85a' : '#cc1a1a' }}>
            {hasAnthropicKey ? 'set' : 'missing'}
          </strong>
        </span>
        <span>
          Knowledge docs: <strong style={{ color: 'var(--color-text-primary)' }}>{memCount}</strong>
        </span>
      </div>
    </div>
  )
}
