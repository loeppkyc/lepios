'use client'

interface CronEntry {
  path: string
  schedule: string
  humanSchedule: string
  lastRun: { status: string | null; created_at: string } | null
}

interface CommandCentreClientProps {
  crons: CronEntry[]
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

export function CommandCentreClient({ crons }: CommandCentreClientProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              {['Endpoint', 'Schedule', 'Last Run', 'Last Status', 'Trigger'].map((h) => (
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
            {crons.map((c) => (
              <tr
                key={c.path}
                className="border-b border-[var(--color-border)] transition-colors last:border-0 hover:bg-[var(--color-border)]/20"
              >
                <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-primary)]">
                  {c.path}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                  {c.humanSchedule}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--color-text-disabled)]">
                  {c.lastRun ? fmtDate(c.lastRun.created_at) : '—'}
                </td>
                <td className="px-3 py-2">
                  {c.lastRun ? (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLORS[c.lastRun.status ?? ''] ?? 'text-[var(--color-text-muted)]'}`}
                    >
                      {c.lastRun.status ?? '?'}
                    </span>
                  ) : (
                    <span className="text-[10px] text-[var(--color-text-disabled)]">no data</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <code className="font-mono text-[10px] text-[var(--color-text-disabled)] select-all">
                    curl -X POST https://lepios-one.vercel.app{c.path}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
