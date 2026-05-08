'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { FailureListRow } from '@/lib/failures/list'
import { ManualEntryForm } from './ManualEntryForm'
import { PromoteToTestButton } from './PromoteToTestButton'

const STATUS_OPTIONS = ['all', 'open', 'recurring', 'fixed', 'fixing'] as const
const SEVERITY_OPTIONS = ['all', 'critical', 'high', 'medium', 'low'] as const

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'var(--color-critical)',
  high: '#ff7a45',
  medium: '#f5b53c',
  low: '#7d8590',
}

const STATUS_COLOR: Record<string, string> = {
  open: '#ff7a45',
  recurring: 'var(--color-critical)',
  fixing: '#f5b53c',
  fixed: '#3aa66f',
}

function StatCell({
  label,
  value,
  highlight,
}: {
  label: string
  value: string | number
  highlight?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--color-text-disabled)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-pillar-value)',
          fontWeight: 700,
          color: highlight ?? 'var(--color-text-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function SelectControl({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string
  value: string
  options: readonly string[]
  onChange: (v: string) => void
  testId: string
}) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-nano)',
        color: 'var(--color-text-muted)',
      }}
    >
      <span style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        style={{
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-text-primary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 10px',
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
        }}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  )
}

function FailureRow({ row }: { row: FailureListRow }) {
  const [open, setOpen] = useState(false)
  const date = row.last_seen_at.slice(0, 10)
  const numberOrId = row.failure_number ?? row.id.slice(0, 8)

  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '16px 20px',
      }}
      data-testid={`failure-row-${numberOrId}`}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            color: 'var(--color-text-primary)',
            fontSize: 'var(--text-small)',
          }}
        >
          {numberOrId}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-nano)',
            padding: '2px 8px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: STATUS_COLOR[row.status] ?? '#666',
            color: '#fff',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          {row.status}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-nano)',
            padding: '2px 8px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: SEVERITY_COLOR[row.severity] ?? '#666',
            color: '#fff',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          {row.severity}
        </span>
        {row.occurrence_count > 1 && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-critical)',
            }}
          >
            ×{row.occurrence_count}
          </span>
        )}
        <span
          style={{
            flex: 1,
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
          }}
        >
          {row.title}
        </span>
        <span
          style={{
            color: 'var(--color-text-disabled)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-nano)',
          }}
        >
          {date}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          data-testid={`expand-${numberOrId}`}
          style={{
            backgroundColor: 'transparent',
            color: 'var(--color-text-muted)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '4px 10px',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            cursor: 'pointer',
          }}
        >
          {open ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {open && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
          }}
        >
          <div>
            <strong>What:</strong> {row.what_happened}
          </div>
          <div>
            <strong>Root cause:</strong> {row.root_cause ?? <em>Pending analysis</em>}
          </div>
          <div>
            <strong>Fix:</strong> {row.fix_commit_sha ?? <em>Open</em>}
          </div>
          <div>
            <strong>Lesson:</strong> {row.lesson ?? '—'}
          </div>
          <div style={{ marginTop: 8 }}>
            <PromoteToTestButton
              failureId={row.id}
              failureNumber={row.failure_number}
              patternSignature={row.pattern_signature}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export function FailuresShell({
  rows,
  counts,
  initialStatus,
  initialSeverity,
}: {
  rows: FailureListRow[]
  counts: { open: number; recurring: number; fixed: number }
  initialStatus: string
  initialSeverity: string
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [, startTransition] = useTransition()
  const [showForm, setShowForm] = useState(false)

  function setFilter(key: 'status' | 'severity', value: string) {
    const next = new URLSearchParams(params.toString())
    if (value === 'all') next.delete(key)
    else next.set(key, value)
    startTransition(() => router.push(`/failures?${next.toString()}`))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Counts panel */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 16,
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          padding: '20px 24px',
        }}
      >
        <StatCell label="Open / Fixing" value={counts.open} highlight={STATUS_COLOR.open} />
        <StatCell
          label="Recurring"
          value={counts.recurring}
          highlight={counts.recurring > 0 ? STATUS_COLOR.recurring : undefined}
        />
        <StatCell label="Fixed" value={counts.fixed} highlight={STATUS_COLOR.fixed} />
      </div>

      {/* Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <SelectControl
          label="Status"
          value={initialStatus}
          options={STATUS_OPTIONS}
          onChange={(v) => setFilter('status', v)}
          testId="filter-status"
        />
        <SelectControl
          label="Severity"
          value={initialSeverity}
          options={SEVERITY_OPTIONS}
          onChange={(v) => setFilter('severity', v)}
          testId="filter-severity"
        />
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          data-testid="toggle-manual-entry"
          style={{
            backgroundColor: 'var(--color-rail)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 16px',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            cursor: 'pointer',
          }}
        >
          {showForm ? 'Hide manual entry' : 'Manual entry'}
        </button>
      </div>

      {showForm && <ManualEntryForm onSubmitted={() => router.refresh()} />}

      {/* List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              color: 'var(--color-text-disabled)',
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
            }}
            data-testid="empty-state"
          >
            No failures match the current filters.
          </div>
        ) : (
          rows.map((row) => <FailureRow key={row.id} row={row} />)
        )}
      </div>
    </div>
  )
}
