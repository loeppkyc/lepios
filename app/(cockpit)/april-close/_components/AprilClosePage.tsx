'use client'

import { useCallback, useEffect, useState } from 'react'
import type { TransactionsResponse } from '@/app/api/quickbooks/transactions/route'
import type { QBOTransactionRow } from '@/lib/quickbooks/types'

const START = '2026-04-01'
const END = '2026-04-30'

// Amazon April net payouts pulled from amazon_settlements table (synced daily)
const AMAZON_APRIL_PAYOUTS = [
  { period: 'Apr 1', amount: 940.6 },
  { period: 'Apr 2', amount: 463.82 },
  { period: 'Apr 5', amount: 824.23 },
  { period: 'Apr 7', amount: 318.04 },
  { period: 'Apr 8', amount: 222.55 },
  { period: 'Apr 12', amount: 3027.26 },
  { period: 'Apr 15', amount: 1687.32 },
  { period: 'Apr 18', amount: 634.31 },
]
const AMAZON_TOTAL = AMAZON_APRIL_PAYOUTS.reduce((s, r) => s + r.amount, 0)

interface BookkeepingSummary {
  monthly: Array<{ month: string; count: number; pretax: number; tax: number }>
  missingReceipts: Array<{ id: string; date: string; vendor: string; pretax: number }>
}

function fmt(n: number, currency = 'CAD') {
  return n.toLocaleString('en-CA', { style: 'currency', currency, minimumFractionDigits: 2 })
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <h2 className="text-xs font-semibold tracking-wider text-white/50 uppercase">{title}</h2>
      {count !== undefined && (
        <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-xs text-white/40">
          {count}
        </span>
      )}
    </div>
  )
}

function TxnRow({ txn }: { txn: QBOTransactionRow }) {
  const isPositive = txn.amount > 0
  return (
    <div className="grid grid-cols-[80px_1fr_auto] items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5">
      <span className="text-xs text-white/40">{txn.date}</span>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-white">{txn.name || txn.memo || '—'}</p>
        <p className="truncate text-xs text-white/30">
          {txn.txnType} · {txn.account}
        </p>
      </div>
      <span
        className={`font-mono text-xs font-semibold ${isPositive ? 'text-green-400' : 'text-red-400'}`}
      >
        {fmt(txn.amount)}
      </span>
    </div>
  )
}

export function AprilClosePage() {
  const [txnData, setTxnData] = useState<TransactionsResponse | null>(null)
  const [bkData, setBkData] = useState<BookkeepingSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [txnRes, bkRes] = await Promise.all([
        fetch(`/api/quickbooks/transactions?start=${START}&end=${END}`),
        fetch('/api/bookkeeping/summary'),
      ])

      if (!txnRes.ok) {
        const body = (await txnRes.json()) as { error?: string }
        throw new Error(body.error ?? 'QBO transactions failed')
      }
      if (!bkRes.ok) throw new Error('Bookkeeping summary failed')

      setTxnData((await txnRes.json()) as TransactionsResponse)
      setBkData((await bkRes.json()) as BookkeepingSummary)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const aprilBk = bkData?.monthly.find((m) => m.month === '2026-04')
  const deposits =
    txnData?.transactions.filter((t) => t.amount > 0 && t.txnType === 'Deposit') ?? []
  const allTxns = txnData?.transactions ?? []
  const totalTxnIn = allTxns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const totalTxnOut = allTxns.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">April 2026 Close</h1>
          <p className="mt-0.5 text-xs text-white/40">
            April 1–30 · QBO bank feeds + expenses + Amazon payouts
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-white/50 transition hover:border-white/30 hover:text-white disabled:opacity-40"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: 'Amazon Payouts',
            value: fmt(AMAZON_TOTAL),
            sub: `${AMAZON_APRIL_PAYOUTS.length} settlements`,
          },
          { label: 'QBO In', value: loading ? '…' : fmt(totalTxnIn), sub: 'deposits & credits' },
          {
            label: 'QBO Out',
            value: loading ? '…' : fmt(Math.abs(totalTxnOut)),
            sub: 'expenses & debits',
          },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-xs text-white/40">{s.label}</p>
            <p className="mt-1 font-mono text-lg font-semibold text-white">{s.value}</p>
            <p className="text-xs text-white/30">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Business expenses from DB */}
      <div className="flex flex-col gap-3">
        <SectionHeader title="Business Expenses (DB)" />
        {aprilBk ? (
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-white/40">Entries</p>
                <p className="mt-0.5 font-mono text-sm font-semibold text-white">{aprilBk.count}</p>
              </div>
              <div>
                <p className="text-xs text-white/40">Pre-tax</p>
                <p className="mt-0.5 font-mono text-sm font-semibold text-red-400">
                  {fmt(aprilBk.pretax)}
                </p>
              </div>
              <div>
                <p className="text-xs text-white/40">GST/HST</p>
                <p className="mt-0.5 font-mono text-sm font-semibold text-white">
                  {fmt(aprilBk.tax)}
                </p>
              </div>
            </div>
          </div>
        ) : !loading ? (
          <p className="text-xs text-white/30">No April expense entries found in DB.</p>
        ) : null}

        {(bkData?.missingReceipts ?? []).filter((r) => r.date >= START && r.date <= END).length >
          0 && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3">
            <p className="mb-2 text-xs font-semibold text-yellow-400">Missing receipts in April</p>
            <div className="flex flex-col gap-1">
              {bkData!.missingReceipts
                .filter((r) => r.date >= START && r.date <= END)
                .map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between text-xs text-white/60"
                  >
                    <span>
                      {r.date} · {r.vendor}
                    </span>
                    <span className="font-mono text-red-400">{fmt(r.pretax)}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Amazon payouts */}
      <div className="flex flex-col gap-3">
        <SectionHeader title="Amazon CA Payouts" count={AMAZON_APRIL_PAYOUTS.length} />
        <div className="flex flex-col gap-1.5">
          {AMAZON_APRIL_PAYOUTS.map((p) => (
            <div
              key={p.period}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-2.5"
            >
              <span className="text-xs text-white/60">{p.period}</span>
              <span className="font-mono text-xs font-semibold text-green-400">
                {fmt(p.amount)}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between rounded-lg border border-white/20 bg-white/10 px-4 py-2.5">
            <span className="text-xs font-semibold text-white">Total</span>
            <span className="font-mono text-xs font-semibold text-green-400">
              {fmt(AMAZON_TOTAL)}
            </span>
          </div>
        </div>
      </div>

      {/* QBO transactions */}
      <div className="flex flex-col gap-3">
        <SectionHeader title="QBO Bank Transactions" count={allTxns.length} />
        {loading && <p className="text-xs text-white/30">Loading transactions from QuickBooks…</p>}
        {!loading && allTxns.length === 0 && (
          <p className="text-xs text-white/30">No transactions found for April in QuickBooks.</p>
        )}
        {!loading && allTxns.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {allTxns.map((t, i) => (
              <TxnRow key={`${t.date}-${t.txnType}-${i}`} txn={t} />
            ))}
          </div>
        )}
      </div>

      {deposits.length > 0 && (
        <div className="flex flex-col gap-3">
          <SectionHeader title="Deposits Only" count={deposits.length} />
          <div className="flex flex-col gap-1.5">
            {deposits.map((t, i) => (
              <TxnRow key={`dep-${i}`} txn={t} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
