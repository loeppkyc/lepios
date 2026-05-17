'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AccountSummary {
  source_account: string
  total: number
  matched: number
  review: number
  dismissed: number
  unmatched: number
}

interface SummaryResponse {
  month: string
  accounts: AccountSummary[]
  can_close: boolean
}

interface Transaction {
  id: string
  txn_date: string
  description: string
  vendor_extracted: string | null
  amount_abs: string
  source_account: string
}

interface Receipt {
  id: string
  vendor: string
  receipt_date: string
  total: string
}

interface MatchRow {
  id: string
  transaction_id: string
  receipt_id: string | null
  match_score: number | null
  match_status: 'auto' | 'review' | 'manual' | 'dismissed'
}

interface AccountDetail {
  transactions: Transaction[]
  matches: MatchRow[]
  receipts: Receipt[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtAmt(v: string | number) {
  return `$${Number(v).toFixed(2)}`
}

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  auto: { bg: 'rgba(34,197,94,0.15)', color: '#4ade80', label: 'Matched' },
  manual: { bg: 'rgba(34,197,94,0.15)', color: '#4ade80', label: 'Confirmed' },
  review: { bg: 'rgba(251,191,36,0.15)', color: '#fbbf24', label: 'Review' },
  dismissed: { bg: 'rgba(113,113,122,0.2)', color: '#71717a', label: 'Dismissed' },
  unmatched: { bg: 'rgba(239,68,68,0.15)', color: '#f87171', label: 'Unmatched' },
}

function Badge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.unmatched
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '0.65rem',
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: 4,
        background: s.bg,
        color: s.color,
        whiteSpace: 'nowrap',
      }}
    >
      {s.label}
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function StatementReconciliation() {
  const [month, setMonth] = useState(currentMonth)
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [loadingMatch, setLoadingMatch] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail, setDetail] = useState<AccountDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [matchResult, setMatchResult] = useState<{
    processed: number
    autoMatched: number
    needsReview: number
    unmatched: number
  } | null>(null)

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true)
    setError(null)
    try {
      const res = await fetch(`/api/reconciliation/statement-summary?month=${month}`)
      const json = (await res.json()) as SummaryResponse & { error?: string }
      if (!res.ok) {
        setError(json.error ?? 'Failed')
        return
      }
      setSummary(json)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoadingSummary(false)
    }
  }, [month])

  useEffect(() => {
    async function run() {
      await loadSummary()
    }
    void run()
  }, [loadSummary])

  const runMatch = async () => {
    setLoadingMatch(true)
    setMatchResult(null)
    setError(null)
    try {
      const res = await fetch('/api/reconciliation/statement-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      })
      const json = (await res.json()) as {
        processed: number
        autoMatched: number
        needsReview: number
        unmatched: number
        error?: string
      }
      if (!res.ok) {
        setError(json.error ?? 'Match failed')
        return
      }
      setMatchResult(json)
      await loadSummary()
      if (expanded) await loadDetail(expanded)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoadingMatch(false)
    }
  }

  const loadDetail = async (account: string) => {
    setLoadingDetail(true)
    try {
      const [year, mo] = month.split('-').map(Number)
      const lastDay = new Date(year, mo, 0).getDate()
      const from = `${month}-01`
      const to = `${month}-${String(lastDay).padStart(2, '0')}`

      const sb = createClient()
      const [{ data: txns }, { data: matches }] = await Promise.all([
        sb
          .from('pending_transactions')
          .select('id, txn_date, description, vendor_extracted, amount_abs, source_account')
          .gte('txn_date', from)
          .lte('txn_date', to)
          .eq('is_debit', true)
          .eq('source_account', account)
          .order('txn_date', { ascending: false }),
        sb
          .from('statement_receipt_matches')
          .select('id, transaction_id, receipt_id, match_score, match_status'),
      ])

      const txnIds = (txns ?? []).map((t: Transaction) => t.id)
      const relevantMatches = ((matches ?? []) as MatchRow[]).filter((m) =>
        txnIds.includes(m.transaction_id)
      )
      const receiptIds = relevantMatches.map((m) => m.receipt_id).filter(Boolean) as string[]

      let receipts: Receipt[] = []
      if (receiptIds.length > 0) {
        const { data: rRows } = await sb
          .from('receipts')
          .select('id, vendor, receipt_date, total')
          .in('id', receiptIds)
        receipts = (rRows ?? []) as Receipt[]
      }

      setDetail({ transactions: (txns ?? []) as Transaction[], matches: relevantMatches, receipts })
    } finally {
      setLoadingDetail(false)
    }
  }

  const toggleAccount = async (account: string) => {
    if (expanded === account) {
      setExpanded(null)
      setDetail(null)
      return
    }
    setExpanded(account)
    await loadDetail(account)
  }

  const handleAction = async (txnId: string, action: 'confirm' | 'dismiss', matchId?: string) => {
    if (matchId) {
      await fetch(`/api/reconciliation/statement-match/${matchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
    } else {
      await fetch(`/api/reconciliation/statement-match/${txnId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
    }
    await loadSummary()
    if (expanded) await loadDetail(expanded)
  }

  const months: string[] = []
  for (let i = 0; i < 6; i++) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-small)',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-primary)',
            padding: '5px 10px',
          }}
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button
          onClick={runMatch}
          disabled={loadingMatch}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            fontWeight: 600,
            padding: '6px 16px',
            background: loadingMatch ? 'var(--color-surface-2)' : 'var(--color-accent-gold)',
            color: loadingMatch ? 'var(--color-text-disabled)' : '#000',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: loadingMatch ? 'not-allowed' : 'pointer',
          }}
        >
          {loadingMatch ? 'Running…' : 'Run Matching'}
        </button>
      </div>

      {/* Match result banner */}
      {matchResult && (
        <div
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 16px',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-primary)',
            display: 'flex',
            gap: 20,
            flexWrap: 'wrap',
          }}
        >
          <span>
            Scanned: <strong>{matchResult.processed}</strong>
          </span>
          <span>
            Auto-matched: <strong style={{ color: '#4ade80' }}>{matchResult.autoMatched}</strong>
          </span>
          <span>
            Review: <strong style={{ color: '#fbbf24' }}>{matchResult.needsReview}</strong>
          </span>
          <span>
            Unmatched: <strong style={{ color: '#f87171' }}>{matchResult.unmatched}</strong>
          </span>
        </div>
      )}

      {error && (
        <div
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-negative, #ef4444)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 16px',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-negative, #ef4444)',
          }}
        >
          {error}
        </div>
      )}

      {loadingSummary && (
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
          }}
        >
          Loading…
        </p>
      )}

      {/* Account rows */}
      {summary && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {summary.accounts.length === 0 && (
            <p
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                color: 'var(--color-text-disabled)',
              }}
            >
              No debit transactions for {month}. Import a statement first via Statement Lines.
            </p>
          )}

          {summary.accounts.map((acc) => {
            const isOpen = expanded === acc.source_account
            const allDone = acc.unmatched === 0 && acc.review === 0

            return (
              <div
                key={acc.source_account}
                style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                }}
              >
                {/* Account header */}
                <button
                  onClick={() => void toggleAccount(acc.source_account)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: 'var(--color-surface-2)',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-small)',
                        fontWeight: 600,
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      {acc.source_account}
                    </span>
                    {allDone && acc.total > 0 && (
                      <span
                        style={{
                          fontFamily: 'var(--font-ui)',
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: 'rgba(34,197,94,0.15)',
                          color: '#4ade80',
                        }}
                      >
                        Ready to close
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.7rem',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    <span>
                      <span style={{ color: '#4ade80', fontWeight: 700 }}>{acc.matched}</span>{' '}
                      matched
                    </span>
                    {acc.review > 0 && (
                      <span>
                        <span style={{ color: '#fbbf24', fontWeight: 700 }}>{acc.review}</span>{' '}
                        review
                      </span>
                    )}
                    {acc.unmatched > 0 && (
                      <span>
                        <span style={{ color: '#f87171', fontWeight: 700 }}>{acc.unmatched}</span>{' '}
                        unmatched
                      </span>
                    )}
                    {acc.dismissed > 0 && (
                      <span>
                        <span style={{ color: '#71717a', fontWeight: 700 }}>{acc.dismissed}</span>{' '}
                        dismissed
                      </span>
                    )}
                    <span style={{ color: 'var(--color-text-disabled)' }}>/ {acc.total}</span>
                    <span style={{ color: 'var(--color-text-disabled)' }}>
                      {isOpen ? '▲' : '▼'}
                    </span>
                  </div>
                </button>

                {/* Transaction detail */}
                {isOpen && (
                  <div
                    style={{
                      borderTop: '1px solid var(--color-border)',
                      background: 'var(--color-surface)',
                    }}
                  >
                    {loadingDetail && (
                      <p
                        style={{
                          padding: '12px 14px',
                          fontFamily: 'var(--font-ui)',
                          fontSize: 'var(--text-small)',
                          color: 'var(--color-text-disabled)',
                        }}
                      >
                        Loading transactions…
                      </p>
                    )}
                    {!loadingDetail && detail && (
                      <table
                        style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}
                      >
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                            {['Date', 'Description', 'Amount', 'Status', 'Receipt', 'Actions'].map(
                              (h) => (
                                <th
                                  key={h}
                                  style={{
                                    padding: '8px 12px',
                                    textAlign: h === 'Amount' ? 'right' : 'left',
                                    fontFamily: 'var(--font-ui)',
                                    fontSize: '0.65rem',
                                    fontWeight: 700,
                                    letterSpacing: '0.08em',
                                    color: 'var(--color-text-muted)',
                                    textTransform: 'uppercase',
                                  }}
                                >
                                  {h}
                                </th>
                              )
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {detail.transactions.map((txn) => {
                            const match = detail.matches.find((m) => m.transaction_id === txn.id)
                            const receipt = match?.receipt_id
                              ? detail.receipts.find((r) => r.id === match.receipt_id)
                              : null
                            const status = match?.match_status ?? 'unmatched'
                            return (
                              <tr
                                key={txn.id}
                                style={{
                                  borderBottom: '1px solid var(--color-border)',
                                  opacity: status === 'dismissed' ? 0.5 : 1,
                                }}
                              >
                                <td
                                  style={{
                                    padding: '8px 12px',
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '0.72rem',
                                    color: 'var(--color-text-muted)',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {txn.txn_date}
                                </td>
                                <td
                                  style={{
                                    padding: '8px 12px',
                                    fontFamily: 'var(--font-ui)',
                                    color: 'var(--color-text-primary)',
                                    maxWidth: 280,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {txn.vendor_extracted ?? txn.description}
                                </td>
                                <td
                                  style={{
                                    padding: '8px 12px',
                                    textAlign: 'right',
                                    fontFamily: 'var(--font-mono)',
                                    color: 'var(--color-text-primary)',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {fmtAmt(txn.amount_abs)}
                                </td>
                                <td style={{ padding: '8px 12px' }}>
                                  <Badge status={status} />
                                </td>
                                <td
                                  style={{
                                    padding: '8px 12px',
                                    fontFamily: 'var(--font-ui)',
                                    fontSize: '0.72rem',
                                    color: 'var(--color-text-muted)',
                                  }}
                                >
                                  {receipt ? (
                                    `${receipt.vendor} · ${fmtAmt(receipt.total)}`
                                  ) : status === 'dismissed' ? (
                                    '—'
                                  ) : (
                                    <span style={{ color: 'var(--color-text-disabled)' }}>
                                      None
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: '8px 12px' }}>
                                  <div style={{ display: 'flex', gap: 8 }}>
                                    {status === 'review' && match && (
                                      <button
                                        onClick={() =>
                                          void handleAction(txn.id, 'confirm', match.id)
                                        }
                                        style={{
                                          fontFamily: 'var(--font-ui)',
                                          fontSize: '0.7rem',
                                          fontWeight: 600,
                                          background: 'none',
                                          border: 'none',
                                          cursor: 'pointer',
                                          color: '#4ade80',
                                          padding: 0,
                                          textDecoration: 'underline',
                                        }}
                                      >
                                        Confirm
                                      </button>
                                    )}
                                    {(status === 'unmatched' || status === 'review') && (
                                      <button
                                        onClick={() =>
                                          void handleAction(txn.id, 'dismiss', match?.id)
                                        }
                                        style={{
                                          fontFamily: 'var(--font-ui)',
                                          fontSize: '0.7rem',
                                          background: 'none',
                                          border: 'none',
                                          cursor: 'pointer',
                                          color: 'var(--color-text-disabled)',
                                          padding: 0,
                                          textDecoration: 'underline',
                                        }}
                                      >
                                        Dismiss
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {summary.can_close && summary.accounts.length > 0 && (
            <div
              style={{
                background: 'rgba(34,197,94,0.1)',
                border: '1px solid rgba(34,197,94,0.4)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 14px',
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                color: '#4ade80',
              }}
            >
              All transactions matched or dismissed — month is ready to close.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
