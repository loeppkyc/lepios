import { getActiveSessions } from '@/lib/harness/window-tracker'
import { getComponentsWithHealth, type HealthStatus } from '@/lib/harness/component-health'
import { getIncidentLog, get90DayBars, type Incident, type DayBar } from '@/lib/harness/status-data'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const DOT: Record<HealthStatus, string> = {
  green: 'text-green-500',
  amber: 'text-yellow-400',
  red: 'text-red-500',
}

const BAR_COLOR: Record<DayBar['status'], string> = {
  green: 'bg-green-500',
  amber: 'bg-yellow-400',
  red: 'bg-red-500',
  none: 'bg-gray-800',
}

const INCIDENT_DOT: Record<'error' | 'warning', string> = {
  error: 'text-red-500',
  warning: 'text-yellow-400',
}

// Both Edmonton MT and UTC side-by-side
function formatBoth(iso: string): { mt: string; utc: string } {
  const d = new Date(iso)
  const mt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Edmonton',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
  const utc = iso.slice(0, 16).replace('T', ' ') + 'Z'
  return { mt: `${mt} MT`, utc }
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
  let incidents: Incident[] = []
  let bars: DayBar[] = []
  let fetchError: string | null = null

  try {
    ;[sessions, components, incidents, bars] = await Promise.all([
      getActiveSessions(),
      getComponentsWithHealth(),
      getIncidentLog(),
      get90DayBars(),
    ])
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
        <table className="mb-6 w-full border-collapse">
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

      {/* ── 90-Day Uptime Bars ───────────────────────────────────────────────── */}
      <h2 className="mb-3 text-lg font-bold">90-Day Uptime (harness domain)</h2>
      <div className="mb-2 flex items-center gap-3 text-xs text-gray-500">
        <span>
          <span className="inline-block h-2 w-2 rounded-sm bg-green-500" /> all success
        </span>
        <span>
          <span className="inline-block h-2 w-2 rounded-sm bg-yellow-400" /> mixed
        </span>
        <span>
          <span className="inline-block h-2 w-2 rounded-sm bg-red-500" /> errors only
        </span>
        <span>
          <span className="inline-block h-2 w-2 rounded-sm bg-gray-800" /> no events
        </span>
      </div>
      <div className="mb-10 flex flex-wrap gap-px">
        {bars.map((bar) => (
          <div
            key={bar.date}
            className={`h-4 w-2 rounded-sm ${BAR_COLOR[bar.status]}`}
            title={`${bar.date}: ${bar.successCount} ok / ${bar.errorCount} err`}
          />
        ))}
      </div>

      {/* ── Active Windows ───────────────────────────────────────────────────── */}
      <h2 className="mb-4 text-lg font-bold">Active Windows</h2>

      {sessions.length === 0 && !fetchError && (
        <p className="mb-10 text-gray-400">No active windows (heartbeat within last 5 min).</p>
      )}

      {sessions.length > 0 && (
        <table className="mb-10 w-full border-collapse">
          <thead>
            <tr className="border-b border-gray-600">
              <th className="py-1 pr-4 text-left">Session ID</th>
              <th className="py-1 pr-4 text-left">Current Task</th>
              <th className="py-1 pr-4 text-left">Last Heartbeat</th>
              <th className="py-1 text-left">Started</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const hb = formatBoth(s.last_heartbeat)
              const st = formatBoth(s.started_at)
              return (
                <tr key={s.session_id} className="border-b border-gray-800">
                  <td className="py-1 pr-4 text-gray-400">{s.session_id.slice(0, 12)}…</td>
                  <td className="py-1 pr-4">{s.current_task ?? '—'}</td>
                  <td className="py-1 pr-4 text-gray-400">
                    {hb.mt} <span className="text-gray-600">/ {hb.utc}</span>
                  </td>
                  <td className="py-1 text-gray-400">
                    {st.mt} <span className="text-gray-600">/ {st.utc}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {/* ── Incident Log ─────────────────────────────────────────────────────── */}
      <h2 className="mb-4 text-lg font-bold">Incident Log (last {incidents.length})</h2>

      {incidents.length === 0 && !fetchError && (
        <p className="text-gray-400">No recent errors or warnings.</p>
      )}

      {incidents.length > 0 && (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-gray-600">
              <th className="py-1 pr-4 text-left">Time (MT / UTC)</th>
              <th className="py-1 pr-4 text-left">Domain</th>
              <th className="py-1 pr-4 text-left">Action</th>
              <th className="py-1 pr-4 text-left">Actor</th>
              <th className="py-1 text-left">Error</th>
            </tr>
          </thead>
          <tbody>
            {incidents.map((inc) => {
              const ts = formatBoth(inc.occurred_at)
              return (
                <tr key={inc.id} className="border-b border-gray-800">
                  <td className="py-1 pr-4 text-gray-400">
                    <span className={INCIDENT_DOT[inc.status]}>●</span> {ts.mt}{' '}
                    <span className="text-gray-600">/ {ts.utc}</span>
                  </td>
                  <td className="py-1 pr-4 text-gray-500">{inc.domain}</td>
                  <td className="py-1 pr-4">{inc.action}</td>
                  <td className="py-1 pr-4 text-gray-500">{inc.actor ?? '—'}</td>
                  <td
                    className="max-w-xs truncate py-1 text-red-400"
                    title={inc.error_message ?? ''}
                  >
                    {inc.error_message?.slice(0, 60) ?? '—'}
                    {(inc.error_message?.length ?? 0) > 60 ? '…' : ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </main>
  )
}
