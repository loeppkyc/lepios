'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { ReceiptLine, MatchCandidate } from '@/lib/receipts/types'

interface ReviewQueueProps {
  receipts: ReceiptLine[]
  onConfirmed: () => void
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface ReviewItemState {
  candidates: MatchCandidate[] | null
  loading: boolean
  confirming: string | null  // transaction_id being confirmed
  confirmed: boolean
  error: string | null
}

function ReviewItem({ receipt, onConfirmed }: { receipt: ReceiptLine; onConfirmed: () => void }) {
  const [state, setState] = useState<ReviewItemState>({
    candidates: null,
    loading: false,
    confirming: null,
    confirmed: false,
    error: null,
  })

  async function loadCandidates() {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const res = await fetch('/api/receipts/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receipt_id: receipt.id }),
      })
      const data = await res.json() as { candidates?: MatchCandidate[]; note?: string; error?: string }
      setState((s) => ({ ...s, loading: false, candidates: data.candidates ?? [] }))
    } catch (e: unknown) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'Failed' }))
    }
  }

  async function confirm(txnId: string, confidence: number) {
    setState((s) => ({ ...s, confirming: txnId, error: null }))
    try {
      const res = await fetch('/api/receipts/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receipt_id: receipt.id, transaction_id: txnId, match_confidence: confidence }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(j.error ?? 'Confirm failed')
      }
      setState((s) => ({ ...s, confirming: null, confirmed: true }))
      onConfirmed()
    } catch (e: unknown) {
      setState((s) => ({ ...s, confirming: null, error: e instanceof Error ? e.message : 'Failed' }))
    }
  }

  if (state.confirmed) {
    return (
      <div className="rounded-[var(--radius)] border border-emerald-800 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-400">
        Confirmed — {receipt.vendor} ${fmt(receipt.total)}
      </div>
    )
  }

  return (
    <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 space-y-3">
      {/* Left: receipt info */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{receipt.vendor}</p>
          <p className="text-xs text-[var(--color-text-muted)]">{receipt.receipt_date}</p>
        </div>
        <div className="text-right space-y-0.5">
          <p className="text-sm font-mono font-bold text-[var(--color-text-primary)]">${fmt(receipt.total)}</p>
          {receipt.tax !== null && (
            <p className="text-xs text-[var(--color-text-muted)]">GST: ${fmt(receipt.tax)}</p>
          )}
        </div>
      </div>

      {/* OCR data */}
      <div className="flex gap-2 flex-wrap">
        {receipt.category && (
          <Badge variant="outline" className="text-xs">{receipt.category}</Badge>
        )}
        {receipt.ocr_model && (
          <Badge variant="outline" className="text-xs text-[var(--color-text-muted)]">
            OCR: {receipt.ocr_model}
          </Badge>
        )}
      </div>

      {/* Match candidates */}
      {state.candidates === null ? (
        <Button
          variant="outline"
          className="w-full text-xs"
          onClick={() => void loadCandidates()}
          disabled={state.loading}
        >
          {state.loading ? 'Finding matches...' : 'Find Matches'}
        </Button>
      ) : state.candidates.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)]">No matching transactions found.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
            Top matches
          </p>
          {state.candidates.slice(0, 3).map((c) => (
            <div
              key={c.transaction_id}
              className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-xs text-[var(--color-text-primary)]">
                  {c.transaction.description}
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {c.transaction.date} · ${fmt(Math.abs(c.transaction.amount))}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-mono text-[var(--color-text-muted)]">
                  {(c.match_confidence * 100).toFixed(0)}%
                </span>
                <Button
                  variant="outline"
                  className="text-xs px-2 py-1 h-auto"
                  onClick={() => void confirm(c.transaction_id, c.match_confidence)}
                  disabled={!!state.confirming}
                >
                  {state.confirming === c.transaction_id ? '...' : 'Confirm'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {state.error && (
        <p className="text-xs text-[var(--color-critical)]">{state.error}</p>
      )}
    </div>
  )
}

export function ReviewQueue({ receipts, onConfirmed }: ReviewQueueProps) {
  const unmatched = receipts.filter((r) => !r.reconciled)

  if (unmatched.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-[var(--color-text-muted)]">
        No receipts in review queue.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-text-muted)]">
        {unmatched.length} receipt{unmatched.length !== 1 ? 's' : ''} awaiting review
      </p>
      {unmatched.map((r) => (
        <ReviewItem key={r.id} receipt={r} onConfirmed={onConfirmed} />
      ))}
    </div>
  )
}
