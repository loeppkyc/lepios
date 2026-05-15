'use client'

import { Badge } from '@/components/ui/badge'
import type { ReceiptLine } from '@/lib/receipts/types'

interface ReceiptRowProps {
  receipt: ReceiptLine
  matchConfidence?: number | null
}

function confidenceColor(confidence: number | null | undefined): string {
  if (!confidence) return ''
  if (confidence >= 0.92) return 'bg-emerald-900/30 text-emerald-400 border-emerald-800'
  if (confidence >= 0.7) return 'bg-yellow-900/30 text-yellow-400 border-yellow-800'
  return 'bg-red-900/30 text-red-400 border-red-800'
}

function reconcileIcon(receipt: ReceiptLine, confidence: number | null | undefined): string {
  if (receipt.reconciled) return '🟢'
  if (receipt.category?.toLowerCase() === 'personal') return '⚪'
  if (confidence && confidence >= 0.7) return '🟡'
  return '🔴'
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function ReceiptRow({ receipt, matchConfidence }: ReceiptRowProps) {
  return (
    <tr className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]/50 transition-colors">
      <td className="px-3 py-2 text-sm text-[var(--color-text-muted)] font-mono">
        {reconcileIcon(receipt, matchConfidence)}
      </td>
      <td className="px-3 py-2 text-sm text-[var(--color-text-primary)]">
        {receipt.receipt_date}
      </td>
      <td className="px-3 py-2 text-sm font-medium text-[var(--color-text-primary)]">
        {receipt.vendor}
      </td>
      <td className="px-3 py-2 text-sm text-[var(--color-text-muted)]">
        {receipt.category ?? '—'}
      </td>
      <td className="px-3 py-2 text-sm text-right font-mono text-[var(--color-text-primary)]">
        ${fmt(receipt.total)}
      </td>
      <td className="px-3 py-2 text-sm text-right font-mono text-[var(--color-text-muted)]">
        {receipt.tax !== null ? `$${fmt(receipt.tax)}` : '—'}
      </td>
      <td className="px-3 py-2">
        <Badge variant="outline" className="text-xs capitalize">
          {receipt.source}
        </Badge>
      </td>
      <td className="px-3 py-2">
        {matchConfidence !== null && matchConfidence !== undefined ? (
          <span
            className={[
              'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold',
              confidenceColor(matchConfidence),
            ].join(' ')}
          >
            {(matchConfidence * 100).toFixed(0)}%
          </span>
        ) : (
          <span className="text-xs text-[var(--color-text-muted)]">—</span>
        )}
      </td>
    </tr>
  )
}
