'use client'

import { useState } from 'react'

type Severity = 'urgent' | 'attention' | 'info'

type Signal = {
  key: string
  severity: Severity
  icon: string
  title: string
  body: string
}

type OpenFailure = {
  id: string
  failure_number: string
  title: string
  severity: string
  status: string
}

type Signals = {
  unmatchedReceipts: number
  pendingBets: number
  billsDue: number
  openFailures: number
  openFailuresList: OpenFailure[]
}

const STORAGE_KEY = 'lepios_notif_dismissed'

function buildNotifications(signals: Signals): Signal[] {
  const notifs: Signal[] = []

  if (signals.unmatchedReceipts > 0) {
    const n = signals.unmatchedReceipts
    notifs.push({
      key: 'receipts_match',
      severity: n > 10 ? 'urgent' : 'attention',
      icon: '📸',
      title: 'Receipts Needing Match',
      body: `${n} receipt${n !== 1 ? 's' : ''} not yet matched to transactions.`,
    })
  }

  if (signals.billsDue > 0) {
    const n = signals.billsDue
    notifs.push({
      key: 'bills_due',
      severity: n > 3 ? 'urgent' : 'attention',
      icon: '📒',
      title: 'Bills Due Soon',
      body: `${n} recurring expense${n !== 1 ? 's' : ''} not yet logged this month.`,
    })
  }

  if (signals.openFailures > 0) {
    const n = signals.openFailures
    const items = signals.openFailuresList
      .slice(0, 3)
      .map((f) => f.failure_number || f.title)
      .join(', ')
    const extra = n > 3 ? ` +${n - 3} more` : ''
    notifs.push({
      key: 'open_failures',
      severity: n > 5 ? 'urgent' : 'attention',
      icon: '⚠️',
      title: 'Open Failures',
      body: `${n} failure${n !== 1 ? 's' : ''} open: ${items}${extra}`,
    })
  }

  if (signals.pendingBets > 0) {
    const n = signals.pendingBets
    notifs.push({
      key: 'pending_bets',
      severity: 'info',
      icon: '🎰',
      title: 'Pending Bets',
      body: `${n} bet${n !== 1 ? 's' : ''} awaiting results.`,
    })
  }

  return notifs
}

const SEV: Record<Severity, { bg: string; border: string; color: string }> = {
  urgent: {
    bg: 'linear-gradient(135deg, #2a1015 0%, #1a0a0d 100%)',
    border: '#cc1a1a',
    color: '#cc1a1a',
  },
  attention: {
    bg: 'linear-gradient(135deg, #2a2210 0%, #1a1808 100%)',
    border: '#c89b37',
    color: '#c89b37',
  },
  info: {
    bg: 'linear-gradient(135deg, #102a15 0%, #0a1a0d 100%)',
    border: '#37c85a',
    color: '#37c85a',
  },
}

function NotifCard({ n, onDismiss }: { n: Signal; onDismiss: () => void }) {
  const s = SEV[n.severity]
  return (
    <div
      style={{
        background: s.bg,
        borderLeft: `4px solid ${s.border}`,
        borderRadius: 10,
        padding: '16px 20px',
        marginBottom: 12,
        boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      <div>
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontWeight: 700,
            fontSize: '1rem',
            color: s.color,
            marginBottom: 4,
          }}
        >
          {n.icon} {n.title}
        </div>
        <div style={{ fontFamily: 'var(--font-ui)', fontSize: '0.85rem', color: '#a0a0b8' }}>
          {n.body}
        </div>
      </div>
      <button
        onClick={onDismiss}
        style={{
          background: 'none',
          border: '1px solid #444',
          borderRadius: 6,
          color: '#666',
          cursor: 'pointer',
          fontSize: '0.75rem',
          padding: '3px 10px',
          flexShrink: 0,
          fontFamily: 'var(--font-ui)',
        }}
      >
        Dismiss
      </button>
    </div>
  )
}

export function NotificationsShell({ signals }: { signals: Signals }) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
      if (stored) return new Set(JSON.parse(stored) as string[])
    } catch {
      // localStorage unavailable — ignore
    }
    return new Set()
  })

  function dismiss(key: string) {
    const next = new Set(dismissed)
    next.add(key)
    setDismissed(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
    } catch {}
  }

  const notifications = buildNotifications(signals)
  const unread = notifications.filter((n) => !dismissed.has(n.key))
  const read = notifications.filter((n) => dismissed.has(n.key))

  function dismissAll() {
    const next = new Set(notifications.map((n) => n.key))
    setDismissed(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
    } catch {}
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        {unread.length > 0 ? (
          <span
            style={{
              background: 'linear-gradient(135deg, #cc1a1a, #e82020)',
              color: '#fff',
              borderRadius: 12,
              padding: '2px 12px',
              fontWeight: 700,
              fontFamily: 'var(--font-ui)',
              fontSize: '0.9rem',
            }}
          >
            {unread.length} unread
          </span>
        ) : (
          <span
            style={{
              background: '#1a4a2022',
              color: '#37c85a',
              border: '1px solid #37c85a44',
              borderRadius: 12,
              padding: '2px 12px',
              fontFamily: 'var(--font-ui)',
              fontSize: '0.9rem',
            }}
          >
            All clear
          </span>
        )}
        {unread.length > 1 && (
          <button
            onClick={dismissAll}
            style={{
              background: 'none',
              border: '1px solid #444',
              borderRadius: 6,
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: '0.8rem',
              padding: '3px 12px',
              fontFamily: 'var(--font-ui)',
            }}
          >
            Mark all as read
          </button>
        )}
      </div>

      {notifications.length === 0 && (
        <div
          style={{
            background: SEV.info.bg,
            borderLeft: `4px solid ${SEV.info.border}`,
            borderRadius: 10,
            padding: '16px 20px',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontWeight: 700,
              color: SEV.info.color,
              fontSize: '1rem',
              marginBottom: 4,
            }}
          >
            All Clear
          </div>
          <div style={{ fontFamily: 'var(--font-ui)', color: '#a0a0b8', fontSize: '0.85rem' }}>
            No alerts right now. Everything looks good.
          </div>
        </div>
      )}

      {unread.map((n) => (
        <NotifCard key={n.key} n={n} onDismiss={() => dismiss(n.key)} />
      ))}

      {read.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary
            style={{
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              fontFamily: 'var(--font-ui)',
              fontSize: '0.85rem',
              marginBottom: 8,
              userSelect: 'none',
            }}
          >
            Dismissed ({read.length})
          </summary>
          {read.map((n) => (
            <div
              key={n.key}
              style={{
                background: '#1a1a1a',
                borderLeft: '4px solid #333',
                borderRadius: 10,
                padding: '12px 16px',
                marginBottom: 8,
                opacity: 0.5,
                fontFamily: 'var(--font-ui)',
                color: '#666',
                fontSize: '0.9rem',
              }}
            >
              {n.icon} {n.title}
            </div>
          ))}
        </details>
      )}
    </div>
  )
}
