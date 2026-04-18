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
  odds: number | null
  onSuccess: () => void
  onCancel: () => void
  onNotLoggedIn: (betId: string) => void
}

export function SettleBetForm({ betId, stake, odds, onSuccess, onCancel, onNotLoggedIn }: SettleBetFormProps) {
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState('')
  const [pnl, setPnl] = useState('')

  function autoCalcPnl(res: string) {
    if (res === 'push') { setPnl('0'); return }
    if (!stake || !odds) return
    if (res === 'win') {
      const profit = odds < 0 ? stake * (100 / Math.abs(odds)) : stake * (odds / 100)
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
        onNotLoggedIn(betId)
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
            autoCalcPnl(e.target.value)
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
          hint="Auto-calculated for moneyline bets. Override for spreads/parlays."
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
