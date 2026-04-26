import { getActiveSessions } from '@/lib/harness/window-tracker'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function StatusPage() {
  let sessions: Awaited<ReturnType<typeof getActiveSessions>> = []
  let fetchError: string | null = null

  try {
    sessions = await getActiveSessions()
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'unknown error'
  }

  return (
    <main className="p-8 font-mono text-sm">
      <h1 className="mb-4 text-xl font-bold">Active Windows</h1>

      {fetchError && <p className="mb-4 text-red-500">Error: {fetchError}</p>}

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
