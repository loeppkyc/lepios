'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { savePallet } from '../actions'

function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export function PalletIntakeForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [source, setSource] = useState('')
  const [intakeDate, setIntakeDate] = useState(todayDate)
  const [estCost, setEstCost] = useState('')
  const [notes, setNotes] = useState('')
  const [clientError, setClientError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  function validateClient(): string | null {
    if (!source.trim()) return 'Source is required.'
    if (!intakeDate || !/^\d{4}-\d{2}-\d{2}$/.test(intakeDate)) return 'Select a valid date.'
    if (estCost) {
      const n = parseFloat(estCost)
      if (isNaN(n) || n <= 0) return 'Estimated cost must be positive.'
    }
    return null
  }

  function clearForm() {
    setSource('')
    setIntakeDate(todayDate())
    setEstCost('')
    setNotes('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setClientError(null)
    setServerError(null)
    setSuccessMsg(null)

    const err = validateClient()
    if (err) {
      setClientError(err)
      return
    }

    startTransition(async () => {
      const result = await savePallet({
        source: source.trim(),
        intake_date: intakeDate,
        est_cost_cad: estCost ? parseFloat(estCost) : null,
        notes: notes.trim() || null,
      })

      if (!result.ok) {
        setServerError(result.error)
        return
      }

      setSuccessMsg(`Pallet created — ${result.pallet.source} (${result.pallet.intake_date})`)
      clearForm()
      router.refresh()
    })
  }

  return (
    <div className="border-border bg-cockpit-surface rounded-[6px] border p-5">
      <div className="mb-4">
        <span className="text-pillar-money block text-xs font-semibold tracking-[0.08em] uppercase">
          Intake New Pallet
        </span>
        <p className="text-muted-foreground mt-1 text-xs">
          One pallet per intake event · cost confirmed by AP at month-end
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <div className="mb-4 grid grid-cols-[2fr_1fr_1fr] gap-4">
          <div>
            <label
              htmlFor="pallet-source"
              className="text-muted-foreground mb-1 block text-[11px] font-semibold tracking-[0.06em] uppercase"
            >
              Source
            </label>
            <input
              id="pallet-source"
              type="text"
              placeholder="e.g. Goodwill West Edmonton"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              autoComplete="off"
              className="border-border bg-cockpit-surface-2 w-full rounded-[4px] border px-2.5 py-1.5 font-mono text-sm text-[var(--color-text-primary)] outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="pallet-date"
              className="text-muted-foreground mb-1 block text-[11px] font-semibold tracking-[0.06em] uppercase"
            >
              Intake Date
            </label>
            <input
              id="pallet-date"
              type="date"
              value={intakeDate}
              onChange={(e) => setIntakeDate(e.target.value)}
              className="border-border bg-cockpit-surface-2 w-full rounded-[4px] border px-2.5 py-1.5 font-mono text-sm text-[var(--color-text-primary)] outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="pallet-cost"
              className="text-muted-foreground mb-1 block text-[11px] font-semibold tracking-[0.06em] uppercase"
            >
              Est. Cost (CAD)
            </label>
            <input
              id="pallet-cost"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="optional"
              value={estCost}
              onChange={(e) => setEstCost(e.target.value)}
              className="border-border bg-cockpit-surface-2 w-full rounded-[4px] border px-2.5 py-1.5 font-mono text-sm text-[var(--color-text-primary)] outline-none"
            />
          </div>
        </div>

        <div className="mb-4">
          <label
            htmlFor="pallet-notes"
            className="text-muted-foreground mb-1 block text-[11px] font-semibold tracking-[0.06em] uppercase"
          >
            Notes (optional)
          </label>
          <input
            id="pallet-notes"
            type="text"
            placeholder="e.g. mixed fiction, 3 boxes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            autoComplete="off"
            className="border-border bg-cockpit-surface-2 w-full rounded-[4px] border px-2.5 py-1.5 font-mono text-sm text-[var(--color-text-primary)] outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="disabled:bg-cockpit-surface-2 disabled:text-muted-foreground rounded-[4px] px-5 py-2 text-xs font-semibold tracking-[0.06em] uppercase transition-colors disabled:cursor-not-allowed"
          style={{
            backgroundColor: isPending ? undefined : 'var(--color-pillar-money)',
            color: isPending ? undefined : 'var(--color-base)',
          }}
        >
          {isPending ? 'Saving…' : 'Create Pallet'}
        </button>
      </form>

      {(clientError ?? serverError) && (
        <p className="text-cockpit-critical mt-3 text-xs">{clientError ?? serverError}</p>
      )}
      {successMsg && <p className="text-cockpit-positive mt-3 text-xs">{successMsg}</p>}
    </div>
  )
}
