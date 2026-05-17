'use client'

import type { AuditEvent } from './AIControlShell'

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

const STATUS_COLORS: Record<string, string> = {
  success: 'text-emerald-400',
  ok: 'text-emerald-400',
  error: 'text-red-400',
  fail: 'text-red-400',
  warn: 'text-yellow-400',
  pending: 'text-yellow-400',
}

function statusColor(s: string | null) {
  if (!s) return 'text-[var(--color-text-muted)]'
  const key = Object.keys(STATUS_COLORS).find((k) => s.toLowerCase().includes(k))
  return key ? STATUS_COLORS[key] : 'text-[var(--color-text-muted)]'
}

export function AuditTrailTab({ events }: { events: AuditEvent[] }) {
  if (!events.length) {
    return (
      <p className="font-[var(--font-ui)] text-[length:var(--text-small)] text-[var(--color-text-muted)]">
        No events found.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            {['Time', 'Domain', 'Action', 'Actor', 'Status', 'ms', 'Tokens', 'Cost'].map((h) => (
              <th
                key={h}
                className="pb-2 pr-4 font-[var(--font-ui)] text-[length:var(--text-nano)] font-semibold tracking-widest text-[var(--color-text-muted)]"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr
              key={e.id}
              className="border-b border-[var(--color-border)] border-opacity-40 hover:bg-[var(--color-surface)]"
              title={[e.input_summary, e.output_summary, e.error_message].filter(Boolean).join(' | ')}
            >
              <td className="py-1 pr-4 font-[var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-muted)] whitespace-nowrap">
                {fmt(e.occurred_at)}
              </td>
              <td className="py-1 pr-4 font-[var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-secondary)]">
                {e.domain ?? '—'}
              </td>
              <td className="py-1 pr-4 font-[var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-primary)] max-w-[200px] truncate">
                {e.action ?? '—'}
              </td>
              <td className="py-1 pr-4 font-[var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-secondary)]">
                {e.actor ?? '—'}
              </td>
              <td className={`py-1 pr-4 font-[var(--font-ui)] text-[length:var(--text-nano)] ${statusColor(e.status)}`}>
                {e.status ?? '—'}
              </td>
              <td className="py-1 pr-4 font-[var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-muted)] tabular-nums">
                {e.duration_ms != null ? e.duration_ms.toLocaleString() : '—'}
              </td>
              <td className="py-1 pr-4 font-[var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-muted)] tabular-nums">
                {e.tokens_used != null ? e.tokens_used.toLocaleString() : '—'}
              </td>
              <td className="py-1 font-[var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-muted)] tabular-nums">
                {e.cost_usd != null ? `$${Number(e.cost_usd).toFixed(4)}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
