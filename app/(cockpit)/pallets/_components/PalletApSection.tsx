'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveApRecord } from '../actions'
import type { Pallet, SettledPalletWithAp } from '@/lib/pallets/types'

function firstOfThisMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function fmtMonth(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-CA', {
    month: 'short',
    year: 'numeric',
  })
}

// ── Inline AP entry form for a single closed pallet ──────────────────────

function ApEntryRow({ pallet }: { pallet: Pallet }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const [invoiceMonth, setInvoiceMonth] = useState(firstOfThisMonth)
  const [confirmedCost, setConfirmedCost] = useState(
    pallet.est_cost_cad != null ? String(pallet.est_cost_cad) : ''
  )
  const [gstAmount, setGstAmount] = useState('')
  const [paidOn, setPaidOn] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleGstAutoCalc() {
    const cost = parseFloat(confirmedCost)
    if (!isNaN(cost) && cost > 0 && !gstAmount) {
      setGstAmount((cost * 0.05).toFixed(2))
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const cost = parseFloat(confirmedCost)
    const gst = parseFloat(gstAmount || '0')
    if (isNaN(cost) || cost <= 0) {
      setError('Confirmed cost must be positive.')
      return
    }
    if (isNaN(gst) || gst < 0) {
      setError('GST must be >= 0.')
      return
    }

    startTransition(async () => {
      const result = await saveApRecord({
        pallet_id: pallet.id,
        invoice_month: invoiceMonth,
        confirmed_cost_cad: cost,
        gst_amount_cad: gst,
        paid_on: paidOn || null,
        notes: notes.trim() || null,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="border-border bg-cockpit-surface-2 rounded-[4px] border">
      {/* Collapsed row */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <span className="block truncate font-mono text-sm text-[var(--color-text-primary)]">
            {pallet.source}
          </span>
          <span className="text-muted-foreground text-[11px]">
            {fmtDate(pallet.intake_date)}
            {pallet.est_cost_cad != null && <> · est. ${pallet.est_cost_cad.toFixed(2)}</>}
          </span>
        </div>

        <button
          onClick={() => setOpen((o) => !o)}
          className="text-pillar-money shrink-0 rounded-[4px] px-3 py-1 text-[11px] font-semibold tracking-[0.06em] uppercase transition-colors hover:underline"
        >
          {open ? 'Cancel' : 'Enter AP →'}
        </button>
      </div>

      {/* Expanded AP form */}
      {open && (
        <form onSubmit={handleSubmit} noValidate className="border-border border-t px-3 pt-3 pb-3">
          <div className="mb-3 grid grid-cols-[1fr_1fr_1fr_1fr] gap-3">
            <div>
              <label className="text-muted-foreground mb-1 block text-[11px] font-semibold tracking-[0.06em] uppercase">
                Invoice Month
              </label>
              <input
                type="date"
                value={invoiceMonth}
                onChange={(e) => setInvoiceMonth(e.target.value)}
                className="border-border bg-cockpit-surface w-full rounded-[4px] border px-2 py-1.5 font-mono text-sm text-[var(--color-text-primary)] outline-none"
              />
            </div>

            <div>
              <label className="text-muted-foreground mb-1 block text-[11px] font-semibold tracking-[0.06em] uppercase">
                Confirmed Cost (CAD)
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={confirmedCost}
                onChange={(e) => setConfirmedCost(e.target.value)}
                onBlur={handleGstAutoCalc}
                className="border-border bg-cockpit-surface w-full rounded-[4px] border px-2 py-1.5 font-mono text-sm text-[var(--color-text-primary)] outline-none"
              />
            </div>

            <div>
              <label className="text-muted-foreground mb-1 block text-[11px] font-semibold tracking-[0.06em] uppercase">
                GST (CAD)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="auto 5%"
                value={gstAmount}
                onChange={(e) => setGstAmount(e.target.value)}
                className="border-border bg-cockpit-surface w-full rounded-[4px] border px-2 py-1.5 font-mono text-sm text-[var(--color-text-primary)] outline-none"
              />
            </div>

            <div>
              <label className="text-muted-foreground mb-1 block text-[11px] font-semibold tracking-[0.06em] uppercase">
                Paid On (optional)
              </label>
              <input
                type="date"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
                className="border-border bg-cockpit-surface w-full rounded-[4px] border px-2 py-1.5 font-mono text-sm text-[var(--color-text-primary)] outline-none"
              />
            </div>
          </div>

          <div className="mb-3">
            <label className="text-muted-foreground mb-1 block text-[11px] font-semibold tracking-[0.06em] uppercase">
              Notes (optional)
            </label>
            <input
              type="text"
              placeholder="e.g. split invoice with March pallet"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              autoComplete="off"
              className="border-border bg-cockpit-surface w-full rounded-[4px] border px-2 py-1.5 font-mono text-sm text-[var(--color-text-primary)] outline-none"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isPending}
              className="disabled:bg-cockpit-surface-2 disabled:text-muted-foreground rounded-[4px] px-4 py-1.5 text-[11px] font-semibold tracking-[0.06em] uppercase transition-colors disabled:cursor-not-allowed"
              style={{
                backgroundColor: isPending ? undefined : 'var(--color-pillar-money)',
                color: isPending ? undefined : 'var(--color-base)',
              }}
            >
              {isPending ? 'Settling…' : 'Settle Pallet'}
            </button>
            {error && <span className="text-cockpit-critical text-[11px]">{error}</span>}
          </div>
        </form>
      )}
    </div>
  )
}

// ── Recently settled table ────────────────────────────────────────────────

function SettledTable({ pallets }: { pallets: SettledPalletWithAp[] }) {
  if (!pallets.length) return null

  return (
    <div className="mt-4">
      <p className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-[0.06em] uppercase">
        Recently Settled
      </p>
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-[11px]">
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left">
              <th className="pr-4 pb-1.5 font-semibold">Source</th>
              <th className="pr-4 pb-1.5 font-semibold">Month</th>
              <th className="pr-4 pb-1.5 text-right font-semibold">Confirmed</th>
              <th className="pr-4 pb-1.5 text-right font-semibold">GST</th>
              <th className="pb-1.5 font-semibold">Paid On</th>
            </tr>
          </thead>
          <tbody>
            {pallets.map((p) => (
              <tr key={p.id} className="border-border/50 border-b last:border-0">
                <td className="py-1.5 pr-4 text-[var(--color-text-primary)]">{p.source}</td>
                <td className="text-muted-foreground py-1.5 pr-4">{fmtMonth(p.invoice_month)}</td>
                <td className="py-1.5 pr-4 text-right text-[var(--color-text-primary)]">
                  ${p.confirmed_cost_cad.toFixed(2)}
                </td>
                <td className="text-muted-foreground py-1.5 pr-4 text-right">
                  ${p.gst_amount_cad.toFixed(2)}
                </td>
                <td className="text-muted-foreground py-1.5">
                  {p.paid_on ? fmtDate(p.paid_on) : <span className="italic">pending</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main section component ────────────────────────────────────────────────

interface PalletApSectionProps {
  closedPallets: Pallet[]
  settledPallets: SettledPalletWithAp[]
}

export function PalletApSection({ closedPallets, settledPallets }: PalletApSectionProps) {
  const hasAnything = closedPallets.length > 0 || settledPallets.length > 0
  if (!hasAnything) return null

  return (
    <div className="border-border bg-cockpit-surface rounded-[6px] border p-5">
      <div className="mb-4">
        <span className="text-pillar-money block text-xs font-semibold tracking-[0.08em] uppercase">
          AP Settlement
        </span>
        <p className="text-muted-foreground mt-1 text-xs">
          {closedPallets.length === 0
            ? 'All closed pallets settled.'
            : `${closedPallets.length} pallet${closedPallets.length !== 1 ? 's' : ''} awaiting confirmed cost`}
        </p>
      </div>

      {closedPallets.length > 0 && (
        <div className="flex flex-col gap-2">
          {closedPallets.map((p) => (
            <ApEntryRow key={p.id} pallet={p} />
          ))}
        </div>
      )}

      <SettledTable pallets={settledPallets} />
    </div>
  )
}
