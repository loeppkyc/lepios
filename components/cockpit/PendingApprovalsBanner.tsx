'use client'

import { useEffect, useState, useTransition } from 'react'

interface PendingNotification {
  id: string
  payload: Record<string, unknown>
  created_at: string
  attempts: number
  last_error: string | null
}

function formatAge(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ${m % 60}m ago`
}

function extractMessage(payload: Record<string, unknown>): string {
  const text = payload?.text ?? payload?.message ?? payload?.summary
  if (typeof text === 'string') return text.slice(0, 120)
  return '(no message text)'
}

async function triggerResend(): Promise<void> {
  await fetch('/api/harness/pending-approvals/resend', { method: 'POST' })
}

export function PendingApprovalsBanner() {
  const [notifications, setNotifications] = useState<PendingNotification[]>([])
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [isPending, startTransition] = useTransition()

  async function fetchPending() {
    try {
      const res = await fetch('/api/harness/pending-approvals', { cache: 'no-store' })
      if (!res.ok) return
      const json = await res.json()
      setNotifications(json.notifications ?? [])
      setLastChecked(new Date())
    } catch {
      // non-fatal — banner just doesn't update
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPending()
    const id = setInterval(() => void fetchPending(), 60_000)
    return () => clearInterval(id)
  }, [])

  if (notifications.length === 0) return null

  return (
    <div className="mb-5 rounded-md border border-yellow-500/50 bg-yellow-500/10 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
          <span className="font-mono text-xs font-semibold uppercase tracking-widest text-yellow-400">
            {notifications.length} approval{notifications.length !== 1 ? 's' : ''} stuck
          </span>
          {lastChecked && (
            <span className="text-xs text-zinc-500">
              · checked {lastChecked.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <button
          disabled={isPending}
          onClick={() => startTransition(() => { void triggerResend().then(() => void fetchPending()) })}
          className="rounded border border-yellow-500/40 px-3 py-1 font-mono text-xs text-yellow-400 hover:bg-yellow-500/20 disabled:opacity-50"
        >
          {isPending ? 'Sending…' : 'Force resend'}
        </button>
      </div>
      <ul className="mt-2 space-y-1">
        {notifications.map((n) => (
          <li key={n.id} className="flex items-start gap-2 text-xs text-zinc-400">
            <span className="mt-0.5 shrink-0 text-zinc-600">{formatAge(n.created_at)}</span>
            <span className="truncate">{extractMessage(n.payload)}</span>
            {n.attempts > 0 && (
              <span className="shrink-0 text-zinc-600">{n.attempts} attempt{n.attempts !== 1 ? 's' : ''}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
