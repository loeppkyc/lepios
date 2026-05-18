'use client'

interface ConfigRow {
  key: string
  value: string
}

interface AgentEvent {
  id: string
  domain: string
  action: string
  actor: string | null
  status: string | null
  created_at: string
  error_message: string | null
}

interface AdminClientProps {
  configRows: ConfigRow[]
  tasksTotal: number
  tasksCompleted: number
  recentEvents: AgentEvent[]
}

const SECRET_KEYS = ['secret', 'token', 'key', 'password', 'apikey', 'api_key']

function maskValue(key: string, value: string): string {
  const lk = key.toLowerCase()
  const isSensitive = SECRET_KEYS.some((s) => lk.includes(s))
  if (!isSensitive) return value
  if (value.length <= 8) return '****'
  return `${value.slice(0, 4)}${'·'.repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`
}

const STATUS_COLORS: Record<string, string> = {
  success: 'bg-green-500/20 text-green-300',
  error: 'bg-red-500/20 text-red-300',
  failure: 'bg-red-500/20 text-red-300',
  info: 'bg-blue-500/20 text-blue-300',
}

function fmtDate(d: string) {
  return new Date(d).toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function AdminClient({
  configRows,
  tasksTotal,
  tasksCompleted,
  recentEvents,
}: AdminClientProps) {
  const tasksQueued = tasksTotal - tasksCompleted

  return (
    <div className="flex flex-col gap-6">
      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Tasks in Queue', value: tasksQueued, color: 'text-yellow-300' },
          { label: 'Tasks Completed', value: tasksCompleted, color: 'text-green-300' },
          {
            label: 'Config Keys',
            value: configRows.length,
            color: 'text-[var(--color-text-primary)]',
          },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center"
          >
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="mt-1 text-xs text-[var(--color-text-muted)]">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Harness config */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
          Harness Config ({configRows.length} keys)
        </h2>
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)]">
                  Key
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)]">
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
              {configRows.map((row) => (
                <tr key={row.key} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-primary)]">
                    {row.key}
                  </td>
                  <td className="max-w-[320px] truncate px-3 py-2 font-mono text-xs text-[var(--color-text-muted)]">
                    {maskValue(row.key, row.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent agent events */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
          Recent Agent Events (last 30)
        </h2>
        {recentEvents.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)]">No events.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  {['Time', 'Domain', 'Action', 'Actor', 'Status', 'Error'].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentEvents.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-3 py-2 text-xs whitespace-nowrap text-[var(--color-text-disabled)]">
                      {fmtDate(e.created_at)}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-text-primary)]">
                      {e.domain}
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-2 text-xs text-[var(--color-text-muted)]">
                      {e.action}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-text-disabled)]">
                      {e.actor ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLORS[e.status ?? ''] ?? 'text-[var(--color-text-muted)]'}`}
                      >
                        {e.status ?? '—'}
                      </span>
                    </td>
                    <td className="max-w-[200px] truncate px-3 py-2 text-xs text-red-400">
                      {e.error_message ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
