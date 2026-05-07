'use client'

import { useCallback, useEffect, useState } from 'react'
import type { SavingsGoalsResponse, SavingsGoal } from '@/app/api/savings-goals/route'

const fmt = (n: number) =>
  n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

export function SavingsGoalsPage() {
  const [data, setData] = useState<SavingsGoalsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [date, setDate] = useState('')
  const [linkedTo, setLinkedTo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/savings-goals')
      const j = (await r.json()) as SavingsGoalsResponse & { error?: string }
      if (j.error) throw new Error(j.error)
      setData(j)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const submit = async () => {
    if (!name.trim() || !target || !date) {
      setError('Name, target amount, and target date are required')
      return
    }
    setAdding(true)
    setError(null)
    try {
      const r = await fetch('/api/savings-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          target_amount: parseFloat(target),
          target_date: date,
          linked_entry_name: linkedTo.trim() || null,
        }),
      })
      const j = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      setName('')
      setTarget('')
      setDate('')
      setLinkedTo('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAdding(false)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this goal?')) return
    await fetch(`/api/savings-goals?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div
      style={{
        padding: '28px 32px',
        maxWidth: 1080,
        margin: '0 auto',
        fontFamily: 'var(--font-ui)',
      }}
    >
      <h1
        style={{
          fontFamily: 'var(--font-display, var(--font-ui))',
          fontSize: '1.15rem',
          fontWeight: 800,
          letterSpacing: '0.06em',
          color: 'var(--color-text-primary)',
          textTransform: 'uppercase',
          margin: 0,
        }}
      >
        Savings Goals
      </h1>
      <p
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-muted)',
          margin: '6px 0 24px',
        }}
      >
        Targets tracked against linked balance sheet rows (FHSA, RRSP, TFSA, Personal Savings).
      </p>

      {loading && (
        <div style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)' }}>
          Loading…
        </div>
      )}
      {error && <div style={{ color: '#e5534b', fontSize: 'var(--text-small)' }}>{error}</div>}

      {data && !loading && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
            <Kpi label="Total Targets" value={fmt(data.totalTargets)} />
            <Kpi
              label="Current Balance"
              value={fmt(data.totalCurrent)}
              color="var(--color-pillar-health)"
            />
            <Kpi label="Overall Progress" value={`${Math.round(data.totalProgressPct)}%`} />
          </div>

          {/* Add form */}
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '14px 18px',
              marginBottom: 24,
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <input
              type="text"
              placeholder="Goal name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle({ flex: '2 1 200px' })}
            />
            <input
              type="number"
              step="0.01"
              placeholder="Target $"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              style={inputStyle({ width: 130, textAlign: 'right' })}
            />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={inputStyle({ width: 150 })}
            />
            <input
              type="text"
              placeholder="Linked account (e.g. FHSA)"
              value={linkedTo}
              onChange={(e) => setLinkedTo(e.target.value)}
              style={inputStyle({ flex: '1 1 180px' })}
            />
            <button
              onClick={() => void submit()}
              disabled={adding}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.7rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                padding: '6px 14px',
                background: adding ? 'var(--color-surface-2)' : 'var(--color-accent-gold)',
                color: adding ? 'var(--color-text-disabled)' : '#000',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: adding ? 'not-allowed' : 'pointer',
              }}
            >
              {adding ? 'Adding…' : 'Add Goal'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.goals.map((g) => (
              <GoalCard key={g.id} g={g} onDelete={() => void remove(g.id)} />
            ))}
            {data.goals.length === 0 && (
              <div
                style={{
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-disabled)',
                  padding: '20px',
                  textAlign: 'center',
                }}
              >
                No goals yet. Add one above.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function GoalCard({ g, onDelete }: { g: SavingsGoal; onDelete: () => void }) {
  const statusColor =
    g.status === 'achieved'
      ? 'var(--color-pillar-health)'
      : g.status === 'behind'
        ? '#e5534b'
        : 'var(--color-accent-gold)'

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '16px 20px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div
            style={{
              fontFamily: 'var(--font-display, var(--font-ui))',
              fontSize: '1rem',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
            }}
          >
            {g.name}
          </div>
          <div
            style={{
              fontSize: '0.7rem',
              color: 'var(--color-text-disabled)',
              marginTop: 3,
            }}
          >
            {g.linked_entry_name ? `Linked: ${g.linked_entry_name}` : 'No linked account'} · target
            by {g.target_date}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span
            style={{
              fontSize: '0.62rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: statusColor,
              padding: '4px 8px',
              border: `1px solid ${statusColor}`,
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {g.status.replace('_', ' ')}
          </span>
          <button
            onClick={onDelete}
            style={{
              fontSize: '0.62rem',
              padding: '3px 8px',
              background: 'none',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-disabled)',
              cursor: 'pointer',
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 10 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.72rem',
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
            marginBottom: 4,
          }}
        >
          <span>
            {fmt(g.currentBalance)} of {fmt(g.target_amount)}
          </span>
          <span>{Math.round(g.progressPct)}%</span>
        </div>
        <div
          style={{
            height: 8,
            background: 'var(--color-surface-2)',
            borderRadius: 4,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${Math.min(100, g.progressPct)}%`,
              background: statusColor,
              borderRadius: 4,
            }}
          />
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 24,
          fontSize: '0.7rem',
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-mono)',
          flexWrap: 'wrap',
        }}
      >
        <span>{g.daysRemaining} days remaining</span>
        {g.monthlyNeeded > 0 && (
          <span>
            Need{' '}
            <strong style={{ color: 'var(--color-accent-gold)' }}>{fmt(g.monthlyNeeded)}/mo</strong>{' '}
            to reach target
          </span>
        )}
      </div>

      {g.notes && (
        <div
          style={{
            fontSize: '0.7rem',
            color: 'var(--color-text-disabled)',
            marginTop: 8,
            lineHeight: 1.5,
          }}
        >
          {g.notes}
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        padding: '14px 18px',
        minWidth: 160,
        flex: 1,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.3rem',
          fontWeight: 700,
          color: color ?? 'var(--color-accent-gold)',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: '0.65rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--color-text-disabled)',
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  )
}

function inputStyle(extra: React.CSSProperties): React.CSSProperties {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.78rem',
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text-primary)',
    padding: '5px 9px',
    ...extra,
  }
}
