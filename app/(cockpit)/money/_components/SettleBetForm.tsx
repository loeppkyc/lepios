'use client'

import { useState } from 'react'
import { CockpitInput } from '@/components/cockpit/CockpitInput'
import { CockpitSelect } from '@/components/cockpit/CockpitSelect'

const RESULT_OPTIONS = [
  { value: 'win', label: 'Win' },
  { value: 'loss', label: 'Loss' },
  { value: 'push', label: 'Push' },
]

interface SettleBetFormProps {
  betId: string
  stake: number | null
  onSuccess: () => void
  onCancel: () => void
}

export function SettleBetForm({ betId, stake, onSuccess, onCancel }: SettleBetFormProps) {
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState('')
  const [pnl, setPnl] = useState('')

  function autoCalcPnl(res: string, odds: string) {
    // Simple auto-calc for moneyline: user can override
    if (res === 'push') { setPnl('0'); return }
    if (!stake || !odds) return
    const o = parseInt(odds, 10)
    if (isNaN(o)) return
    if (res === 'win') {
      const profit = o < 0 ? stake * (100 / Math.abs(o)) : stake * (o / 100)
      setPnl(profit.toFixed(2))
    } else if (res === 'loss') {
      setPnl((-stake).toFixed(2))
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setErrors({})
    setSubmitError(null)

    const fd = new FormData(e.currentTarget)
    const body = {
      result: fd.get('result') as string,
      pnl: Number(fd.get('pnl')),
      bankroll_after: Number(fd.get('bankroll_after')),
    }

    try {
      const res = await fetch(`/api/bets/${betId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.status === 401) {
        setSubmitError('Not logged in — Sprint 5 will wire auth.')
        return
      }

      const json = await res.json()

      if (res.status === 400) {
        const fieldErrors: Record<string, string> = {}
        for (const issue of json.issues ?? []) {
          const field = issue.path?.[0]
          if (field) fieldErrors[field] = issue.message
        }
        setErrors(fieldErrors)
        return
      }

      if (!res.ok) {
        setSubmitError(json.error ?? 'Unknown error')
        return
      }

      onSuccess()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      data-testid="settle-bet-form"
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '12px 16px',
        backgroundColor: 'var(--color-surface-2)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        marginTop: 8,
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <CockpitSelect
          label="Result"
          name="result"
          options={RESULT_OPTIONS}
          required
          error={errors.result}
          value={result}
          onChange={(e) => {
            setResult(e.target.value)
            const oddsInput = (e.currentTarget.closest('form') as HTMLFormElement)
              ?.querySelector<HTMLInputElement>('[name="closing_odds"]')
            autoCalcPnl(e.target.value, oddsInput?.value ?? '')
          }}
        />
        <CockpitInput
          label="P&L ($)"
          name="pnl"
          type="number"
          inputMode="decimal"
          step="0.01"
          required
          error={errors.pnl}
          value={pnl}
          onChange={(e) => setPnl(e.target.value)}
        />
        <CockpitInput
          label="Bankroll after ($)"
          name="bankroll_after"
          type="number"
          inputMode="decimal"
          step="0.01"
          required
          error={errors.bankroll_after}
        />
      </div>

      {submitError && (
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-critical)',
          }}
        >
          {submitError}
        </span>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--color-text-muted)',
            backgroundColor: 'transparent',
            border: '1px solid var(--color-border-accent)',
            borderRadius: 'var(--radius-md)',
            padding: '5px 14px',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--color-base)',
            backgroundColor: submitting ? 'var(--color-text-disabled)' : 'var(--color-positive)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            padding: '5px 14px',
            cursor: submitting ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? 'Saving…' : 'Settle'}
        </button>
      </div>
    </form>
  )
}
