'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface AgentEvent {
  id: string
  domain: string
  action: string
  actor: string | null
  status: string | null
  category: string | null
  created_at: string
  input_summary: string | null
  output_summary: string | null
  error_message: string | null
  error_type: string | null
  duration_ms: number | null
  tokens_used: number | null
  cost_usd: number | null
  [key: string]: unknown
}

interface TaskRow {
  id: string
  title: string | null
  status: string
  priority: number | null
  claimed_by: string | null
  created_at: string
  updated_at: string
}

interface DebugClientProps {
  events: AgentEvent[]
  tasks: TaskRow[]
}

const STATUS_COLORS: Record<string, string> = {
  success: 'text-green-300',
  error: 'text-red-400',
  failure: 'text-red-400',
  info: 'text-blue-300',
  pending: 'text-yellow-300',
  running: 'text-blue-300',
  completed: 'text-green-300',
}

function fmtDate(d: string) {
  return new Date(d).toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function DebugClient({ events, tasks }: DebugClientProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [domainFilter, setDomainFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  const domains = ['all', ...Array.from(new Set(events.map((e) => e.domain))).sort()]
  const statuses = [
    'all',
    ...Array.from(new Set(events.map((e) => e.status ?? '')))
      .filter(Boolean)
      .sort(),
  ]

  const filtered = events.filter((e) => {
    if (domainFilter !== 'all' && e.domain !== domainFilter) return false
    if (statusFilter !== 'all' && e.status !== statusFilter) return false
    if (search && !JSON.stringify(e).toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // Task status breakdown
  const taskStatuses = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="flex flex-col gap-6">
      {/* Task queue breakdown */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
          Task Queue (last 10)
        </h2>
        <div className="mb-3 flex flex-wrap gap-3">
          {Object.entries(taskStatuses).map(([s, count]) => (
            <div
              key={s}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-center"
            >
              <div
                className={`text-base font-bold ${STATUS_COLORS[s] ?? 'text-[var(--color-text-primary)]'}`}
              >
                {count}
              </div>
              <div className="text-[10px] text-[var(--color-text-muted)]">{s}</div>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                {['Title', 'Status', 'Priority', 'Claimed By', 'Updated'].map((h) => (
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
              {tasks.map((t) => (
                <tr key={t.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="max-w-[220px] truncate px-3 py-2 text-xs text-[var(--color-text-primary)]">
                    {t.title ?? t.id}
                  </td>
                  <td
                    className={`px-3 py-2 text-xs font-medium ${STATUS_COLORS[t.status] ?? 'text-[var(--color-text-muted)]'}`}
                  >
                    {t.status}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--color-text-disabled)]">
                    {t.priority ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--color-text-disabled)]">
                    {t.claimed_by ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--color-text-disabled)]">
                    {fmtDate(t.updated_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Event viewer */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
          Agent Events (last 50) — click row to expand JSON
        </h2>

        {/* Filters */}
        <div className="mb-3 flex flex-wrap gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events…"
            className="h-8 w-48 text-xs"
          />
          <Select value={domainFilter} onValueChange={setDomainFilter}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {domains.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          {filtered.slice(0, 50).map((e) => (
            <div
              key={e.id}
              className="overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-surface)]"
            >
              <button
                onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--color-border)]/20"
              >
                <span className="w-32 flex-shrink-0 text-[10px] whitespace-nowrap text-[var(--color-text-disabled)]">
                  {fmtDate(e.created_at)}
                </span>
                <span className="w-24 flex-shrink-0 truncate text-[10px] font-medium text-[var(--color-text-primary)]">
                  {e.domain}
                </span>
                <span className="w-36 flex-shrink-0 truncate text-[10px] text-[var(--color-text-muted)]">
                  {e.action}
                </span>
                <span
                  className={`w-16 flex-shrink-0 text-[10px] font-medium ${STATUS_COLORS[e.status ?? ''] ?? 'text-[var(--color-text-disabled)]'}`}
                >
                  {e.status ?? '—'}
                </span>
                {e.error_message && (
                  <span className="flex-1 truncate text-[10px] text-red-400">
                    {e.error_message}
                  </span>
                )}
              </button>
              {expandedId === e.id && (
                <div className="border-t border-[var(--color-border)] bg-[var(--color-base)] p-3">
                  <pre className="overflow-x-auto text-[10px] leading-relaxed break-all whitespace-pre-wrap text-[var(--color-text-muted)]">
                    {JSON.stringify(e, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-[var(--color-text-muted)]">
              No events match the current filters.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
