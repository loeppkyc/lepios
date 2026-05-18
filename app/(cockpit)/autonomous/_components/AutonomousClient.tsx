'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface TaskRow {
  id: string
  title: string | null
  status: string
  priority: number | null
  claimed_by: string | null
  created_at: string
  updated_at: string
}

interface CoordinatorEvent {
  id: string
  domain: string
  action: string
  actor: string | null
  status: string | null
  created_at: string
  output_summary: string | null
  error_message: string | null
}

interface StatusCounts {
  pending: number
  running: number
  completed: number
  failed: number
}

interface AutonomousClientProps {
  harnessHalted: boolean
  remoteInvocationEnabled: boolean
  tasks: TaskRow[]
  statusCounts: StatusCounts
  coordinatorEvents: CoordinatorEvent[]
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-300',
  running: 'bg-blue-500/20 text-blue-300',
  completed: 'bg-green-500/20 text-green-300',
  failed: 'bg-red-500/20 text-red-300',
  queued: 'bg-yellow-500/20 text-yellow-300',
  awaiting_grounding: 'bg-purple-500/20 text-purple-300',
}

function fmtDate(d: string) {
  return new Date(d).toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function AutonomousClient({
  harnessHalted: initialHalted,
  remoteInvocationEnabled,
  tasks,
  statusCounts,
  coordinatorEvents,
}: AutonomousClientProps) {
  const [halted, setHalted] = useState(initialHalted)
  const [toggling, setToggling] = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')

  async function toggleHarness() {
    const newHalted = !halted
    if (
      !confirm(
        newHalted
          ? 'Halt the autonomous harness? No new tasks will be picked up.'
          : 'Resume the autonomous harness? Task pickup will resume.'
      )
    )
      return
    setToggling(true)
    setToggleError(null)
    try {
      const res = await fetch('/api/autonomous/harness-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ halted: newHalted }),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (json.error) throw new Error(json.error)
      setHalted(newHalted)
    } catch (e) {
      setToggleError(String(e))
    } finally {
      setToggling(false)
    }
  }

  const filteredTasks = tasks.filter((t) => statusFilter === 'all' || t.status === statusFilter)
  const taskStatuses = [
    'all',
    'pending',
    'running',
    'completed',
    'failed',
    'queued',
    'awaiting_grounding',
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Harness status */}
      <div className="flex items-center justify-between gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--color-text-primary)]">
              Harness Status
            </span>
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                halted ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300'
              }`}
            >
              {halted ? 'HALTED' : 'RUNNING'}
            </span>
          </div>
          <div className="mt-1 text-xs text-[var(--color-text-muted)]">
            Remote invocation:{' '}
            <span
              className={
                remoteInvocationEnabled ? 'text-green-300' : 'text-[var(--color-text-disabled)]'
              }
            >
              {remoteInvocationEnabled ? 'enabled' : 'disabled'}
            </span>
          </div>
          {toggleError && <div className="mt-1 text-xs text-red-400">{toggleError}</div>}
        </div>
        <Button
          onClick={toggleHarness}
          disabled={toggling}
          variant="outline"
          className={`text-xs ${halted ? 'border-green-500/40 text-green-300 hover:bg-green-500/10' : 'border-red-500/40 text-red-400 hover:bg-red-500/10'}`}
        >
          {toggling ? 'Updating…' : halted ? 'Resume Harness' : 'Halt Harness'}
        </Button>
      </div>

      {/* Status counts */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Pending', value: statusCounts.pending, color: 'text-yellow-300' },
          { label: 'Running', value: statusCounts.running, color: 'text-blue-300' },
          { label: 'Completed', value: statusCounts.completed, color: 'text-green-300' },
          { label: 'Failed', value: statusCounts.failed, color: 'text-red-400' },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-center"
          >
            <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
            <div className="mt-1 text-xs text-[var(--color-text-muted)]">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Task queue */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            Task Queue ({tasks.length} tasks)
          </h2>
          <div className="flex flex-wrap gap-1">
            {taskStatuses.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  statusFilter === s
                    ? 'bg-[var(--color-rail)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        {filteredTasks.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)]">No tasks match this filter.</p>
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
                {filteredTasks.map((t) => (
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
                    <td className="px-3 py-2 text-xs text-[var(--color-text-disabled)]">
                      {t.priority ?? '—'}
                    </td>
                    <td className="max-w-[120px] truncate px-3 py-2 text-xs text-[var(--color-text-disabled)]">
                      {t.claimed_by ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-text-disabled)]">
                      {fmtDate(t.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Coordinator timeline */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
          Coordinator Timeline (last 20)
        </h2>
        {coordinatorEvents.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)]">No coordinator events yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {coordinatorEvents.map((e) => (
              <div
                key={e.id}
                className="flex items-start gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs"
              >
                <span className="w-32 flex-shrink-0 whitespace-nowrap text-[var(--color-text-disabled)]">
                  {fmtDate(e.created_at)}
                </span>
                <span className="w-40 flex-shrink-0 truncate text-[var(--color-text-muted)]">
                  {e.action}
                </span>
                <span
                  className={`flex-shrink-0 text-[10px] font-medium ${
                    e.status === 'success'
                      ? 'text-green-300'
                      : e.status === 'error'
                        ? 'text-red-400'
                        : 'text-[var(--color-text-disabled)]'
                  }`}
                >
                  {e.status ?? '—'}
                </span>
                {e.output_summary && (
                  <span className="flex-1 truncate text-[var(--color-text-disabled)]">
                    {e.output_summary}
                  </span>
                )}
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
