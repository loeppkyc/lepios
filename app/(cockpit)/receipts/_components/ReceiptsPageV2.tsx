'use client'

import { useCallback, useEffect, useState } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { UploadZone } from './UploadZone'
import { ReceiptRow } from './ReceiptRow'
import { ReviewQueue } from './ReviewQueue'
import { ReconcilePanel } from './ReconcilePanel'
import type { ReceiptLine } from '@/lib/receipts/types'

// ── Helper ────────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function ninetyDaysAgo(): string {
  const d = new Date()
  d.setDate(d.getDate() - 90)
  return d.toISOString().slice(0, 10)
}

// ── Summary strip ─────────────────────────────────────────────────────────────

interface SummaryStripProps {
  receipts: ReceiptLine[]
}

function SummaryStrip({ receipts }: SummaryStripProps) {
  const total = receipts.reduce((s, r) => s + (r.total ?? 0), 0)
  const gst = receipts.reduce((s, r) => s + (r.tax ?? 0), 0)
  const matched = receipts.filter((r) => r.reconciled).length
  const unmatched = receipts.filter((r) => !r.reconciled).length
  const rate = receipts.length > 0 ? Math.round((matched / receipts.length) * 100) : 0

  return (
    <div className="flex flex-wrap gap-6 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-6 py-4">
      <div>
        <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">Total Spend</p>
        <p className="mt-0.5 text-xl font-bold tabular-nums text-[var(--color-text-primary)]">
          ${fmt(total)}
        </p>
      </div>
      <div>
        <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">GST ITCs</p>
        <p className="mt-0.5 text-xl font-bold tabular-nums text-[var(--color-text-primary)]">
          ${fmt(gst)}
        </p>
      </div>
      <div>
        <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">Matched</p>
        <p className="mt-0.5 text-xl font-bold tabular-nums text-emerald-400">{matched}</p>
      </div>
      <div>
        <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">Unmatched</p>
        <p className="mt-0.5 text-xl font-bold tabular-nums text-red-400">{unmatched}</p>
      </div>
      <div>
        <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">Reconciliation</p>
        <p className="mt-0.5 text-xl font-bold tabular-nums text-[var(--color-text-primary)]">{rate}%</p>
      </div>
    </div>
  )
}

// ── Email import tab ──────────────────────────────────────────────────────────

function EmailImportTab() {
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<{ scanned?: number; imported?: number; skipped?: number; errors?: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function triggerScan() {
    setScanning(true)
    setResult(null)
    setError(null)
    try {
      const cronSecret = process.env.NEXT_PUBLIC_CRON_SECRET ?? ''
      const res = await fetch('/api/receipts/gmail-scan', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cronSecret}` },
      })
      const data = await res.json() as { scanned?: number; imported?: number; skipped?: number; errors?: number; error?: string }
      if (!res.ok) throw new Error(data.error ?? `Scan failed (${res.status})`)
      setResult(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-6 py-4">
        <p className="text-sm text-[var(--color-text-muted)] mb-4">
          Scans Gmail for invoices and receipts received in the last 24 hours.
          Trusted senders are auto-imported; unknown senders are flagged for review.
        </p>
        <p className="text-xs text-[var(--color-text-muted)] mb-4">
          Note: The automatic daily cron is not active (Vercel Hobby plan at max 18 crons).
          Use the button below to trigger a manual scan.
        </p>
        <Button
          variant="outline"
          onClick={() => void triggerScan()}
          disabled={scanning}
        >
          {scanning ? 'Scanning Gmail...' : 'Scan Gmail Now'}
        </Button>
      </div>

      {result && (
        <div className="rounded-[var(--radius)] border border-emerald-800 bg-emerald-900/20 px-6 py-4">
          <p className="text-sm font-semibold text-emerald-400 mb-2">Scan Complete</p>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-xl font-bold tabular-nums text-[var(--color-text-primary)]">{result.scanned ?? 0}</p>
              <p className="text-xs text-[var(--color-text-muted)]">Scanned</p>
            </div>
            <div>
              <p className="text-xl font-bold tabular-nums text-emerald-400">{result.imported ?? 0}</p>
              <p className="text-xs text-[var(--color-text-muted)]">Imported</p>
            </div>
            <div>
              <p className="text-xl font-bold tabular-nums text-[var(--color-text-muted)]">{result.skipped ?? 0}</p>
              <p className="text-xs text-[var(--color-text-muted)]">Skipped</p>
            </div>
            <div>
              <p className="text-xl font-bold tabular-nums text-red-400">{result.errors ?? 0}</p>
              <p className="text-xs text-[var(--color-text-muted)]">Errors</p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-[var(--color-critical)]">{error}</p>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

interface ReceiptsApiResponse {
  receipts?: ReceiptLine[]
  error?: string
}

export function ReceiptsPageV2() {
  const [receipts, setReceipts] = useState<ReceiptLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null)

  const fetchReceipts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Fetch last 90 days
      const from = ninetyDaysAgo()
      const res = await fetch(`/api/receipts/lines?from=${from}`)
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as ReceiptsApiResponse
        throw new Error(j.error ?? `Fetch failed (${res.status})`)
      }
      const data = await res.json() as ReceiptsApiResponse
      setReceipts(data.receipts ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load receipts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchReceipts()
  }, [fetchReceipts])

  const unmatched = receipts.filter((r) => !r.reconciled)
  const reconcileRate = receipts.length > 0
    ? Math.round((receipts.filter((r) => r.reconciled).length / receipts.length) * 100)
    : 0

  function handleUploaded(result: { receipt_id: string; vendor: string; total: number; match_confidence?: number }) {
    setUploadSuccess(
      `Saved — ${result.vendor} $${result.total.toFixed(2)}` +
      (result.match_confidence !== undefined ? ` (${Math.round(result.match_confidence * 100)}% match confidence)` : ''),
    )
    void fetchReceipts()
  }

  return (
    <div className="space-y-6 p-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Receipts</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            90-day view · {unmatched.length} unmatched · {reconcileRate}% auto-matched (7d)
          </p>
        </div>
        <Badge variant="outline" className="text-xs">
          {receipts.length} receipts
        </Badge>
      </div>

      {/* Summary strip */}
      {!loading && receipts.length > 0 && <SummaryStrip receipts={receipts} />}

      {/* Upload success toast */}
      {uploadSuccess && (
        <div className="rounded-[var(--radius)] border border-emerald-800 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-400 flex items-center justify-between">
          <span>{uploadSuccess}</span>
          <button
            type="button"
            className="ml-4 text-xs opacity-70 hover:opacity-100"
            onClick={() => setUploadSuccess(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-[var(--radius)] border border-[var(--color-critical)] bg-[var(--color-critical)]/10 px-4 py-3 text-sm text-[var(--color-critical)]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-[var(--color-text-muted)]">
          Loading receipts...
        </div>
      ) : (
        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">All Receipts</TabsTrigger>
            <TabsTrigger value="review">
              Review Queue
              {unmatched.length > 0 && (
                <span className="ml-1.5 rounded-full bg-[var(--color-accent)] px-1.5 py-0.5 text-xs font-bold text-white">
                  {unmatched.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="reconcile">Reconcile</TabsTrigger>
            <TabsTrigger value="email">Email Import</TabsTrigger>
          </TabsList>

          {/* All Receipts */}
          <TabsContent value="all">
            <div className="mb-4">
              <UploadZone onUploaded={handleUploaded} />
            </div>
            {receipts.length === 0 ? (
              <div className="py-12 text-center text-sm text-[var(--color-text-muted)]">
                No receipts in the last 90 days. Upload one above.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--color-border)]">
                <table className="w-full text-left">
                  <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                    <tr>
                      <th className="px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider w-8" />
                      <th className="px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Date</th>
                      <th className="px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Vendor</th>
                      <th className="px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Category</th>
                      <th className="px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider text-right">Total</th>
                      <th className="px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider text-right">GST</th>
                      <th className="px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Source</th>
                      <th className="px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.map((r) => (
                      <ReceiptRow key={r.id} receipt={r} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          {/* Review Queue */}
          <TabsContent value="review">
            <ReviewQueue receipts={receipts} onConfirmed={() => void fetchReceipts()} />
          </TabsContent>

          {/* Reconcile */}
          <TabsContent value="reconcile">
            <ReconcilePanel receipts={receipts} onRefresh={() => void fetchReceipts()} />
          </TabsContent>

          {/* Email Import */}
          <TabsContent value="email">
            <EmailImportTab />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
