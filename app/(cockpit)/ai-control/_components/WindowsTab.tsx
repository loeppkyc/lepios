'use client'

import type { SessionBeacon } from './AIControlShell'

const STALE_MS = 30 * 60 * 1000 // 30 min

function fmt(ts: string | null) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-CA', {
    timeZone: 'America/Edmonton',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function heartbeatAge(ts: string | null): string {
  if (!ts) return '—'
  const ms = Date.now() - new Date(ts).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  return `${Math.round(ms / 3_600_000)}h ago`
}

function isActive(ts: string | null): boolean {
  if (!ts) return false
  return Date.now() - new Date(ts).getTime() < STALE_MS
}

export function WindowsTab({ sessions }: { sessions: SessionBeacon[] }) {
  if (!sessions.length) {
    return (
      <p className="font-[var(--font-ui)] text-[length:var(--text-small)] text-[var(--color-text-muted)]">
        No session beacons found.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            {['Branch', 'PID', 'Host', 'Started', 'Last Heartbeat', 'Tools', 'Last Tool'].map(
              (h) => (
                <th
                  key={h}
                  className="pb-2 pr-4 font-[var(--font-ui)] text-[length:var(--text-nano)] font-semibold tracking-widest text-[var(--color-text-muted)]"
                >
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {sessions.map((s, i) => {
            const active = isActive(s.last_heartbeat)
            return (
              <tr
                key={i}
                className="border-b border-[var(--color-border)] border-opacity-40 hover:bg-[var(--color-surface)]"
              >
                <td className="py-1 pr-4 font-[var(--font-mono)] text-[length:var(--text-nano)] text-[var(--color-text-primary)] max-w-[180px] truncate">
                  {s.branch ?? '—'}
                </td>
                <td className="py-1 pr-4 font-[var(--font-mono)] text-[length:var(--text-nano)] text-[var(--color-text-muted)] tabular-nums">
                  {s.pid ?? '—'}
                </td>
                <td className="py-1 pr-4 font-[var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-muted)]">
                  {s.hostname ?? '—'}
                </td>
                <td className="py-1 pr-4 font-[var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-muted)] whitespace-nowrap">
                  {fmt(s.started_at)}
                </td>
                <td className="py-1 pr-4 whitespace-nowrap">
                  <span
                    className={`font-[var(--font-ui)] text-[length:var(--text-nano)] ${active ? 'text-emerald-400' : 'text-[var(--color-text-muted)]'}`}
                  >
                    {heartbeatAge(s.last_heartbeat)}
                  </span>
                  {active && (
                    <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  )}
                </td>
                <td className="py-1 pr-4 font-[var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-muted)] tabular-nums">
                  {s.tool_count ?? '—'}
                </td>
                <td className="py-1 font-[var(--font-mono)] text-[length:var(--text-nano)] text-[var(--color-text-muted)] max-w-[160px] truncate">
                  {s.last_tool ?? '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-4 font-[var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-muted)]">
        Active = heartbeat within 30 min. Last 30 sessions shown.
      </p>
    </div>
  )
}
