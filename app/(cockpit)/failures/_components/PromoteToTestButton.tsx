'use client'

import { useState } from 'react'

type PromoteState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'ok'; test_path: string }
  | { kind: 'error'; error: string }

export function PromoteToTestButton({
  failureId,
  failureNumber,
  patternSignature,
}: {
  failureId: string
  failureNumber: string | null
  patternSignature: Record<string, unknown>
}) {
  const [state, setState] = useState<PromoteState>({ kind: 'idle' })

  async function promote() {
    setState({ kind: 'submitting' })
    try {
      const res = await fetch('/api/failures/promote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          failure_id: failureId,
          failure_number: failureNumber,
          pattern_signature: patternSignature,
        }),
      })
      const body = (await res.json()) as { ok: boolean; test_path?: string; error?: string }
      if (!res.ok || !body.ok) {
        setState({ kind: 'error', error: body.error ?? `HTTP ${res.status}` })
        return
      }
      setState({ kind: 'ok', test_path: body.test_path ?? '(unknown)' })
    } catch (err) {
      setState({ kind: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <button
        type="button"
        onClick={promote}
        disabled={state.kind === 'submitting'}
        data-testid={`promote-${failureNumber ?? failureId.slice(0, 8)}`}
        style={{
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-text-primary)',
          border: '1px solid var(--color-rail)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 14px',
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          cursor: state.kind === 'submitting' ? 'wait' : 'pointer',
        }}
      >
        {state.kind === 'submitting' ? 'Generating…' : 'Promote to harness test'}
      </button>
      {state.kind === 'ok' && (
        <span
          data-testid="promote-success"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-nano)',
            color: '#3aa66f',
          }}
        >
          ✓ {state.test_path}
        </span>
      )}
      {state.kind === 'error' && (
        <span
          data-testid="promote-error"
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-critical)',
          }}
        >
          ⚠ {state.error}
        </span>
      )}
    </div>
  )
}
