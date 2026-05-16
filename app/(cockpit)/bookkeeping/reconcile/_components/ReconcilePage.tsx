'use client'

import { useEffect, useState, useCallback } from 'react'

interface PendingTxn {
  id: string
  txn_date: string
  source_account: string
  description: string
  amount_signed: number
  vendor_extracted: string | null
  suggested_expense_account: string | null
  suggested_gst_rate: number | null
  suggested_business_use_pct: number | null
  confidence: number | null
  matched_rule_id: string | null
  matched_rule_name: string | null
}

interface AccountOption {
  full_name: string
  qb_type: string
}

interface ReconcileQueue {
  pending: PendingTxn[]
  accounts: AccountOption[]
  totalNeedsReview: number
  approvedCount: number
  rejectedCount: number
  bulkEligibleCount: number
}

interface IngestRun {
  id: string
  run_at: string
  source: string
  rows_added: number
  rows_skipped: number
  period_start: string | null
  period_end: string | null
  notes: string | null
}

interface RowEdit {
  expense_account: string
  gst_rate: number
  business_use_pct: number
  learn: boolean
  rule_pattern: string
  notes: string
  rejecting: boolean
  reject_reason: string
  busy: boolean
  flash: { kind: 'ok' | 'err'; msg: string } | null
}

const DEFAULT_GST = 0.05

function fmt(n: number): string {
  return n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${y}-${m}-${d}`
}

const s = {
  card: {
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    padding: '20px 24px',
  } as React.CSSProperties,

  sectionTitle: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--color-text-muted)',
    marginBottom: 14,
  } as React.CSSProperties,

  th: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-nano)',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--color-text-disabled)',
    padding: '0 10px 8px 0',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'left',
  } as React.CSSProperties,

  thRight: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-nano)',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--color-text-disabled)',
    padding: '0 0 8px 10px',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'right',
  } as React.CSSProperties,

  td: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    color: 'var(--color-text-secondary)',
    padding: '8px 10px 8px 0',
    borderBottom: '1px solid var(--color-border)',
    verticalAlign: 'top',
  } as React.CSSProperties,

  tdMono: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-small)',
    color: 'var(--color-text-primary)',
    padding: '8px 0 8px 10px',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'right',
    verticalAlign: 'top',
  } as React.CSSProperties,

  select: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '5px 8px',
    outline: 'none',
    minWidth: 280,
  } as React.CSSProperties,

  input: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-small)',
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '5px 8px',
    outline: 'none',
  } as React.CSSProperties,

  btnPrimary: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    fontWeight: 600,
    letterSpacing: '0.06em',
    padding: '7px 14px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-pillar-money)',
    background: 'var(--color-pillar-money)',
    color: 'var(--color-bg)',
    cursor: 'pointer',
  } as React.CSSProperties,

  btnSecondary: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    fontWeight: 600,
    letterSpacing: '0.06em',
    padding: '7px 14px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-border)',
    background: 'none',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
  } as React.CSSProperties,

  btnDanger: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    fontWeight: 600,
    letterSpacing: '0.06em',
    padding: '7px 14px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-critical)',
    background: 'none',
    color: 'var(--color-critical)',
    cursor: 'pointer',
  } as React.CSSProperties,
}

function defaultEdit(p: PendingTxn): RowEdit {
  return {
    expense_account: p.suggested_expense_account ?? '',
    gst_rate: p.suggested_gst_rate ?? DEFAULT_GST,
    business_use_pct: p.suggested_business_use_pct ?? 100,
    learn: false,
    rule_pattern: extractPatternHint(p),
    notes: '',
    rejecting: false,
    reject_reason: '',
    busy: false,
    flash: null,
  }
}

// Best-guess core token from a description, e.g. "PAYPAL MSP" → "PAYPAL MSP"
function extractPatternHint(p: PendingTxn): string {
  if (p.vendor_extracted) return p.vendor_extracted.toUpperCase()
  // First two non-empty words, uppercased
  const tokens = p.description
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  return tokens.slice(0, 2).join(' ').toUpperCase()
}

function fmtRunDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function ReconcilePage() {
  const [data, setData] = useState<ReconcileQueue | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, RowEdit>>({})
  const [refetchKey, setRefetchKey] = useState(0)

  // Ingest freshness
  const [ingestRuns, setIngestRuns] = useState<IngestRun[]>([])
  const [ingestLoading, setIngestLoading] = useState(true)

  // Bulk-approve state
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkConfirming, setBulkConfirming] = useState(false)
  const [bulkFlash, setBulkFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  const reload = useCallback(() => setRefetchKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setFetchError(null)
      try {
        const res = await fetch('/api/bookkeeping/reconcile', { cache: 'no-store' })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        const q = (await res.json()) as ReconcileQueue
        if (cancelled) return
        setData(q)
        const seed: Record<string, RowEdit> = {}
        for (const p of q.pending) seed[p.id] = defaultEdit(p)
        setEdits(seed)
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
  }, [refetchKey])

  useEffect(() => {
    let cancelled = false
    async function loadIngest() {
      setIngestLoading(true)
      try {
        const res = await fetch('/api/bookkeeping/ingest-runs', { cache: 'no-store' })
        if (!res.ok) return
        const runs = (await res.json()) as IngestRun[]
        if (!cancelled) setIngestRuns(runs)
      } catch {
        // non-fatal — freshness banner falls back to "No ingestion data yet"
      } finally {
        if (!cancelled) setIngestLoading(false)
      }
    }
    void loadIngest()
    return () => {
      cancelled = true
    }
  }, [refetchKey])

  async function bulkApprove() {
    setBulkBusy(true)
    setBulkFlash(null)
    try {
      const res = await fetch('/api/bookkeeping/reconcile/bulk-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confidence_threshold: 85 }),
      })
      const body = (await res.json()) as {
        approved?: number
        jes_created?: number
        errors?: string[]
        error?: string
      }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      const n = body.approved ?? 0
      setBulkFlash({
        kind: 'ok',
        msg: `Approved ${n} transaction${n !== 1 ? 's' : ''}, ${body.jes_created ?? 0} JEs created`,
      })
      setTimeout(reload, 800)
    } catch (err: unknown) {
      setBulkFlash({
        kind: 'err',
        msg: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBulkBusy(false)
      setBulkConfirming(false)
    }
  }

  function patch(id: string, p: Partial<RowEdit>) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }))
  }

  async function approve(p: PendingTxn) {
    const e = edits[p.id]
    if (!e || !e.expense_account) {
      patch(p.id, { flash: { kind: 'err', msg: 'Pick an expense account first' } })
      return
    }
    patch(p.id, { busy: true, flash: null })
    try {
      const res = await fetch('/api/bookkeeping/reconcile/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: p.id,
          expense_account: e.expense_account,
          gst_rate: e.gst_rate,
          business_use_pct: e.business_use_pct,
          review_notes: e.notes.trim() || null,
          learn_rule:
            e.learn && e.rule_pattern.trim().length > 0
              ? {
                  rule_name: e.rule_pattern.trim(),
                  match_pattern: e.rule_pattern.trim(),
                  match_type: 'contains' as const,
                }
              : null,
        }),
      })
      const body = (await res.json()) as {
        error?: string
        je_number?: string
        ruleCreated?: { id: string } | null
      }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      patch(p.id, {
        busy: false,
        flash: {
          kind: 'ok',
          msg: `JE created${body.je_number ? ` (${body.je_number})` : ''}${body.ruleCreated ? ' + rule learned' : ''}`,
        },
      })
      // Refetch after brief flash
      setTimeout(reload, 600)
    } catch (err: unknown) {
      patch(p.id, {
        busy: false,
        flash: { kind: 'err', msg: err instanceof Error ? err.message : String(err) },
      })
    }
  }

  async function reject(p: PendingTxn) {
    const e = edits[p.id]
    if (!e || e.reject_reason.trim().length === 0) {
      patch(p.id, { flash: { kind: 'err', msg: 'Reason required to reject' } })
      return
    }
    patch(p.id, { busy: true, flash: null })
    try {
      const res = await fetch('/api/bookkeeping/reconcile/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, reason: e.reject_reason.trim() }),
      })
      const body = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      patch(p.id, { busy: false, flash: { kind: 'ok', msg: 'Rejected' } })
      setTimeout(reload, 600)
    } catch (err: unknown) {
      patch(p.id, {
        busy: false,
        flash: { kind: 'err', msg: err instanceof Error ? err.message : String(err) },
      })
    }
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--color-pillar-money)',
          }}
        >
          Reconcile — Needs Review
          {data && data.totalNeedsReview > 0 && (
            <span style={{ marginLeft: 8, color: 'var(--color-critical)' }}>
              ({data.totalNeedsReview})
            </span>
          )}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Bulk-approve button */}
          {data && data.bulkEligibleCount > 0 && !bulkConfirming && (
            <button
              onClick={() => setBulkConfirming(true)}
              disabled={bulkBusy}
              style={s.btnPrimary}
            >
              Bulk Approve ≥85% confidence ({data.bulkEligibleCount})
            </button>
          )}
          {bulkConfirming && (
            <>
              <span
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-muted)',
                }}
              >
                Approve {data?.bulkEligibleCount ?? 0} transactions? Cannot be undone.
              </span>
              <button onClick={() => void bulkApprove()} disabled={bulkBusy} style={s.btnPrimary}>
                {bulkBusy ? 'Working…' : 'Confirm'}
              </button>
              <button
                onClick={() => setBulkConfirming(false)}
                disabled={bulkBusy}
                style={s.btnSecondary}
              >
                Cancel
              </button>
            </>
          )}
          {bulkFlash && (
            <span
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                color:
                  bulkFlash.kind === 'ok'
                    ? 'var(--color-positive, #4caf50)'
                    : 'var(--color-critical)',
              }}
            >
              {bulkFlash.msg}
            </span>
          )}
          <button onClick={reload} style={s.btnSecondary}>
            Refresh
          </button>
        </div>
      </div>

      {/* Progress summary bar */}
      {data && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            marginBottom: 8,
            display: 'flex',
            gap: 16,
          }}
        >
          <span>
            Approved:{' '}
            <span style={{ color: 'var(--color-positive, #4caf50)', fontWeight: 600 }}>
              {data.approvedCount}
            </span>
          </span>
          <span>·</span>
          <span>
            Rejected:{' '}
            <span style={{ color: 'var(--color-critical)', fontWeight: 600 }}>
              {data.rejectedCount}
            </span>
          </span>
          <span>·</span>
          <span>
            Remaining:{' '}
            <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
              {data.totalNeedsReview}
            </span>
          </span>
        </div>
      )}

      {/* Last ingested banner */}
      {!ingestLoading && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
            marginBottom: 20,
          }}
        >
          {ingestRuns.length > 0 ? (
            <>
              Last ingested: {fmtRunDate(ingestRuns[0].run_at)} — {ingestRuns[0].rows_added} rows
              loaded{' '}
              <span style={{ color: 'var(--color-text-muted)' }}>
                [source: {ingestRuns[0].source}]
              </span>
            </>
          ) : (
            'No ingestion data yet — run the CLI script first'
          )}
        </div>
      )}

      {loading && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
          }}
        >
          Loading…
        </div>
      )}
      {fetchError && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-critical)',
          }}
        >
          Error: {fetchError}
        </div>
      )}

      {!loading && !fetchError && data && data.pending.length === 0 && (
        <div style={s.card}>
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-positive, #4caf50)',
            }}
          >
            Queue empty. All transactions categorized.
          </div>
        </div>
      )}

      {!loading && !fetchError && data && data.pending.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {data.pending.map((p) => {
            const e = edits[p.id] ?? defaultEdit(p)
            const isOut = p.amount_signed < 0
            const gross = Math.abs(p.amount_signed)
            const pretax =
              e.gst_rate > 0 ? Math.round((gross / (1 + e.gst_rate)) * 100) / 100 : gross
            const gst = Math.round((gross - pretax) * 100) / 100
            return (
              <div key={p.id} style={s.card}>
                {/* Header row: date / source / amount / suggestion */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '110px 1fr 120px 120px',
                    gap: 16,
                    alignItems: 'baseline',
                    marginBottom: 12,
                  }}
                >
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)' }}>
                    {fmtDate(p.txn_date)}
                  </div>
                  <div>
                    <div
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-body)',
                        fontWeight: 600,
                      }}
                    >
                      {p.description}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-nano)',
                        color: 'var(--color-text-disabled)',
                        marginTop: 2,
                      }}
                    >
                      {p.source_account}
                      {p.matched_rule_name && (
                        <>
                          {' · matched rule: '}
                          <span style={{ color: 'var(--color-text-muted)' }}>
                            {p.matched_rule_name}
                          </span>
                        </>
                      )}
                      {p.confidence != null && (
                        <>
                          {' · confidence: '}
                          <span
                            style={{
                              color:
                                p.confidence >= 80
                                  ? 'var(--color-positive, #4caf50)'
                                  : p.confidence >= 60
                                    ? 'var(--color-warning, #f59e0b)'
                                    : 'var(--color-critical)',
                            }}
                          >
                            {p.confidence}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '1.1rem',
                      fontWeight: 700,
                      color: isOut ? 'var(--color-text-primary)' : 'var(--color-positive, #4caf50)',
                      textAlign: 'right',
                    }}
                  >
                    {isOut ? '-' : '+'}${fmt(gross)}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      color: 'var(--color-text-disabled)',
                      textAlign: 'right',
                    }}
                  >
                    pretax ${fmt(pretax)}
                    <br />
                    GST ${fmt(gst)}
                  </div>
                </div>

                {/* Edit grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 110px 110px',
                    gap: 12,
                    marginBottom: 10,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-nano)',
                        color: 'var(--color-text-disabled)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        marginBottom: 4,
                      }}
                    >
                      Account
                    </div>
                    <select
                      style={{ ...s.select, width: '100%' }}
                      value={e.expense_account}
                      onChange={(ev) => patch(p.id, { expense_account: ev.target.value })}
                    >
                      <option value="">— select —</option>
                      {data.accounts.map((a) => (
                        <option key={a.full_name} value={a.full_name}>
                          {a.full_name} ({a.qb_type})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-nano)',
                        color: 'var(--color-text-disabled)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        marginBottom: 4,
                      }}
                    >
                      GST Rate
                    </div>
                    <select
                      style={{ ...s.select, minWidth: 'unset', width: '100%' }}
                      value={String(e.gst_rate)}
                      onChange={(ev) => patch(p.id, { gst_rate: Number(ev.target.value) })}
                    >
                      <option value="0">0% (none)</option>
                      <option value="0.05">5% (GST)</option>
                      <option value="0.13">13% (HST)</option>
                    </select>
                  </div>
                  <div>
                    <div
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-nano)',
                        color: 'var(--color-text-disabled)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        marginBottom: 4,
                      }}
                    >
                      Biz Use %
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      style={{ ...s.input, width: '100%' }}
                      value={e.business_use_pct}
                      onChange={(ev) =>
                        patch(p.id, {
                          business_use_pct: Math.max(
                            0,
                            Math.min(100, Number(ev.target.value) || 0)
                          ),
                        })
                      }
                    />
                  </div>
                </div>

                {/* Learn rule row */}
                <div
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'center',
                    marginBottom: 10,
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-small)',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  <label
                    style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={e.learn}
                      onChange={(ev) => patch(p.id, { learn: ev.target.checked })}
                    />
                    Save as rule for pattern
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. PAYPAL MSP"
                    disabled={!e.learn}
                    style={{
                      ...s.input,
                      fontFamily: 'var(--font-mono)',
                      flex: 1,
                      opacity: e.learn ? 1 : 0.4,
                    }}
                    value={e.rule_pattern}
                    onChange={(ev) => patch(p.id, { rule_pattern: ev.target.value })}
                  />
                </div>

                {/* Notes */}
                <input
                  type="text"
                  placeholder="Optional review notes"
                  style={{
                    ...s.input,
                    width: '100%',
                    fontFamily: 'var(--font-ui)',
                    marginBottom: 10,
                  }}
                  value={e.notes}
                  onChange={(ev) => patch(p.id, { notes: ev.target.value })}
                />

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button onClick={() => void approve(p)} disabled={e.busy} style={s.btnPrimary}>
                    {e.busy ? 'Working…' : 'Approve & post JE'}
                  </button>
                  {!e.rejecting ? (
                    <button
                      onClick={() => patch(p.id, { rejecting: true, flash: null })}
                      style={s.btnDanger}
                    >
                      Reject
                    </button>
                  ) : (
                    <>
                      <input
                        type="text"
                        placeholder="Reason (required)"
                        style={{ ...s.input, fontFamily: 'var(--font-ui)', minWidth: 240 }}
                        value={e.reject_reason}
                        onChange={(ev) => patch(p.id, { reject_reason: ev.target.value })}
                      />
                      <button onClick={() => void reject(p)} disabled={e.busy} style={s.btnDanger}>
                        Confirm reject
                      </button>
                      <button
                        onClick={() => patch(p.id, { rejecting: false, reject_reason: '' })}
                        style={s.btnSecondary}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  {e.flash && (
                    <span
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-small)',
                        color:
                          e.flash.kind === 'ok'
                            ? 'var(--color-positive, #4caf50)'
                            : 'var(--color-critical)',
                        marginLeft: 4,
                      }}
                    >
                      {e.flash.msg}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
