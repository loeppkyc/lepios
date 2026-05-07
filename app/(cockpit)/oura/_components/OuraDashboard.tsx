'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { OuraDailyRow } from '@/lib/oura/sync'
import { useDevMode } from '@/lib/hooks/useDevMode'
import { DebugSection } from '@/components/cockpit/DebugSection'
import { OuraScoreRow } from './OuraScoreRow'
import { OuraScoreTrends } from './OuraScoreTrends'
import { OuraSleepBreakdown } from './OuraSleepBreakdown'
import { OuraRawTable } from './OuraRawTable'

type TabId = 'scores' | 'sleep' | 'raw'

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'scores', label: 'Score Trends' },
  { id: 'sleep', label: 'Sleep Breakdown' },
  { id: 'raw', label: 'Raw Data' },
]

const SYNC_DAYS = [7, 14, 30] as const

export function OuraDashboard({ rows }: { rows: OuraDailyRow[] }) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabId>('scores')
  const [syncDays, setSyncDays] = useState<number>(7)
  const [syncStatus, setSyncStatus] = useState<{ message: string; tone: 'ok' | 'error' } | null>(
    null
  )
  const [isSyncing, setIsSyncing] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [devMode] = useDevMode()

  async function handleSync() {
    setIsSyncing(true)
    setSyncStatus(null)
    try {
      const res = await fetch(`/api/oura/sync?days=${syncDays}`, { method: 'POST' })
      const body = (await res.json()) as { ok?: boolean; days?: number; error?: string }
      if (!res.ok || !body.ok) {
        setSyncStatus({ message: body.error ?? `HTTP ${res.status}`, tone: 'error' })
      } else {
        setSyncStatus({
          message: `Synced ${body.days ?? 0} days. Refreshing…`,
          tone: 'ok',
        })
        startTransition(() => router.refresh())
      }
    } catch (err) {
      setSyncStatus({ message: err instanceof Error ? err.message : String(err), tone: 'error' })
    } finally {
      setIsSyncing(false)
    }
  }

  const noData = rows.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Sync controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 4 }}>
          {SYNC_DAYS.map((d) => {
            const active = syncDays === d
            return (
              <button
                key={d}
                onClick={() => setSyncDays(d)}
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  padding: '6px 10px',
                  background: active ? 'var(--color-surface-2)' : 'none',
                  color: active ? 'var(--color-pillar-health)' : 'var(--color-text-muted)',
                  border: `1px solid ${
                    active ? 'var(--color-pillar-health)' : 'var(--color-border)'
                  }`,
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                }}
              >
                {d}d
              </button>
            )
          })}
        </div>
        <button
          onClick={handleSync}
          disabled={isSyncing || isPending}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            padding: '7px 14px',
            background: 'var(--color-pillar-health)',
            color: 'var(--color-base)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: isSyncing || isPending ? 'not-allowed' : 'pointer',
            opacity: isSyncing || isPending ? 0.6 : 1,
          }}
        >
          {isSyncing ? 'Syncing…' : isPending ? 'Refreshing…' : 'Sync from Oura'}
        </button>
        {syncStatus && (
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color:
                syncStatus.tone === 'error'
                  ? 'var(--color-critical)'
                  : 'var(--color-pillar-health)',
            }}
          >
            {syncStatus.message}
          </span>
        )}
      </div>

      {/* Latest scores row (always visible) */}
      <OuraScoreRow rows={rows} />

      {/* Tabs */}
      <div>
        <div
          role="tablist"
          style={{
            display: 'flex',
            gap: 0,
            borderBottom: '1px solid var(--color-border)',
            marginBottom: 16,
          }}
        >
          {TABS.map((t) => {
            const active = activeTab === t.id
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(t.id)}
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  fontWeight: active ? 700 : 500,
                  letterSpacing: '0.04em',
                  padding: '10px 16px',
                  background: 'none',
                  color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                  border: 'none',
                  borderBottom: active
                    ? '2px solid var(--color-pillar-health)'
                    : '2px solid transparent',
                  marginBottom: -1,
                  cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {noData ? (
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              padding: '24px',
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-text-disabled)',
            }}
          >
            No Oura data yet. Click <strong>Sync from Oura</strong> to pull from the ring.
          </div>
        ) : (
          <>
            {activeTab === 'scores' && <OuraScoreTrends rows={rows} />}
            {activeTab === 'sleep' && <OuraSleepBreakdown rows={rows} />}
            {activeTab === 'raw' && <OuraRawTable rows={rows} />}
          </>
        )}
      </div>

      {devMode && (
        <DebugSection heading="Debug — Oura Dashboard">
          <pre
            style={{
              color: 'var(--color-text-primary)',
              fontSize: 'var(--text-nano)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {JSON.stringify(
              {
                rowCount: rows.length,
                first: rows[0],
                last: rows[rows.length - 1],
                activeTab,
                syncDays,
              },
              null,
              2
            )}
          </pre>
        </DebugSection>
      )}
    </div>
  )
}
