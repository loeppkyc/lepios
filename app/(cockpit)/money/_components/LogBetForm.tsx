'use client'

import { useState, useCallback } from 'react'
import { CockpitInput } from '@/components/cockpit/CockpitInput'
import { CockpitSelect } from '@/components/cockpit/CockpitSelect'
import { kellyPct, americanToImpliedProb } from '@/lib/kelly'
import { BET_TYPE_VALUES } from '@/lib/schemas/bet'

const BET_TYPE_OPTIONS = BET_TYPE_VALUES.map((v) => ({ value: v, label: v.replace('_', ' ') }))

interface LogBetFormProps {
  onSuccess: () => void
}

export function LogBetForm({ onSuccess }: LogBetFormProps) {
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Client-side Kelly preview (not sent to API — for display only)
  const [oddsPreview, setOddsPreview] = useState('')
  const [winProbPct, setWinProbPct] = useState('')

  const kellyPreview = useCallback(() => {
    const odds = parseInt(oddsPreview, 10)
    const wp = parseFloat(winProbPct) / 100
    if (!isNaN(odds) && !isNaN(wp) && wp > 0 && wp < 1) {
      return kellyPct(wp, odds)
    }
    if (!isNaN(odds) && winProbPct === '') {
      // Fall back to implied prob if user hasn't entered win prob
      return kellyPct(americanToImpliedProb(odds), odds)
    }
    return null
  }, [oddsPreview, winProbPct])

  const kp = kellyPreview()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setErrors({})
    setSubmitError(null)

    const fd = new FormData(e.currentTarget)
    const body = {
      bet_date: fd.get('bet_date') as string,
      sport: fd.get('sport') as string || undefined,
      league: fd.get('league') as string || undefined,
      home_team: fd.get('home_team') as string || undefined,
      away_team: fd.get('away_team') as string || undefined,
      bet_on: fd.get('bet_on') as string || undefined,
      bet_type: (fd.get('bet_type') as string) || undefined,
      odds: fd.get('odds') ? Number(fd.get('odds')) : undefined,
      stake: fd.get('stake') ? Number(fd.get('stake')) : undefined,
      bankroll_before: fd.get('bankroll_before') ? Number(fd.get('bankroll_before')) : undefined,
      book: fd.get('book') as string || undefined,
      ai_notes: fd.get('ai_notes') as string || undefined,
    }

    try {
      const res = await fetch('/api/bets', {
        method: 'POST',
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
      data-testid="log-bet-form"
      onSubmit={handleSubmit}
      style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 0 8px' }}
    >
      {/* Row 1: date / sport / league */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <CockpitInput label="Bet date" name="bet_date" type="date" required error={errors.bet_date} />
        <CockpitInput label="Sport" name="sport" placeholder="Hockey" error={errors.sport} />
        <CockpitInput label="League" name="league" placeholder="NHL" error={errors.league} />
      </div>

      {/* Row 2: home / away / bet_on */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <CockpitInput label="Home team" name="home_team" error={errors.home_team} />
        <CockpitInput label="Away team" name="away_team" error={errors.away_team} />
        <CockpitInput label="Bet on" name="bet_on" placeholder="Oilers" error={errors.bet_on} />
      </div>

      {/* Row 3: bet_type / odds / stake */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <CockpitSelect
          label="Bet type"
          name="bet_type"
          options={BET_TYPE_OPTIONS}
          error={errors.bet_type}
        />
        <CockpitInput
          label="Odds (American)"
          name="odds"
          type="number"
          inputMode="numeric"
          placeholder="-150"
          required
          error={errors.odds}
          onChange={(e) => setOddsPreview(e.target.value)}
        />
        <CockpitInput
          label="Stake ($)"
          name="stake"
          type="number"
          inputMode="decimal"
          placeholder="25"
          step="0.01"
          error={errors.stake}
        />
      </div>

      {/* Row 4: bankroll_before / book / win_prob (client-only Kelly input) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <CockpitInput
          label="Bankroll before ($)"
          name="bankroll_before"
          type="number"
          inputMode="decimal"
          placeholder="500"
          step="0.01"
          error={errors.bankroll_before}
        />
        <CockpitInput
          label="Book"
          name="book"
          placeholder="Play Alberta"
          error={errors.book}
        />
        <CockpitInput
          label="Your win prob (%)"
          name="win_prob_pct"
          type="number"
          inputMode="decimal"
          placeholder="65"
          min="1"
          max="99"
          step="0.1"
          onChange={(e) => setWinProbPct(e.target.value)}
        />
      </div>

      {/* Kelly recommendation display */}
      {kp !== null && (
        <div
          data-testid="kelly-rec"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-small)',
            color: kp > 0 ? 'var(--color-positive)' : 'var(--color-text-muted)',
            padding: '6px 10px',
            backgroundColor: 'var(--color-surface-2)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
          }}
        >
          Kelly recommendation:{' '}
          <strong>
            {kp.toFixed(1)}%
          </strong>
          {kp === 0 && (
            <span style={{ color: 'var(--color-text-disabled)', marginLeft: 8 }}>
              (no edge at implied prob)
            </span>
          )}
        </div>
      )}

      {/* ai_notes */}
      <div>
        <label
          htmlFor="ai_notes"
          style={{
            display: 'block',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--color-text-muted)',
            marginBottom: 4,
          }}
        >
          Reasoning / AI notes
        </label>
        <textarea
          id="ai_notes"
          name="ai_notes"
          rows={2}
          placeholder="Why this bet? What's the edge?"
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-body)',
            color: 'var(--color-text-primary)',
            backgroundColor: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-accent)',
            borderRadius: 'var(--radius-md)',
            padding: '6px 10px',
            width: '100%',
            resize: 'vertical',
            outline: 'none',
          }}
        />
      </div>

      {submitError && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-critical)',
            padding: '6px 10px',
            backgroundColor: 'var(--color-critical-dim)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          {submitError}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
        <button
          type="submit"
          disabled={submitting}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--color-base)',
            backgroundColor: submitting ? 'var(--color-text-disabled)' : 'var(--color-accent-gold)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            padding: '8px 20px',
            cursor: submitting ? 'not-allowed' : 'pointer',
            transition: 'background-color var(--transition-fast)',
          }}
        >
          {submitting ? 'Logging…' : 'Log Bet'}
        </button>
      </div>
    </form>
  )
}
