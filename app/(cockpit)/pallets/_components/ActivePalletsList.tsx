'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { closePalletAction } from '../actions'
import type { PalletWithScanCount } from '@/lib/pallets/types'

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
  })
}

function PalletRow({ pallet }: { pallet: PalletWithScanCount }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleClose() {
    if (!confirm(`Close pallet "${pallet.source}"? This cannot be undone.`)) return
    setError(null)
    startTransition(async () => {
      const result = await closePalletAction(pallet.id, {
        source: pallet.source,
        scan_count: pallet.scan_count,
        est_cost_cad: pallet.est_cost_cad,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="border-border bg-cockpit-surface-2 flex items-center gap-3 rounded-[4px] border px-3 py-2.5">
      {/* Source + date */}
      <div className="min-w-0 flex-1">
        <span className="block truncate font-mono text-sm text-[var(--color-text-primary)]">
          {pallet.source}
        </span>
        <span className="text-muted-foreground text-[11px]">
          {fmtDate(pallet.intake_date)}
          {pallet.est_cost_cad != null && <> · ${pallet.est_cost_cad.toFixed(2)} CAD</>}
          {pallet.notes && <> · {pallet.notes}</>}
        </span>
      </div>

      {/* Scan count badge */}
      <span className="bg-cockpit-surface text-muted-foreground shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px]">
        {pallet.scan_count} scan{pallet.scan_count !== 1 ? 's' : ''}
      </span>

      {/* Scan link */}
      <a
        href={`/scan?pallet_id=${pallet.id}`}
        className="text-pillar-money shrink-0 rounded-[4px] px-3 py-1 text-[11px] font-semibold tracking-[0.06em] uppercase transition-colors hover:underline"
      >
        Scan →
      </a>

      {/* Close button */}
      <button
        onClick={handleClose}
        disabled={isPending}
        className="border-border text-muted-foreground hover:border-cockpit-critical hover:text-cockpit-critical shrink-0 rounded-[4px] border px-3 py-1 text-[11px] font-semibold tracking-[0.06em] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Closing…' : 'Close'}
      </button>

      {error && <span className="text-cockpit-critical text-[11px]">{error}</span>}
    </div>
  )
}

interface ActivePalletsListProps {
  pallets: PalletWithScanCount[]
}

export function ActivePalletsList({ pallets }: ActivePalletsListProps) {
  return (
    <div className="border-border bg-cockpit-surface rounded-[6px] border p-5">
      <div className="mb-4">
        <span className="text-pillar-money block text-xs font-semibold tracking-[0.08em] uppercase">
          Active Pallets
        </span>
        <p className="text-muted-foreground mt-1 text-xs">
          {pallets.length === 0
            ? 'No active pallets — intake one above.'
            : `${pallets.length} pallet${pallets.length !== 1 ? 's' : ''} in progress`}
        </p>
      </div>

      {pallets.length > 0 && (
        <div className="flex flex-col gap-2">
          {pallets.map((p) => (
            <PalletRow key={p.id} pallet={p} />
          ))}
        </div>
      )}
    </div>
  )
}
