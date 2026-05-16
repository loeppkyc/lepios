'use client'

import { useState } from 'react'
import { CockpitInput } from '@/components/cockpit/CockpitInput'
import { CockpitSelect } from '@/components/cockpit/CockpitSelect'

const SPORT_OPTIONS = [
  { value: 'NFL', label: 'NFL' },
  { value: 'NBA', label: 'NBA' },
  { value: 'NHL', label: 'NHL' },
  { value: 'MLB', label: 'MLB' },
  { value: 'MLS', label: 'MLS' },
  { value: 'CFL', label: 'CFL' },
  { value: 'UFC', label: 'UFC' },
  { value: 'Other', label: 'Other' },
]

interface LogPredictionFormProps {
  onSuccess: () => void
}

export function LogPredictionForm({ onSuccess }: LogPredictionFormProps) {
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [confidence, setConfidence] = useState(5)
  const [notesLen, setNotesLen] = useState(0)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setErrors({})
    setSubmitError(null)
    setSuccessMsg(null)

    const fd = new FormData(e.currentTarget)
    const body = {
      sport: fd.get('sport') as string,
      event_desc: fd.get('event_desc') as string,
      prediction: fd.get('prediction') as string,
      confidence: Number(fd.get('confidence')),
      game_date: fd.get('game_date') as string,
      notes: (fd.get('notes') as string) || undefined,
    }

    try {
      const res = await fetch('/api/predictions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.status === 401) {
        setSubmitError('Not logged in — sign in to log predictions.')
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

      setSuccessMsg('Prediction logged — settle it after the game.')
      ;(e.target as HTMLFormElement).reset()
      setConfidence(5)
      setNotesLen(0)
      onSuccess()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      data-testid="log-prediction-form"
      onSubmit={handleSubmit}
      style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 0 8px' }}
    >
      {/* Row 1: sport / game_date */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <CockpitSelect
          label="Sport"
          name="sport"
          options={SPORT_OPTIONS}
          required
          error={errors.sport}
        />
        <CockpitInput
          label="Game date"
          name="game_date"
          type="date"
          required
          error={errors.game_date}
        />
      </div>

      {/* Row 2: event_desc */}
      <CockpitInput
        label="Event description"
        name="event_desc"
        placeholder='e.g. "Chiefs vs Ravens, AFC Championship"'
        required
        error={errors.event_desc}
      />

      {/* Row 3: prediction */}
      <CockpitInput
        label="My prediction"
        name="prediction"
        placeholder='e.g. "Chiefs win 24-17"'
        required
        error={errors.prediction}
      />

      {/* Row 4: confidence slider */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <label
            htmlFor="confidence-slider"
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: errors.confidence ? 'var(--color-critical)' : 'var(--color-text-muted)',
            }}
          >
            Confidence
          </label>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-body)',
              fontWeight: 700,
              color:
                confidence >= 8
                  ? 'var(--color-positive)'
                  : confidence >= 5
                    ? 'var(--color-warning)'
                    : 'var(--color-critical)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {confidence} / 10
          </span>
        </div>
        <input
          id="confidence-slider"
          type="range"
          name="confidence"
          min={1}
          max={10}
          step={1}
          value={confidence}
          onChange={(e) => setConfidence(Number(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--color-accent-gold)', cursor: 'pointer' }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
          }}
        >
          <span>1 — Low</span>
          <span>10 — High</span>
        </div>
        {errors.confidence && (
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-critical)',
            }}
          >
            {errors.confidence}
          </span>
        )}
      </div>

      {/* Row 5: notes */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <label
            htmlFor="prediction-notes"
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: errors.notes ? 'var(--color-critical)' : 'var(--color-text-muted)',
            }}
          >
            Notes (optional)
          </label>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-nano)',
              color: notesLen > 480 ? 'var(--color-warning)' : 'var(--color-text-disabled)',
            }}
          >
            {notesLen} / 500
          </span>
        </div>
        <textarea
          id="prediction-notes"
          name="notes"
          rows={2}
          maxLength={500}
          placeholder="Why this prediction? What's your reasoning?"
          onChange={(e) => setNotesLen(e.target.value.length)}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-body)',
            color: 'var(--color-text-primary)',
            backgroundColor: 'var(--color-surface-2)',
            border: `1px solid ${errors.notes ? 'var(--color-critical)' : 'var(--color-border-accent)'}`,
            borderRadius: 'var(--radius-md)',
            padding: '6px 10px',
            width: '100%',
            resize: 'vertical',
            outline: 'none',
          }}
        />
        {errors.notes && (
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-critical)',
            }}
          >
            {errors.notes}
          </span>
        )}
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

      {successMsg && (
        <div
          data-testid="prediction-logged-success"
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-positive)',
            padding: '6px 10px',
            backgroundColor: 'var(--color-positive-dim)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          {successMsg}
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
          {submitting ? 'Logging...' : 'Log Prediction'}
        </button>
      </div>
    </form>
  )
}
