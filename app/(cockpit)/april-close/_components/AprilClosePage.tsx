'use client'

import { useCallback, useEffect, useState } from 'react'
import type { TransactionsResponse } from '@/app/api/quickbooks/transactions/route'
import type { RevenueBreakdownResponse } from '@/app/api/amazon/revenue-breakdown/route'
import type { GstSummaryResponse } from '@/app/api/bookkeeping/gst-summary/route'
import type { QBOTransactionRow } from '@/lib/quickbooks/types'

const MONTH = '2026-04'
const START = '2026-04-01'
const END = '2026-04-30'

interface BookkeepingMonth {
  month: string
  count: number
  totalPretax: number
  totalTax: number
  businessPortion: number
  missingReceipts: number
}

interface MissingReceiptExpense {
  id: string
  date: string
  vendor: string
  category: string
  pretax: number
  tax_amount: number
  payment_method?: string
  notes?: string
}

interface BookkeepingSummary {
  months: BookkeepingMonth[]
  missingReceiptExpenses: MissingReceiptExpense[]
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
  const [qboData, setQboData] = useState<TransactionsResponse | null>(null)
  const [bkData, setBkData] = useState<BookkeepingSummary | null>(null)
  const [amazonData, setAmazonData] = useState<RevenueBreakdownResponse | null>(null)
  const [gstData, setGstData] = useState<GstSummaryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [qboRes, bkRes, amazonRes, gstRes] = await Promise.all([
        fetch(`/api/quickbooks/transactions?start=${START}&end=${END}`),
        fetch(`/api/bookkeeping/summary?year=2026`),
        fetch(`/api/amazon/revenue-breakdown?month=${MONTH}`),
        fetch(`/api/bookkeeping/gst-summary?month=${MONTH}`),
      ])

      if (!qboRes.ok) {
        const body = (await qboRes.json()) as { error?: string }
        if (body.error !== 'not_connected') throw new Error(body.error ?? 'QBO fetch failed')
      } else {
        setQboData((await qboRes.json()) as TransactionsResponse)
      }
      if (!bkRes.ok) throw new Error('Bookkeeping summary failed')
      if (!amazonRes.ok) throw new Error('Amazon revenue breakdown failed')
      if (!gstRes.ok) throw new Error('GST summary failed')

      setBkData((await bkRes.json()) as BookkeepingSummary)
      setAmazonData((await amazonRes.json()) as RevenueBreakdownResponse)
      setGstData((await gstRes.json()) as GstSummaryResponse)
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

  const aprilBk = bkData?.months.find((m) => m.month === MONTH)
  const allTxns = qboData?.transactions ?? []
  const totalTxnIn = allTxns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const totalTxnOut = allTxns.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0)
  const missing = bkData?.missingReceiptExpenses ?? []

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">April 2026 Close</h1>
          <p className="mt-0.5 text-xs text-white/40">
            April 1–30 · Amazon payouts + QBO bank feed + expenses
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
            label: 'Amazon Net Payouts',
            value: loading ? '…' : fmt(amazonData?.totalNetPayout ?? 0),
            sub: `${amazonData?.settlements.length ?? '…'} settlements`,
          },
          {
            label: 'QBO In',
            value: loading ? '…' : qboData ? fmt(totalTxnIn) : 'Not connected',
            sub: 'deposits & credits',
          },
          {
            label: 'QBO Out',
            value: loading ? '…' : qboData ? fmt(Math.abs(totalTxnOut)) : 'Not connected',
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

      {/* Amazon Revenue Breakdown */}
      <div className="flex flex-col gap-3">
        <SectionHeader title="Amazon Revenue Breakdown" />
        {!loading && amazonData && (
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-4">
            {!amazonData.parsed ? (
              <p className="text-xs text-yellow-400">
                Revenue parsing pending — migration 0200 not yet applied.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-xs">
                  <span className="text-white/50">
                    Gross Sales ({amazonData.shipmentCount} shipments)
                  </span>
                  <span className="font-mono font-semibold text-green-400">
                    {fmt(amazonData.grossSales)}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-white/50">Amazon Fees (FBA + commission)</span>
                  <span className="font-mono font-semibold text-red-400">
                    {fmt(amazonData.amazonFees)}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-white/50">Refunds ({amazonData.refundCount} returns)</span>
                  <span className="font-mono font-semibold text-red-400">
                    {fmt(amazonData.refunds)}
                  </span>
                </div>
                <div className="mt-1 flex justify-between border-t border-white/10 pt-2 text-xs">
                  <span className="font-semibold text-white">Net Revenue (calc)</span>
                  <span className="font-mono font-semibold text-white">
                    {fmt(amazonData.netRevenue)}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-white/50">Net Payout (actual deposited)</span>
                  <span className="font-mono font-semibold text-green-400">
                    {fmt(amazonData.totalNetPayout)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
        {loading && <p className="text-xs text-white/30">Loading Amazon data…</p>}
      </div>

      {/* Amazon Settlements (dynamic from DB) */}
      <div className="flex flex-col gap-3">
        <SectionHeader title="Amazon CA Settlements" count={amazonData?.settlements.length} />
        {!loading && amazonData && (
          <div className="flex flex-col gap-1.5">
            {amazonData.settlements.map((s) => {
              const startDate = s.periodStart.slice(0, 10)
              const endDate = s.periodEnd.slice(0, 10)
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-2.5"
                >
                  <span className="text-xs text-white/60">
                    {startDate} → {endDate}
                  </span>
                  <span className="font-mono text-xs font-semibold text-green-400">
                    {fmt(s.netPayout)}
                  </span>
                </div>
              )
            })}
            <div className="flex items-center justify-between rounded-lg border border-white/20 bg-white/10 px-4 py-2.5">
              <span className="text-xs font-semibold text-white">Total Net Paid</span>
              <span className="font-mono text-xs font-semibold text-green-400">
                {fmt(amazonData.totalNetPayout)}
              </span>
            </div>
          </div>
        )}
        {loading && <p className="text-xs text-white/30">Loading settlements…</p>}
      </div>

      {/* GST / ITC Summary */}
      <div className="flex flex-col gap-3">
        <SectionHeader title="GST / ITC Summary" />
        {!loading && gstData && (
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-4">
            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-xs">
                <span className="text-white/50">Business expenses (pre-tax)</span>
                <span className="font-mono font-semibold text-white">
                  {fmt(gstData.expensePretax)}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="font-semibold text-green-400">
                  ITCs you can claim (GST/HST paid on expenses)
                </span>
                <span className="font-mono font-semibold text-green-400">{fmt(gstData.itcs)}</span>
              </div>
              {gstData.missingReceiptCount > 0 && (
                <p className="mt-1 text-xs text-yellow-400">
                  ⚠ {gstData.missingReceiptCount} expenses missing receipts — CRA requires receipts
                  to claim ITCs
                </p>
              )}
              <p className="mt-2 text-xs text-white/30">{gstData.note}</p>
            </div>
            {gstData.byCategory.length > 0 && (
              <div className="mt-3 flex flex-col gap-1 border-t border-white/10 pt-3">
                {gstData.byCategory.map((c) => (
                  <div key={c.category} className="flex justify-between text-xs">
                    <span className="text-white/50">{c.category}</span>
                    <span className="font-mono text-white/60">
                      {fmt(c.pretax)} pretax · {fmt(c.itc)} ITC
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {loading && <p className="text-xs text-white/30">Loading GST summary…</p>}
      </div>

      {/* Business Expenses summary */}
      <div className="flex flex-col gap-3">
        <SectionHeader title="Business Expenses (DB)" />
        {aprilBk ? (
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-xs text-white/40">Entries</p>
                <p className="mt-0.5 font-mono text-sm font-semibold text-white">{aprilBk.count}</p>
              </div>
              <div>
                <p className="text-xs text-white/40">Pre-tax</p>
                <p className="mt-0.5 font-mono text-sm font-semibold text-red-400">
                  {fmt(aprilBk.totalPretax)}
                </p>
              </div>
              <div>
                <p className="text-xs text-white/40">GST/HST</p>
                <p className="mt-0.5 font-mono text-sm font-semibold text-white">
                  {fmt(aprilBk.totalTax)}
                </p>
              </div>
              <div>
                <p className="text-xs text-white/40">Missing receipts</p>
                <p
                  className={`mt-0.5 font-mono text-sm font-semibold ${aprilBk.missingReceipts > 0 ? 'text-yellow-400' : 'text-green-400'}`}
                >
                  {aprilBk.missingReceipts}
                </p>
              </div>
            </div>
          </div>
        ) : !loading ? (
          <p className="text-xs text-white/30">No April expense entries found in DB.</p>
        ) : null}
      </div>

      {/* Missing Receipts — full list for Colin to action */}
      {missing.length > 0 && (
        <div className="flex flex-col gap-3">
          <SectionHeader title="Missing Receipts — Action Required" count={missing.length} />
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3">
            <p className="mb-3 text-xs text-yellow-400">
              Find receipts or invoices for each of these. CRA requires them to claim the GST/HST as
              ITCs.
            </p>
            <div className="flex flex-col gap-1.5">
              {missing.map((r) => (
                <div
                  key={r.id}
                  className="grid grid-cols-[80px_1fr_auto_auto] items-center gap-3 text-xs"
                >
                  <span className="text-white/40">{r.date}</span>
                  <div className="min-w-0">
                    <span className="font-medium text-white/80">{r.vendor}</span>
                    <span className="ml-2 text-white/30">{r.category}</span>
                  </div>
                  <span className="font-mono text-white/50">{fmt(r.tax_amount)} GST</span>
                  <span className="font-mono font-semibold text-red-400">{fmt(r.pretax)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* QBO Bank Transactions */}
      <div className="flex flex-col gap-3">
        <SectionHeader title="QBO Bank Transactions" count={allTxns.length} />
        {loading && <p className="text-xs text-white/30">Loading from QuickBooks…</p>}
        {!loading && !qboData && (
          <p className="text-xs text-white/30">
            QuickBooks not connected — transactions unavailable.
          </p>
        )}
        {!loading && qboData && allTxns.length === 0 && (
          <p className="text-xs text-white/30">No transactions found for April in QuickBooks.</p>
        )}
        {!loading && qboData && allTxns.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {allTxns.map((t, i) => (
              <TxnRow key={`${t.date}-${t.txnType}-${i}`} txn={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
