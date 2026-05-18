'use client'

interface AgentEvent {
  id: string
  domain: string
  action: string
  actor: string | null
  status: string | null
  created_at: string
  input_summary: string | null
  output_summary: string | null
  error_message: string | null
}

interface TaskQueueRow {
  id: string
  title: string | null
  status: string
  priority: number | null
  claimed_by: string | null
  created_at: string
}

interface AgentSwarmClientProps {
  recentEvents: AgentEvent[]
  activeTasks: TaskQueueRow[]
  completedToday: number
  eventsLastHour: number
}

const STATUS_COLORS: Record<string, string> = {
  success: 'bg-green-500/20 text-green-300',
  error: 'bg-red-500/20 text-red-300',
  failure: 'bg-red-500/20 text-red-300',
  info: 'bg-blue-500/20 text-blue-300',
  pending: 'bg-yellow-500/20 text-yellow-300',
  running: 'bg-blue-500/20 text-blue-300',
  completed: 'bg-green-500/20 text-green-300',
}

function fmtDate(d: string) {
  return new Date(d).toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function AgentSwarmClient({
  recentEvents,
  activeTasks,
  completedToday,
  eventsLastHour,
}: AgentSwarmClientProps) {
  return (
    <div className="flex flex-col gap-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: 'Pending Tasks',
            value: activeTasks.filter((t) => t.status === 'pending').length,
            color: 'text-yellow-300',
          },
          { label: 'Completed Today', value: completedToday, color: 'text-green-300' },
          {
            label: 'Events Last Hour',
            value: eventsLastHour,
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

      {/* Active tasks */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
          Active Tasks ({activeTasks.length})
        </h2>
        {activeTasks.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)]">No pending or running tasks.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  {['Title', 'Status', 'Priority', 'Claimed By', 'Created'].map((h) => (
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
                {activeTasks.map((t) => (
                  <tr key={t.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="max-w-[240px] truncate px-3 py-2 text-xs text-[var(--color-text-primary)]">
                      {t.title ?? t.id}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLORS[t.status] ?? 'text-[var(--color-text-muted)]'}`}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                      {t.priority ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                      {t.claimed_by ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                      {fmtDate(t.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Event feed */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
          Recent Agent Events (last 20)
        </h2>
        {recentEvents.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)]">No events yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {recentEvents.map((e) => (
              <div
                key={e.id}
                className="flex items-start gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs"
              >
                <span className="w-32 flex-shrink-0 text-[var(--color-text-disabled)]">
                  {fmtDate(e.created_at)}
                </span>
                <span className="w-24 flex-shrink-0 truncate font-medium text-[var(--color-text-primary)]">
                  {e.domain}
                </span>
                <span className="w-32 flex-shrink-0 truncate text-[var(--color-text-muted)]">
                  {e.action}
                </span>
                <span className="w-20 flex-shrink-0 truncate text-[var(--color-text-disabled)]">
                  {e.actor ?? '—'}
                </span>
                <span
                  className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLORS[e.status ?? ''] ?? 'text-[var(--color-text-muted)]'}`}
                >
                  {e.status ?? '—'}
                </span>
                {e.error_message && (
                  <span className="flex-1 truncate text-red-400">{e.error_message}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
