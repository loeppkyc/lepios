'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ReceiptLine } from '@/lib/receipts/types'

interface ReconcilePanelProps {
  receipts: ReceiptLine[]
  onRefresh: () => void
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function reconcileColor(r: ReceiptLine): string {
  if (r.reconciled) return 'text-emerald-400'
  if (r.category?.toLowerCase() === 'personal') return 'text-[var(--color-text-muted)]'
  return 'text-red-400'
}

function reconcileLabel(r: ReceiptLine): string {
  if (r.reconciled) return '🟢 Matched'
  if (r.category?.toLowerCase() === 'personal') return '⚪ Personal'
  return '🔴 Unmatched'
}

export function ReconcilePanel({ receipts, onRefresh }: ReconcilePanelProps) {
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkResult, setBulkResult] = useState<string | null>(null)

  const unmatched = receipts.filter((r) => !r.reconciled && r.category?.toLowerCase() !== 'personal')
  const matched = receipts.filter((r) => r.reconciled)

  const reconcileRate = receipts.length > 0
    ? Math.round((matched.length / receipts.length) * 100)
    : 0

  async function runBulkMatch() {
    setBulkRunning(true)
    setBulkResult(null)
    let autoConfirmed = 0

    for (const receipt of unmatched) {
      try {
        const res = await fetch('/api/receipts/match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ receipt_id: receipt.id }),
        })
        const data = await res.json() as { candidates?: Array<{ transaction_id: string; match_confidence: number; auto_confirmed: boolean }> }
        const best = data.candidates?.[0]
        if (best && best.auto_confirmed) {
          await fetch('/api/receipts/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              receipt_id: receipt.id,
              transaction_id: best.transaction_id,
              match_confidence: best.match_confidence,
            }),
          })
          autoConfirmed++
        }
      } catch {
        // Continue on error
      }
    }

    setBulkRunning(false)
    setBulkResult(`Auto-matched ${autoConfirmed} of ${unmatched.length} receipts`)
    onRefresh()
  }

  return (
    <div className="space-y-6">
      {/* Summary strip */}
      <div className="flex gap-6 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-6 py-4">
        <div className="text-center">
          <p className="text-2xl font-bold tabular-nums text-[var(--color-text-primary)]">{reconcileRate}%</p>
          <p className="text-xs text-[var(--color-text-muted)]">Reconciled</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold tabular-nums text-emerald-400">{matched.length}</p>
          <p className="text-xs text-[var(--color-text-muted)]">Matched</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold tabular-nums text-red-400">{unmatched.length}</p>
          <p className="text-xs text-[var(--color-text-muted)]">Unmatched</p>
        </div>
      </div>

      {/* Bulk auto-match */}
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          onClick={() => void runBulkMatch()}
          disabled={bulkRunning || unmatched.length === 0}
        >
          {bulkRunning ? 'Running...' : 'Bulk Auto-Match'}
        </Button>
        {bulkResult && (
          <p className="text-sm text-[var(--color-text-muted)]">{bulkResult}</p>
        )}
      </div>

      {/* Left panel: unmatched receipts */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
          Unmatched Receipts ({unmatched.length})
        </h3>
        {unmatched.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">All receipts reconciled.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Date</th>
                <th className="px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Vendor</th>
                <th className="px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider text-right">Total</th>
                <th className="px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody>
              {unmatched.map((r) => (
                <tr key={r.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-muted)]">{r.receipt_date}</td>
                  <td className="px-3 py-2 text-[var(--color-text-primary)]">{r.vendor}</td>
                  <td className="px-3 py-2 text-right font-mono">${fmt(r.total)}</td>
                  <td className={['px-3 py-2 text-xs', reconcileColor(r)].join(' ')}>{reconcileLabel(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
