'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveUtilityBill } from '../actions'

interface Props {
  /** Pre-fill form fields when editing an existing month */
  prefill?: {
    month: string
    kwh: number
    amount: number
    provider: string
    notes: string
  }
}

/** Normalize single-digit month to two digits: "2025-3" → "2025-03" */
function normalizeMonth(month: string): string {
  const trimmed = month.trim()
  const parts = trimmed.split('-')
  if (parts.length !== 2) return trimmed
  const [year, mon] = parts
  return `${year}-${mon.padStart(2, '0')}`
}

export function UtilityEntryForm({ prefill }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [month, setMonth] = useState(prefill?.month ?? '')
  const [kwh, setKwh] = useState(prefill?.kwh?.toString() ?? '')
  const [amount, setAmount] = useState(prefill?.amount?.toString() ?? '')
  const [provider, setProvider] = useState(prefill?.provider ?? 'Metergy')
  const [notes, setNotes] = useState(prefill?.notes ?? '')
  const [clientError, setClientError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  function validateClient(): string | null {
    const normalized = normalizeMonth(month)
    if (!/^\d{4}-\d{2}$/.test(normalized)) {
      return 'Month must be YYYY-MM format (e.g. 2026-01).'
    }
    const kwhNum = parseFloat(kwh)
    if (isNaN(kwhNum) || kwhNum < 0) {
      return 'kWh must be a number ≥ 0.'
    }
    const amountNum = parseFloat(amount)
    if (isNaN(amountNum) || amountNum < 0) {
      return 'Amount must be a number ≥ 0.'
    }
    return null
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setClientError(null)
    setServerError(null)
    setSuccessMsg(null)

    const validationError = validateClient()
    if (validationError) {
      setClientError(validationError)
      return
    }

    const normalizedMonth = normalizeMonth(month)

    startTransition(async () => {
      const result = await saveUtilityBill({
        month: normalizedMonth,
        kwh: parseFloat(kwh),
        amount: parseFloat(amount),
        provider: provider.trim() || 'Metergy',
        notes: notes.trim(),
      })

      if (!result.ok) {
        setServerError(result.error)
        return
      }

      setSuccessMsg(`Saved ${normalizedMonth}.`)
      router.refresh()
    })
  }

  const inputStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-body)',
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '6px 10px',
    width: '100%',
    outline: 'none',
  }

  const labelStyle: React.CSSProperties = {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    color: 'var(--color-text-muted)',
    display: 'block',
    marginBottom: 4,
  }

  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        padding: '20px 24px',
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
            color: 'var(--color-pillar-growing)',
          }}
        >
          Add / Update a Month
        </span>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            margin: '4px 0 0',
          }}
        >
          Enter data from a Metergy statement. Existing months are updated automatically.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 16,
            marginBottom: 16,
          }}
        >
          {/* Month */}
          <div>
            <label htmlFor="util-month" style={labelStyle}>
              Month (YYYY-MM)
            </label>
            <input
              id="util-month"
              type="text"
              placeholder="2026-01"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              style={inputStyle}
              autoComplete="off"
            />
          </div>

          {/* kWh */}
          <div>
            <label htmlFor="util-kwh" style={labelStyle}>
              kWh
            </label>
            <input
              id="util-kwh"
              type="number"
              min="0"
              step="0.01"
              placeholder="456"
              value={kwh}
              onChange={(e) => setKwh(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Amount */}
          <div>
            <label htmlFor="util-amount" style={labelStyle}>
              Amount ($)
            </label>
            <input
              id="util-amount"
              type="number"
              min="0"
              step="0.01"
              placeholder="78.90"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Provider — free-text with default "Metergy" */}
          <div>
            <label htmlFor="util-provider" style={labelStyle}>
              Provider
            </label>
            <input
              id="util-provider"
              type="text"
              placeholder="Metergy"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Notes */}
          <div style={{ gridColumn: 'span 2' }}>
            <label htmlFor="util-notes" style={labelStyle}>
              Notes (optional)
            </label>
            <input
              id="util-notes"
              type="text"
              placeholder="e.g. Mar 2026 billing"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isPending}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            fontWeight: 600,
            letterSpacing: '0.06em',
            padding: '8px 20px',
            backgroundColor: isPending ? 'var(--color-surface-2)' : 'var(--color-pillar-growing)',
            color: isPending ? 'var(--color-text-disabled)' : 'var(--color-base)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: isPending ? 'not-allowed' : 'pointer',
            transition: 'var(--transition-fast)',
          }}
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
      </form>

      {/* Inline error / success — never a toast */}
      {(clientError || serverError) && (
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-critical)',
            marginTop: 12,
          }}
        >
          {clientError ?? serverError}
        </p>
      )}
      {successMsg && (
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-positive)',
            marginTop: 12,
          }}
        >
          {successMsg}
        </p>
      )}
    </div>
  )
}
