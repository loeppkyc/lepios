'use client'

import { useState } from 'react'

const FAILURE_TYPES = [
  'manual',
  'test-fail',
  'route-500',
  'silent-skip',
  'cron-skip',
  'auth-leak',
  'cross-system-drift',
  'migration-error',
] as const

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'ok'; failure_number: string; is_recurrence: boolean }
  | { kind: 'error'; error: string }

export function ManualEntryForm({ onSubmitted }: { onSubmitted?: () => void }) {
  const [title, setTitle] = useState('')
  const [whatHappened, setWhatHappened] = useState('')
  const [rootCause, setRootCause] = useState('')
  const [lesson, setLesson] = useState('')
  const [type, setType] = useState<(typeof FAILURE_TYPES)[number]>('manual')
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>('medium')
  const [errorMessage, setErrorMessage] = useState('')
  const [state, setState] = useState<SubmitState>({ kind: 'idle' })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !whatHappened.trim()) {
      setState({ kind: 'error', error: 'Title and what_happened required' })
      return
    }
    setState({ kind: 'submitting' })
    try {
      const res = await fetch('/api/failures/log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          trigger_context: 'manual',
          what_happened: whatHappened.trim(),
          root_cause: rootCause.trim() || null,
          lesson: lesson.trim() || null,
          severity,
          signature_input: {
            type,
            error_message: errorMessage.trim() || undefined,
            free_text: title + ' ' + whatHappened,
          },
        }),
      })
      const body = (await res.json()) as {
        ok: boolean
        failure_number?: string
        is_recurrence?: boolean
        error?: string
      }
      if (!res.ok || !body.ok) {
        setState({ kind: 'error', error: body.error ?? `HTTP ${res.status}` })
        return
      }
      setState({
        kind: 'ok',
        failure_number: body.failure_number ?? '',
        is_recurrence: body.is_recurrence ?? false,
      })
      // Clear inputs on success
      setTitle('')
      setWhatHappened('')
      setRootCause('')
      setLesson('')
      setErrorMessage('')
      onSubmitted?.()
    } catch (err) {
      setState({ kind: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }

  const inputStyle: React.CSSProperties = {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '8px 12px',
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    width: '100%',
  }

  const labelStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-nano)',
    color: 'var(--color-text-muted)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  }

  return (
    <form
      onSubmit={submit}
      data-testid="manual-entry-form"
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-primary)',
          fontWeight: 600,
        }}
      >
        Manual entry — log a failure the system missed
      </div>

      <label style={labelStyle}>
        Title
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Short summary"
          data-testid="entry-title"
          style={inputStyle}
        />
      </label>

      <label style={labelStyle}>
        What happened
        <textarea
          value={whatHappened}
          onChange={(e) => setWhatHappened(e.target.value)}
          placeholder="Describe the failure"
          rows={3}
          data-testid="entry-what-happened"
          style={{ ...inputStyle, fontFamily: 'var(--font-ui)' }}
        />
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <label style={labelStyle}>
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value as (typeof FAILURE_TYPES)[number])}
            data-testid="entry-type"
            style={inputStyle}
          >
            {FAILURE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          Severity
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as (typeof SEVERITIES)[number])}
            data-testid="entry-severity"
            style={inputStyle}
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          Error message (optional)
          <input
            type="text"
            value={errorMessage}
            onChange={(e) => setErrorMessage(e.target.value)}
            placeholder="TypeError: ..."
            data-testid="entry-error-message"
            style={inputStyle}
          />
        </label>
      </div>

      <label style={labelStyle}>
        Root cause (optional)
        <textarea
          value={rootCause}
          onChange={(e) => setRootCause(e.target.value)}
          rows={2}
          data-testid="entry-root-cause"
          style={{ ...inputStyle, fontFamily: 'var(--font-ui)' }}
        />
      </label>

      <label style={labelStyle}>
        Lesson — what to do differently (optional)
        <textarea
          value={lesson}
          onChange={(e) => setLesson(e.target.value)}
          rows={2}
          data-testid="entry-lesson"
          style={{ ...inputStyle, fontFamily: 'var(--font-ui)' }}
        />
      </label>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="submit"
          disabled={state.kind === 'submitting'}
          data-testid="entry-submit"
          style={{
            backgroundColor: 'var(--color-rail)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 20px',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            cursor: state.kind === 'submitting' ? 'wait' : 'pointer',
          }}
        >
          {state.kind === 'submitting' ? 'Saving…' : 'Log failure'}
        </button>
        {state.kind === 'ok' && (
          <span
            data-testid="entry-success"
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: '#3aa66f',
            }}
          >
            ✓ Saved as {state.failure_number}
            {state.is_recurrence ? ' (recurrence detected)' : ''}
          </span>
        )}
        {state.kind === 'error' && (
          <span
            data-testid="entry-error"
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-critical)',
            }}
          >
            ⚠ {state.error}
          </span>
        )}
      </div>
    </form>
  )
}
