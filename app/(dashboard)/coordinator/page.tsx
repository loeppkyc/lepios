/**
 * Coordinator cockpit — live queue depth, active task, halt state.
 * Server component. Force-dynamic so every load reads fresh task_queue data.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { getCoordinatorQueueStats, type HarnessState } from '@/lib/metrics/rollups'

export const dynamic = 'force-dynamic'

// ── Tile + section primitives (same pattern as /autonomous) ───────────────────

function Tile({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: string
}) {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '14px 18px',
        flex: 1,
        minWidth: 120,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--color-text-disabled)',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.6rem',
          fontWeight: 700,
          color: accent ?? 'var(--color-text-primary)',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
            marginTop: 4,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  )
}

// ── Recent task row ───────────────────────────────────────────────────────────

type TaskRow = {
  id: string
  task: string | null
  status: string
  priority: number | null
  source: string | null
  created_at: string
  completed_at: string | null
}

function statusColor(status: string): string {
  switch (status) {
    case 'queued':
      return 'var(--color-info)'
    case 'claimed':
    case 'running':
      return 'var(--color-warning)'
    case 'completed':
      return 'var(--color-positive)'
    case 'failed':
      return 'var(--color-critical)'
    default:
      return 'var(--color-text-disabled)'
  }
}

function TaskList({ tasks }: { tasks: TaskRow[] }) {
  if (!tasks.length) {
    return (
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-disabled)',
          padding: '16px 0',
        }}
      >
        No tasks
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {tasks.map((t) => (
        <div
          key={t.id}
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          {/* Status dot */}
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: statusColor(t.status),
              marginTop: 5,
              flexShrink: 0,
              boxShadow:
                t.status === 'running' || t.status === 'claimed'
                  ? `0 0 6px ${statusColor(t.status)}`
                  : 'none',
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                color: 'var(--color-text-primary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {t.task ?? '(no description)'}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-nano)',
                color: 'var(--color-text-disabled)',
                marginTop: 2,
                display: 'flex',
                gap: 10,
              }}
            >
              <span style={{ color: statusColor(t.status) }}>{t.status}</span>
              {t.source && <span>via {t.source}</span>}
              {t.priority != null && <span>p{t.priority}</span>}
              <span>{t.id.slice(0, 8)}</span>
            </div>
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
              flexShrink: 0,
            }}
          >
            {new Date(t.created_at).toLocaleTimeString('en-CA', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function harnessStateAccent(state: HarnessState): string | undefined {
  switch (state) {
    case 'RUNNING':
      return 'var(--color-positive)'
    case 'STALLED':
      return 'var(--color-warning)'
    case 'HALTED':
      return 'var(--color-critical)'
    case 'IDLE':
    default:
      return undefined
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function CoordinatorPage() {
  const db = createServiceClient()

  const [stats, { data: recentRaw }] = await Promise.all([
    getCoordinatorQueueStats(),
    db
      .from('task_queue')
      .select('id, task, status, priority, source, created_at, completed_at')
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const recent = (recentRaw ?? []) as TaskRow[]

  const stateChangedSub = (() => {
    if (!stats.stateChangedAt) return `${stats.running} running · ${stats.queued} queued`
    const ms = Date.now() - new Date(stats.stateChangedAt).getTime()
    const m = Math.floor(ms / 60_000)
    const since = m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`
    return `since ${since} · ${stats.running} running · ${stats.queued} queued`
  })()

  const live = recent.filter(
    (t) => t.status === 'queued' || t.status === 'claimed' || t.status === 'running'
  )
  const done = recent.filter((t) => t.status === 'completed' || t.status === 'failed')

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--color-base)',
        padding: '24px',
        maxWidth: 900,
        margin: '0 auto',
      }}
    >
      {/* Rail */}
      <div
        style={{
          height: 2,
          backgroundColor: 'var(--color-rail)',
          boxShadow: '0 0 12px var(--color-rail-glow)',
          marginBottom: 24,
        }}
      />

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-heading)',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              margin: 0,
            }}
          >
            Coordinator
          </h1>
          {stats.halted && (
            <span
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--color-critical)',
                border: '1px solid var(--color-critical)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 8px',
              }}
            >
              HALTED
            </span>
          )}
        </div>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
            margin: '4px 0 0',
          }}
        >
          {stats.halted
            ? 'Loop halted — /resume via Telegram to re-enable'
            : 'Loop enabled — tasks picked up at 09:00 MT or via /run'}
        </p>
      </div>

      {/* Queue stats scorecard */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <Tile
          label="Queued"
          value={String(stats.queued)}
          sub="awaiting pickup"
          accent={stats.queued > 0 ? 'var(--color-info)' : undefined}
        />
        <Tile
          label="Running"
          value={String(stats.running)}
          sub="claimed + in-flight"
          accent={stats.running > 0 ? 'var(--color-warning)' : undefined}
        />
        <Tile
          label="Completed today"
          value={String(stats.completedToday)}
          accent={stats.completedToday > 0 ? 'var(--color-positive)' : undefined}
        />
        <Tile
          label="Failed today"
          value={String(stats.failedToday)}
          accent={stats.failedToday > 0 ? 'var(--color-critical)' : undefined}
        />
        <Tile
          label="Loop state"
          value={stats.state}
          sub={stateChangedSub}
          accent={harnessStateAccent(stats.state)}
        />
      </div>

      {/* Live queue */}
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: '16px 20px',
          marginBottom: 16,
        }}
      >
        <div style={{ marginBottom: 12 }}>
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              fontWeight: 600,
              color: 'var(--color-text-secondary)',
            }}
          >
            Live queue
          </span>
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
              marginLeft: 8,
            }}
          >
            queued + running
          </span>
        </div>
        <TaskList tasks={live} />
      </div>

      {/* Recent completions */}
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: '16px 20px',
        }}
      >
        <div style={{ marginBottom: 12 }}>
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              fontWeight: 600,
              color: 'var(--color-text-secondary)',
            }}
          >
            Recent
          </span>
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
              marginLeft: 8,
            }}
          >
            last 20 completed/failed
          </span>
        </div>
        <TaskList tasks={done} />
      </div>
    </div>
  )
}
