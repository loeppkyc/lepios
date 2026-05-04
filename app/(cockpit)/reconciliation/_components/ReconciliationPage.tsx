'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Receipt } from '@/lib/types/receipts'
import type { BusinessExpense } from '@/lib/types/expenses'

interface ReceiptCandidate {
  receipt: Receipt
  topCandidate: {
    expense: BusinessExpense
    score: number
  } | null
}

interface CandidatesData {
  receipts: ReceiptCandidate[]
  unmatchedExpenses: BusinessExpense[]
}

interface AutoMatchResult {
  autoMatched: number
  needsReview: number
  noMatch: number
  total: number
}

function confidenceLabel(score: number): { label: string; color: string } {
  if (score <= 1.0) return { label: 'High', color: 'var(--color-positive, #22c55e)' }
  if (score <= 3.0) return { label: 'Medium', color: 'var(--color-warning, #f59e0b)' }
  return { label: 'Low', color: 'var(--color-negative, #ef4444)' }
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return `$${n.toFixed(2)}`
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

export function ReconciliationPage() {
  const [month, setMonth] = useState(currentMonth)
  const [data, setData] = useState<CandidatesData | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [autoResult, setAutoResult] = useState<AutoMatchResult | null>(null)
  const [autoRunning, setAutoRunning] = useState(false)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [refetchKey, setRefetchKey] = useState(0)

  const reload = useCallback(() => setRefetchKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setFetchError(null)
      setAutoResult(null)
      try {
        const res = await fetch(`/api/reconciliation/candidates?month=${month}`)
        if (!res.ok) {
          const j = (await res.json()) as { error?: string }
          throw new Error(j.error ?? `HTTP ${res.status}`)
        }
        const json = (await res.json()) as CandidatesData
        if (!cancelled) setData(json)
      } catch (e: unknown) {
        if (!cancelled) setFetchError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [month, refetchKey])

  async function runAutoMatch() {
    setAutoRunning(true)
    setAutoResult(null)
    try {
      const res = await fetch('/api/reconciliation/auto-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      })
      const json = (await res.json()) as AutoMatchResult & { error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setAutoResult(json)
      reload()
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : String(e))
    } finally {
      setAutoRunning(false)
    }
  }

  async function linkToExpense(receiptId: string, expenseId: string) {
    setLinkingId(receiptId)
    try {
      const res = await fetch(`/api/receipts/${receiptId}/match`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expenseId }),
      })
      if (!res.ok) {
        const j = (await res.json()) as { error?: string }
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      reload()
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : String(e))
    } finally {
      setLinkingId(null)
    }
  }

  const unmatchedReceipts = data?.receipts ?? []
  const unmatchedExpenses = data?.unmatchedExpenses ?? []
  const withCandidate = unmatchedReceipts.filter((r) => r.topCandidate !== null)
  const withoutCandidate = unmatchedReceipts.filter((r) => r.topCandidate === null)

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200, margin: '0 auto' }}>
      {/* ── Header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginBottom: 24,
          flexWrap: 'wrap',
        }}
      >
        <h1
          style={{
            fontFamily: 'var(--font-display, var(--font-ui))',
            fontWeight: 900,
            fontSize: '1.4rem',
            letterSpacing: '0.06em',
            color: 'var(--color-text-primary)',
            margin: 0,
            textTransform: 'uppercase',
          }}
        >
          Paper Trail
        </h1>
        <input
          type="month"
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
        />
        <button
          onClick={runAutoMatch}
          disabled={autoRunning || loading}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            fontWeight: 600,
            letterSpacing: '0.06em',
            padding: '6px 16px',
            background: autoRunning ? 'var(--color-surface-2)' : 'var(--color-accent-gold)',
            color: autoRunning ? 'var(--color-text-disabled)' : '#000',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: autoRunning ? 'not-allowed' : 'pointer',
          }}
        >
          {autoRunning ? 'Running…' : 'Auto-Match'}
        </button>
      </div>

      {/* ── Auto-match result banner ── */}
      {autoResult && (
        <div
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 16px',
            marginBottom: 20,
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-primary)',
            display: 'flex',
            gap: 20,
          }}
        >
          <span>
            Auto-matched:{' '}
            <strong style={{ color: 'var(--color-positive, #22c55e)' }}>
              {autoResult.autoMatched}
            </strong>
          </span>
          <span>
            Needs review:{' '}
            <strong style={{ color: 'var(--color-warning, #f59e0b)' }}>
              {autoResult.needsReview}
            </strong>
          </span>
          <span>
            No match:{' '}
            <strong style={{ color: 'var(--color-text-muted)' }}>{autoResult.noMatch}</strong>
          </span>
          <span style={{ color: 'var(--color-text-disabled)' }}>
            of {autoResult.total} receipts
          </span>
        </div>
      )}

      {/* ── Error ── */}
      {fetchError && (
        <div
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-negative, #ef4444)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 16px',
            marginBottom: 20,
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-negative, #ef4444)',
          }}
        >
          {fetchError}
        </div>
      )}

      {loading && (
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

      {!loading && data && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* ── Left: Unmatched Receipts ── */}
          <div>
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.65rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--color-text-muted)',
                marginBottom: 10,
              }}
            >
              Unmatched Receipts ({unmatchedReceipts.length})
            </div>

            {unmatchedReceipts.length === 0 && (
              <p
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-positive, #22c55e)',
                }}
              >
                All receipts matched.
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[...withCandidate, ...withoutCandidate].map(({ receipt, topCandidate }) => {
                const conf = topCandidate ? confidenceLabel(topCandidate.score) : null
                const total = receipt.total ?? (receipt.pretax ?? 0) + receipt.tax_amount
                return (
                  <div
                    key={receipt.id}
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '10px 12px',
                    }}
                  >
                    {/* Receipt info */}
                    <div
                      style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--font-ui)',
                          fontSize: 'var(--text-small)',
                          fontWeight: 600,
                          color: 'var(--color-text-primary)',
                        }}
                      >
                        {receipt.vendor}
                      </span>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-small)',
                          color: 'var(--color-text-primary)',
                        }}
                      >
                        {fmt(total)}
                      </span>
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-nano)',
                        color: 'var(--color-text-disabled)',
                        marginBottom: topCandidate ? 8 : 0,
                      }}
                    >
                      {receipt.receipt_date ?? receipt.upload_date} ·{' '}
                      {receipt.category || 'Uncategorized'}
                    </div>

                    {/* Candidate suggestion */}
                    {topCandidate && conf && (
                      <div
                        style={{
                          background: 'var(--color-surface)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '7px 10px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontFamily: 'var(--font-ui)',
                            fontSize: 'var(--text-nano)',
                            fontWeight: 700,
                            color: conf.color,
                            minWidth: 48,
                          }}
                        >
                          {conf.label}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontFamily: 'var(--font-ui)',
                              fontSize: 'var(--text-nano)',
                              color: 'var(--color-text-muted)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {topCandidate.expense.vendor}
                          </div>
                          <div
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 'var(--text-nano)',
                              color: 'var(--color-text-disabled)',
                            }}
                          >
                            {topCandidate.expense.date} ·{' '}
                            {fmt(topCandidate.expense.pretax + topCandidate.expense.tax_amount)}
                          </div>
                        </div>
                        <button
                          onClick={() => void linkToExpense(receipt.id, topCandidate.expense.id)}
                          disabled={linkingId === receipt.id}
                          style={{
                            fontFamily: 'var(--font-ui)',
                            fontSize: 'var(--text-nano)',
                            fontWeight: 600,
                            padding: '3px 10px',
                            background: 'none',
                            border: '1px solid var(--color-accent-gold)',
                            borderRadius: 'var(--radius-sm)',
                            color: 'var(--color-accent-gold)',
                            cursor: linkingId === receipt.id ? 'not-allowed' : 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {linkingId === receipt.id ? '…' : 'Link'}
                        </button>
                      </div>
                    )}

                    {!topCandidate && (
                      <div
                        style={{
                          fontFamily: 'var(--font-ui)',
                          fontSize: 'var(--text-nano)',
                          color: 'var(--color-text-disabled)',
                        }}
                      >
                        No matching expense found
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Right: Expenses Missing Receipts ── */}
          <div>
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.65rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--color-text-muted)',
                marginBottom: 10,
              }}
            >
              Expenses Missing Receipts ({unmatchedExpenses.length})
            </div>

            {unmatchedExpenses.length === 0 && (
              <p
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-positive, #22c55e)',
                }}
              >
                All expenses have receipts.
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {unmatchedExpenses.map((expense) => {
                const total = expense.pretax + expense.tax_amount
                return (
                  <div
                    key={expense.id}
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '10px 12px',
                    }}
                  >
                    <div
                      style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--font-ui)',
                          fontSize: 'var(--text-small)',
                          fontWeight: 600,
                          color: 'var(--color-text-primary)',
                        }}
                      >
                        {expense.vendor}
                      </span>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-small)',
                          color: 'var(--color-text-primary)',
                        }}
                      >
                        {fmt(total)}
                      </span>
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-nano)',
                        color: 'var(--color-text-disabled)',
                      }}
                    >
                      {expense.date} · {expense.category}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
