import { getActiveSessions } from '@/lib/harness/window-tracker'
import { getComponentsWithHealth, type HealthStatus } from '@/lib/harness/component-health'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const DOT: Record<HealthStatus, string> = {
  green: 'text-green-500',
  amber: 'text-yellow-400',
  red: 'text-red-500',
}

function formatAge(iso: string | null): string {
  if (!iso) return '—'
  const diffMs = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diffMs / 3_600_000)
  const m = Math.floor((diffMs % 3_600_000) / 60_000)
  if (h >= 24) return `${Math.floor(h / 24)}d ago`
  if (h > 0) return `${h}h ${m}m ago`
  return `${m}m ago`
}

export default async function StatusPage() {
  let sessions: Awaited<ReturnType<typeof getActiveSessions>> = []
  let components: Awaited<ReturnType<typeof getComponentsWithHealth>> = []
  let fetchError: string | null = null

  try {
    ;[sessions, components] = await Promise.all([getActiveSessions(), getComponentsWithHealth()])
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'unknown error'
  }

  return (
    <main className="p-8 font-mono text-sm">
      {fetchError && <p className="mb-6 text-red-500">Error: {fetchError}</p>}

      {/* ── Component Health ─────────────────────────────────────────────────── */}
      <h1 className="mb-4 text-xl font-bold">Component Health</h1>

      {components.length === 0 && !fetchError && (
        <p className="mb-6 text-gray-400">No harness_components rows found.</p>
      )}

      {components.length > 0 && (
        <table className="mb-10 w-full border-collapse">
          <thead>
            <tr className="border-b border-gray-600">
              <th className="py-1 pr-4 text-left">Component</th>
              <th className="py-1 pr-4 text-left">%</th>
              <th className="py-1 pr-4 text-left">Status</th>
              <th className="py-1 pr-4 text-left">Last Success</th>
              <th className="py-1 text-left">Last Failure</th>
            </tr>
          </thead>
          <tbody>
            {components.map((c) => (
              <tr key={c.id} className="border-b border-gray-800">
                <td className="py-1 pr-4">{c.display_name}</td>
                <td className="py-1 pr-4 text-gray-400">{Number(c.completion_pct).toFixed(0)}%</td>
                <td className="py-1 pr-4">
                  <span className={DOT[c.health]}>●</span>
                  <span className="ml-1 text-gray-400">{c.health}</span>
                </td>
                <td className="py-1 pr-4 text-gray-400">{formatAge(c.last_success)}</td>
                <td className="py-1 text-gray-400">
                  {c.last_failure ? (
                    <>
                      {formatAge(c.last_failure)}
                      {c.last_error && (
                        <span className="ml-2 text-red-400" title={c.last_error}>
                          ({c.last_error.slice(0, 40)}
                          {c.last_error.length > 40 ? '…' : ''})
                        </span>
                      )}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── Active Windows ───────────────────────────────────────────────────── */}
      <h1 className="mb-4 text-xl font-bold">Active Windows</h1>

      {sessions.length === 0 && !fetchError && (
        <p className="text-gray-400">No active windows (heartbeat within last 5 min).</p>
      )}

      {sessions.length > 0 && (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-gray-600">
              <th className="py-1 pr-4 text-left">Session ID</th>
              <th className="py-1 pr-4 text-left">Current Task</th>
              <th className="py-1 pr-4 text-left">Last Heartbeat</th>
              <th className="py-1 text-left">Started</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.session_id} className="border-b border-gray-800">
                <td className="py-1 pr-4 text-gray-400">{s.session_id.slice(0, 12)}…</td>
                <td className="py-1 pr-4">{s.current_task ?? '—'}</td>
                <td className="py-1 pr-4 text-gray-400">
                  {new Date(s.last_heartbeat).toLocaleTimeString()}
                </td>
                <td className="py-1 text-gray-400">
                  {new Date(s.started_at).toLocaleTimeString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
