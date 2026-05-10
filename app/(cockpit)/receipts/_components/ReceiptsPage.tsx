'use client'

import { useEffect, useRef, useState, Fragment } from 'react'
import { CATEGORIES } from '@/lib/types/expenses'
import type { OcrResult, Receipt } from '@/lib/types/receipts'
import type { BusinessExpense } from '@/lib/types/expenses'

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function currentMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function allMonthsForYear(year: number) {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
}

function monthLabel(yyyyMM: string) {
  const [y, m] = yyyyMM.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-CA', {
    month: 'long',
    year: 'numeric',
  })
}

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ── OcrForm — review / correct OCR result before saving ──────────────────────

interface OcrFormState {
  receiptDate: string
  vendor: string
  category: string
  pretax: string
  taxAmount: string
  notes: string
}

interface OcrFormProps {
  initial: OcrFormState
  onSave: (form: OcrFormState) => Promise<void>
  onCancel: () => void
  saving: boolean
}

function OcrForm({ initial, onSave, onCancel, saving }: OcrFormProps) {
  const [f, setF] = useState<OcrFormState>(initial)
  const [err, setErr] = useState<string | null>(null)

  function set<K extends keyof OcrFormState>(key: K, val: OcrFormState[K]) {
    setF((prev) => ({ ...prev, [key]: val }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!f.vendor.trim()) {
      setErr('Vendor is required.')
      return
    }
    setErr(null)
    await onSave(f)
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {err && <p className="mb-3 text-sm text-[var(--color-critical)]">{err}</p>}

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-bold tracking-wider text-[var(--color-text-muted)] uppercase">
            Receipt Date
          </label>
          <input
            type="date"
            value={f.receiptDate}
            onChange={(e) => set('receiptDate', e.target.value)}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 font-mono text-sm text-[var(--color-text-primary)] outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold tracking-wider text-[var(--color-text-muted)] uppercase">
            Vendor
          </label>
          <input
            type="text"
            value={f.vendor}
            onChange={(e) => set('vendor', e.target.value)}
            className="font-ui w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-sm text-[var(--color-text-primary)] outline-none"
            required
          />
        </div>
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-xs font-bold tracking-wider text-[var(--color-text-muted)] uppercase">
          Category
        </label>
        <select
          value={f.category}
          onChange={(e) => set('category', e.target.value)}
          className="font-ui w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-sm text-[var(--color-text-primary)] outline-none"
        >
          <option value="">— select —</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-bold tracking-wider text-[var(--color-text-muted)] uppercase">
            Pre-Tax ($)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={f.pretax}
            onChange={(e) => set('pretax', e.target.value)}
            placeholder="0.00"
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 font-mono text-sm text-[var(--color-text-primary)] outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold tracking-wider text-[var(--color-text-muted)] uppercase">
            GST / Tax ($)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={f.taxAmount}
            onChange={(e) => set('taxAmount', e.target.value)}
            placeholder="0.00"
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 font-mono text-sm text-[var(--color-text-primary)] outline-none"
          />
        </div>
      </div>

      <div className="mb-4">
        <label className="mb-1 block text-xs font-bold tracking-wider text-[var(--color-text-muted)] uppercase">
          Notes (optional)
        </label>
        <input
          type="text"
          value={f.notes}
          onChange={(e) => set('notes', e.target.value)}
          className="font-ui w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-sm text-[var(--color-text-primary)] outline-none"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="cursor-pointer rounded-[var(--radius-sm)] border-0 bg-[var(--color-pillar-money)] px-5 py-2 text-xs font-bold tracking-wider text-white uppercase disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save Receipt'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-3.5 py-1.5 text-xs font-semibold text-[var(--color-text-muted)]"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── MatchPicker — inline expense selector for linking a receipt ───────────────

interface MatchPickerProps {
  receiptId: string
  month: string
  onMatched: () => void
  onCancel: () => void
}

function MatchPicker({ receiptId, month, onMatched, onCancel }: MatchPickerProps) {
  const [expenses, setExpenses] = useState<BusinessExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/expenses?month=${month}`)
      .then((r) => r.json() as Promise<{ expenses: BusinessExpense[] }>)
      .then((d) => {
        if (!cancelled) {
          setExpenses(d.expenses.filter((e) => !e.hubdoc))
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [month])

  async function handleLink() {
    if (!selectedId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/receipts/${receiptId}/match`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expenseId: selectedId }),
      })
      if (res.ok) onMatched()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-3">
      {loading ? (
        <span className="font-ui text-sm text-[var(--color-text-disabled)]">Loading expenses…</span>
      ) : expenses.length === 0 ? (
        <span className="font-ui text-sm text-[var(--color-text-disabled)]">
          No unmatched expenses for this month.
        </span>
      ) : (
        <>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="font-ui min-w-[280px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-sm text-[var(--color-text-primary)] outline-none"
          >
            <option value="">— pick an expense —</option>
            {expenses.map((e) => (
              <option key={e.id} value={e.id}>
                {e.date} {e.vendor} ${e.pretax.toFixed(2)}
              </option>
            ))}
          </select>
          <button
            onClick={handleLink}
            disabled={!selectedId || saving}
            className="cursor-pointer rounded-[var(--radius-sm)] border-0 bg-[var(--color-pillar-money)] px-3.5 py-1.5 text-xs font-bold tracking-wider text-white uppercase disabled:opacity-50"
          >
            {saving ? 'Linking…' : 'Link'}
          </button>
        </>
      )}
      <button
        onClick={onCancel}
        className="cursor-pointer rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-3.5 py-1.5 text-xs font-semibold text-[var(--color-text-muted)]"
      >
        Cancel
      </button>
    </div>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Receipt['match_status'] }) {
  const cls: Record<Receipt['match_status'], string> = {
    matched:
      'text-[var(--color-positive,#4caf50)] border-[color-mix(in_srgb,var(--color-positive,#4caf50)_35%,transparent)]',
    review:
      'text-[var(--color-warning,#ff9800)] border-[color-mix(in_srgb,var(--color-warning,#ff9800)_35%,transparent)]',
    unmatched: 'text-[var(--color-text-disabled)] border-[var(--color-border)]',
  }
  const labels = { matched: 'Matched', review: 'Review', unmatched: 'Unmatched' }
  return (
    <span
      className={`font-ui rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase ${cls[status]}`}
    >
      {labels[status]}
    </span>
  )
}

// ── Monthly summary strip ─────────────────────────────────────────────────────

function MonthlySummary({ receipts }: { receipts: Receipt[] }) {
  const totalSpend = receipts.reduce((s, r) => s + (r.total ?? 0), 0)
  const totalGst = receipts.reduce((s, r) => s + (r.tax_amount ?? 0), 0)
  const matched = receipts.filter((r) => r.match_status === 'matched').length
  const unmatched = receipts.filter((r) => r.match_status !== 'matched').length
  const matchPct = receipts.length > 0 ? Math.round((matched / receipts.length) * 100) : 0

  return (
    <div className="mb-4 grid grid-cols-4 gap-4">
      {[
        { label: 'Total Spend', value: `$${fmt(totalSpend)}`, highlight: false },
        { label: 'GST ITCs', value: `$${fmt(totalGst)}`, highlight: false },
        {
          label: 'Matched',
          value: `${matched} / ${receipts.length}`,
          highlight: false,
        },
        {
          label: 'Unmatched',
          value: String(unmatched),
          highlight: unmatched > 0,
        },
      ].map(({ label, value, highlight }) => (
        <div
          key={label}
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3"
        >
          <div className="mb-1 text-[10px] font-bold tracking-wider text-[var(--color-text-disabled)] uppercase">
            {label}
          </div>
          <div
            className={`font-mono text-base font-bold ${highlight ? 'text-[var(--color-critical)]' : 'text-[var(--color-text-primary)]'}`}
          >
            {value}
          </div>
          {label === 'Matched' && receipts.length > 0 && (
            <div className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">{matchPct}%</div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Bookkeeper month view ─────────────────────────────────────────────────────

const BK_PAGE_SIZE = 100
const BK_LOAD_STEP = 50

interface BookkeeperViewProps {
  receipts: Receipt[]
  ytdMode?: boolean
  year?: number
  fetchMs?: number
}

function BookkeeperView({ receipts, ytdMode = false, year, fetchMs }: BookkeeperViewProps) {
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set())
  const [monthVisible, setMonthVisible] = useState<Record<string, number>>({})

  function toggleMonth(m: string) {
    setOpenMonths((prev) => {
      const next = new Set(prev)
      if (next.has(m)) next.delete(m)
      else next.add(m)
      return next
    })
  }

  function showMore(mk: string) {
    setMonthVisible((prev) => ({ ...prev, [mk]: (prev[mk] ?? BK_PAGE_SIZE) + BK_LOAD_STEP }))
  }

  // Group by receipt_date month (fall back to upload_date)
  const byMonth = new Map<string, Receipt[]>()
  for (const r of receipts) {
    const d = r.receipt_date ?? r.upload_date
    const mk = d?.slice(0, 7) ?? 'unknown'
    const arr = byMonth.get(mk) ?? []
    arr.push(r)
    byMonth.set(mk, arr)
  }

  const sortedMonths = Array.from(byMonth.keys()).sort().reverse()

  if (sortedMonths.length === 0) {
    return (
      <p className="font-ui py-4 text-sm text-[var(--color-text-disabled)]">
        No receipts to display.
      </p>
    )
  }

  const benchmarkExceeded = fetchMs !== undefined && fetchMs > 1000

  return (
    <div className="space-y-2">
      {ytdMode && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
          <span className="font-ui text-[10px] font-bold tracking-wider text-[var(--color-text-disabled)] uppercase">
            {year} YTD
          </span>
          <span className="font-mono text-xs text-[var(--color-text-muted)]">
            {receipts.length.toLocaleString()} receipts
          </span>
          <span className="font-ui text-xs text-[var(--color-text-muted)]">
            {sortedMonths.length} month{sortedMonths.length !== 1 ? 's' : ''}
          </span>
          {fetchMs !== undefined && (
            <span
              className={`font-mono text-[10px] ${benchmarkExceeded ? 'text-[var(--color-warning,#ff9800)]' : 'text-[var(--color-text-disabled)]'}`}
            >
              loaded in {fetchMs}ms{benchmarkExceeded ? ' · exceeds 1s benchmark' : ''}
            </span>
          )}
        </div>
      )}
      {sortedMonths.map((mk) => {
        const recs = byMonth.get(mk) ?? []
        const totalSpend = recs.reduce((s, r) => s + (r.total ?? 0), 0)
        const totalGst = recs.reduce((s, r) => s + (r.tax_amount ?? 0), 0)
        const matchedCount = recs.filter((r) => r.match_status === 'matched').length
        const open = openMonths.has(mk)
        const allMatched = matchedCount === recs.length

        // Category breakdown
        const catMap = new Map<string, number>()
        for (const r of recs) {
          catMap.set(r.category, (catMap.get(r.category) ?? 0) + (r.total ?? 0))
        }
        const sortedCats = Array.from(catMap.entries()).sort((a, b) => b[1] - a[1])

        return (
          <div
            key={mk}
            className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]"
          >
            <button
              onClick={() => toggleMonth(mk)}
              className="flex w-full cursor-pointer items-center justify-between border-0 bg-[var(--color-surface-2)] px-4 py-3 text-left"
            >
              <span className="font-ui flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                <span>{allMatched ? '✓' : '!'}</span>
                <span>{monthLabel(mk)}</span>
                <span className="font-normal text-[var(--color-text-muted)]">
                  {recs.length} receipts · ${fmt(totalSpend)} · ${fmt(totalGst)} GST
                </span>
                <span
                  className={`text-xs ${allMatched ? 'text-[var(--color-positive,#4caf50)]' : 'text-[var(--color-warning,#ff9800)]'}`}
                >
                  {matchedCount}/{recs.length} matched
                </span>
              </span>
              <span className="text-sm text-[var(--color-text-muted)]">{open ? '▲' : '▼'}</span>
            </button>

            {open && (
              <div className="bg-[var(--color-surface)] px-4 py-3">
                {/* Receipt list */}
                <div className="mb-4 space-y-1">
                  {/* Column header with MT timezone note */}
                  <div className="font-ui mb-1 flex items-center gap-2 text-[9px] font-bold tracking-wider text-[var(--color-text-disabled)] uppercase">
                    <span className="w-3 shrink-0" />
                    <span className="w-24 shrink-0">Date (MT)</span>
                    <span className="flex-1">Vendor</span>
                    <span className="w-16 text-right">Total</span>
                    <span className="max-w-[160px]">Category</span>
                    <span className="w-12" />
                  </div>
                  {(() => {
                    const sortedRecs = recs.slice().sort((a, b) => {
                      const da = a.receipt_date ?? a.upload_date
                      const db = b.receipt_date ?? b.upload_date
                      return da < db ? -1 : 1
                    })
                    const visible = monthVisible[mk] ?? BK_PAGE_SIZE
                    const shownRecs = sortedRecs.slice(0, visible)
                    const remaining = sortedRecs.length - visible
                    return (
                      <>
                        {shownRecs.map((r) => (
                          <div
                            key={r.id}
                            className="font-ui flex items-center gap-2 text-xs text-[var(--color-text-secondary)]"
                          >
                            <span
                              className={
                                r.match_status === 'matched'
                                  ? 'text-[var(--color-positive,#4caf50)]'
                                  : 'text-[var(--color-warning,#ff9800)]'
                              }
                            >
                              {r.match_status === 'matched' ? '✓' : '!'}
                            </span>
                            <span className="w-24 shrink-0 font-mono">
                              {r.receipt_date ?? r.upload_date}
                            </span>
                            <span className="flex-1 truncate">{r.vendor || '—'}</span>
                            <span className="font-mono">${fmt(r.total)}</span>
                            <span className="max-w-[160px] truncate text-[var(--color-text-muted)]">
                              {r.category}
                            </span>
                            {r.storage_path && (
                              <a
                                href={`/api/receipts/${r.id}/image`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 text-[var(--color-pillar-money)] underline"
                              >
                                Receipt
                              </a>
                            )}
                          </div>
                        ))}
                        {remaining > 0 && (
                          <button
                            onClick={() => showMore(mk)}
                            className="font-ui mt-2 cursor-pointer rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-[10px] font-semibold text-[var(--color-text-muted)]"
                          >
                            Show {Math.min(BK_LOAD_STEP, remaining)} more ({remaining} remaining)
                          </button>
                        )}
                      </>
                    )
                  })()}
                </div>

                {/* Category breakdown */}
                {sortedCats.length > 0 && (
                  <div>
                    <div className="mb-1 text-[10px] font-bold tracking-wider text-[var(--color-text-disabled)] uppercase">
                      By Category
                    </div>
                    <div className="space-y-0.5">
                      {sortedCats.map(([cat, total]) => (
                        <div key={cat} className="font-ui flex items-center gap-2 text-xs">
                          <span className="flex-1 truncate text-[var(--color-text-secondary)]">
                            {cat}
                          </span>
                          <span className="font-mono text-[var(--color-text-primary)]">
                            ${fmt(total)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type ScanState = 'idle' | 'scanning' | 'review'
type ActiveTab = 'receipts' | 'bookkeeper'

export function ReceiptsPage() {
  const currentYear = new Date().getFullYear()
  const months = allMonthsForYear(currentYear)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const [viewMode, setViewMode] = useState<'month' | 'ytd'>('month')
  const [month, setMonth] = useState(currentMonthStr)
  const [activeTab, setActiveTab] = useState<ActiveTab>('receipts')
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loadingReceipts, setLoadingReceipts] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [refetchKey, setRefetchKey] = useState(0)

  // YTD state
  const [ytdReceipts, setYtdReceipts] = useState<Receipt[]>([])
  const [ytdLoading, setYtdLoading] = useState(false)
  const [ytdError, setYtdError] = useState<string | null>(null)
  const [ytdRefetchKey, setYtdRefetchKey] = useState(0)
  const [ytdFetchMs, setYtdFetchMs] = useState<number | null>(null)

  const [scanState, setScanState] = useState<ScanState>('idle')
  const [scanError, setScanError] = useState<string | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [ocrForm, setOcrForm] = useState<OcrFormState | null>(null)
  const [saving, setSaving] = useState(false)

  const [matchingId, setMatchingId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  // ── Load receipts ──
  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoadingReceipts(true)
      setFetchError(null)
      try {
        const res = await fetch(`/api/receipts?month=${month}`)
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        const data = (await res.json()) as { receipts: Receipt[] }
        if (!cancelled) setReceipts(data.receipts)
      } catch (e: unknown) {
        if (!cancelled) setFetchError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoadingReceipts(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [month, refetchKey])

  // ── Load YTD receipts (full year fetch, Edmonton MT Jan 1 cutoff) ──
  useEffect(() => {
    if (viewMode !== 'ytd') return
    let cancelled = false
    const t0 = performance.now()

    async function loadYtd() {
      setYtdLoading(true)
      setYtdError(null)
      try {
        const res = await fetch(`/api/receipts?year=${currentYear}`)
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        const data = (await res.json()) as { receipts: Receipt[] }
        if (!cancelled) {
          setYtdReceipts(data.receipts)
          setYtdFetchMs(Math.round(performance.now() - t0))
        }
      } catch (e: unknown) {
        if (!cancelled) setYtdError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setYtdLoading(false)
      }
    }

    void loadYtd()
    return () => {
      cancelled = true
    }
  }, [viewMode, currentYear, ytdRefetchKey])

  // ── Scan a file ──
  async function handleFile(file: File) {
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
    if (!ALLOWED.includes(file.type)) {
      setScanError(`Unsupported file type. Upload JPEG, PNG, or WebP.`)
      return
    }
    if (file.size > 4.5 * 1024 * 1024) {
      setScanError('File is too large (max 4.5 MB). Compress the image first.')
      return
    }

    setScanError(null)
    setPendingFile(file)
    setScanState('scanning')

    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/receipts/scan', { method: 'POST', body: fd })
      const body = (await res.json()) as OcrResult & { error?: string }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)

      setOcrForm({
        receiptDate: body.date ?? todayStr(),
        vendor: body.vendor ?? '',
        category:
          body.suggested_category &&
          CATEGORIES.includes(body.suggested_category as (typeof CATEGORIES)[number])
            ? body.suggested_category
            : '',
        pretax: body.pretax != null ? String(body.pretax) : '',
        taxAmount: body.tax_amount != null ? String(body.tax_amount) : '',
        notes: '',
      })
      setScanState('review')
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : String(e))
      setScanState('idle')
      setPendingFile(null)
    }
  }

  // ── Save confirmed receipt ──
  async function handleSave(form: OcrFormState) {
    if (!pendingFile) return
    setSaving(true)
    try {
      const base64 = await toBase64(pendingFile)
      const body = {
        receiptDate: form.receiptDate || null,
        vendor: form.vendor,
        pretax: form.pretax ? parseFloat(form.pretax) : null,
        taxAmount: form.taxAmount ? parseFloat(form.taxAmount) : 0,
        total:
          form.pretax && form.taxAmount
            ? Math.round((parseFloat(form.pretax) + parseFloat(form.taxAmount)) * 100) / 100
            : form.pretax
              ? parseFloat(form.pretax)
              : null,
        category: form.category,
        notes: form.notes,
        ocrSource: 'claude_vision',
        fileBase64: base64,
        fileName: pendingFile.name,
        fileType: pendingFile.type,
      }
      const res = await fetch('/api/receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      setScanState('idle')
      setPendingFile(null)
      setOcrForm(null)
      setRefetchKey((k) => k + 1)
      setYtdRefetchKey((k) => k + 1)
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  // ── Delete receipt ──
  async function handleDelete(id: string) {
    if (!confirm('Delete this receipt?')) return
    const res = await fetch(`/api/receipts/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setRefetchKey((k) => k + 1)
      setYtdRefetchKey((k) => k + 1)
    }
  }

  // ── Drag-drop handlers ──
  function onDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragging(true)
  }
  function onDragLeave() {
    setDragging(false)
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void handleFile(file)
  }

  const unmatched = receipts.filter((r) => r.match_status === 'unmatched')
  const review = receipts.filter((r) => r.match_status === 'review')
  const matched = receipts.filter((r) => r.match_status === 'matched')

  return (
    <div className="mx-auto max-w-[960px] px-8 py-7">
      {/* ── Header ── */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-ui text-xs font-bold tracking-[0.1em] text-[var(--color-pillar-money)] uppercase">
            Receipts
          </span>
          {/* View mode toggle */}
          <div className="flex overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)]">
            {(['month', 'ytd'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => {
                  setViewMode(mode)
                  if (mode === 'ytd') setActiveTab('bookkeeper')
                }}
                className={`font-ui cursor-pointer border-0 px-3 py-1 text-[10px] font-bold tracking-wider uppercase transition-colors ${
                  viewMode === mode
                    ? 'bg-[var(--color-pillar-money)] text-white'
                    : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)]'
                }`}
              >
                {mode === 'month' ? 'This Month' : 'YTD'}
              </button>
            ))}
          </div>
        </div>

        {viewMode === 'month' ? (
          <select
            value={month}
            onChange={(e) => {
              setMonth(e.target.value)
              setScanState('idle')
            }}
            className="font-ui w-48 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-sm text-[var(--color-text-primary)] outline-none"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        ) : (
          <span className="font-mono text-xs text-[var(--color-text-muted)]">
            {currentYear} YTD
          </span>
        )}
      </div>

      {/* ── Upload Zone ── */}
      <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        {scanState === 'idle' && (
          <>
            <div
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`cursor-pointer rounded-[var(--radius-sm)] border-2 border-dashed px-6 py-8 text-center transition-colors ${
                dragging
                  ? 'border-[var(--color-pillar-money)] bg-[color-mix(in_srgb,var(--color-pillar-money)_4%,transparent)]'
                  : 'border-[var(--color-border)]'
              }`}
            >
              <div className="font-ui mb-1.5 text-sm text-[var(--color-text-muted)]">
                Drop receipt here or click to browse
              </div>
              <div className="font-ui text-[10px] text-[var(--color-text-disabled)]">
                JPEG · PNG · WebP · Max 4.5 MB
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleFile(f)
                e.target.value = ''
              }}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleFile(f)
                e.target.value = ''
              }}
            />
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="mt-3 block w-full cursor-pointer rounded-[var(--radius-sm)] border-0 bg-[var(--color-pillar-money)] px-5 py-3 text-sm font-bold tracking-wider text-white uppercase"
            >
              Take Photo
            </button>
            {scanError && (
              <p className="font-ui mt-2.5 text-sm text-[var(--color-critical)]">{scanError}</p>
            )}
          </>
        )}

        {scanState === 'scanning' && (
          <p className="font-ui py-6 text-sm text-[var(--color-text-muted)]">
            Scanning receipt with Claude Vision…
          </p>
        )}

        {scanState === 'review' && ocrForm && (
          <>
            <div className="font-ui mb-3.5 text-xs font-bold tracking-wider text-[var(--color-text-muted)] uppercase">
              Review OCR Result — {pendingFile?.name}
            </div>
            <OcrForm
              initial={ocrForm}
              onSave={handleSave}
              onCancel={() => {
                setScanState('idle')
                setPendingFile(null)
                setOcrForm(null)
              }}
              saving={saving}
            />
          </>
        )}
      </div>

      {/* ── Tab switcher ── */}
      <div className="mb-4 flex gap-1 border-b border-[var(--color-border)] pb-0">
        {(['receipts', 'bookkeeper'] as const).map((tab) => {
          const disabledInYtd = tab === 'receipts' && viewMode === 'ytd'
          return (
            <button
              key={tab}
              onClick={() => {
                if (disabledInYtd) return
                setActiveTab(tab)
              }}
              disabled={disabledInYtd}
              className={`font-ui cursor-pointer border-t-0 border-r-0 border-b-2 border-l-0 bg-transparent px-4 py-2 text-xs font-bold tracking-wider uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                activeTab === tab
                  ? 'border-b-[var(--color-pillar-money)] text-[var(--color-pillar-money)]'
                  : 'border-b-transparent text-[var(--color-text-muted)]'
              }`}
            >
              {tab === 'receipts' ? 'Receipt List' : 'Bookkeeper View'}
            </button>
          )
        })}
      </div>

      {/* ── Receipts List Tab ── */}
      {activeTab === 'receipts' && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          {loadingReceipts && (
            <p className="font-ui text-sm text-[var(--color-text-disabled)]">Loading…</p>
          )}
          {fetchError && (
            <p className="font-ui text-sm text-[var(--color-critical)]">Error: {fetchError}</p>
          )}
          {!loadingReceipts && !fetchError && receipts.length === 0 && (
            <p className="font-ui text-sm text-[var(--color-text-disabled)]">
              No receipts uploaded for {monthLabel(month)} yet.
            </p>
          )}

          {!loadingReceipts && !fetchError && receipts.length > 0 && (
            <>
              <MonthlySummary receipts={receipts} />

              {/* Receipt count summary */}
              <div className="mb-4 flex gap-5">
                {[
                  {
                    label: 'Total',
                    count: receipts.length,
                    color: 'text-[var(--color-text-muted)]',
                  },
                  {
                    label: 'Unmatched',
                    count: unmatched.length,
                    color:
                      unmatched.length > 0
                        ? 'text-[var(--color-critical)]'
                        : 'text-[var(--color-text-disabled)]',
                  },
                  {
                    label: 'Review',
                    count: review.length,
                    color:
                      review.length > 0
                        ? 'text-[var(--color-warning,#ff9800)]'
                        : 'text-[var(--color-text-disabled)]',
                  },
                  {
                    label: 'Matched',
                    count: matched.length,
                    color: 'text-[var(--color-positive,#4caf50)]',
                  },
                ].map(({ label, count, color }) => (
                  <div key={label}>
                    <div className="font-ui text-[10px] tracking-wider text-[var(--color-text-disabled)] uppercase">
                      {label}
                    </div>
                    <div className={`font-mono text-base font-bold ${color}`}>{count}</div>
                  </div>
                ))}
              </div>

              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {['Date', 'Vendor', 'Category', 'Pre-Tax', 'GST', 'Total', 'Status', ''].map(
                      (h) => (
                        <th
                          key={h}
                          className={`font-ui border-b border-[var(--color-border)] pr-2.5 pb-2 text-[10px] font-bold tracking-wider text-[var(--color-text-disabled)] uppercase ${h === '' ? 'text-right' : 'text-left'}`}
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((r) => (
                    <Fragment key={r.id}>
                      <tr>
                        <td className="border-b border-[var(--color-border)] py-2 pr-2.5 font-mono text-sm text-[var(--color-text-secondary)]">
                          {r.receipt_date ?? r.upload_date}
                        </td>
                        <td className="font-ui border-b border-[var(--color-border)] py-2 pr-2.5 text-sm text-[var(--color-text-secondary)]">
                          {r.vendor || '—'}
                        </td>
                        <td className="font-ui max-w-[140px] overflow-hidden border-b border-[var(--color-border)] py-2 pr-2.5 text-sm text-ellipsis whitespace-nowrap text-[var(--color-text-muted)]">
                          {r.category || '—'}
                        </td>
                        <td className="border-b border-[var(--color-border)] py-2 text-right font-mono text-sm text-[var(--color-text-primary)]">
                          ${fmt(r.pretax)}
                        </td>
                        <td className="border-b border-[var(--color-border)] py-2 text-right font-mono text-sm text-[var(--color-text-muted)]">
                          ${fmt(r.tax_amount)}
                        </td>
                        <td className="border-b border-[var(--color-border)] py-2 text-right font-mono text-sm font-bold text-[var(--color-text-primary)]">
                          ${fmt(r.total)}
                        </td>
                        <td className="border-b border-[var(--color-border)] py-2 pr-2.5 pl-2">
                          <StatusBadge status={r.match_status} />
                        </td>
                        <td className="border-b border-[var(--color-border)] py-2 text-right whitespace-nowrap">
                          {r.match_status !== 'matched' && (
                            <button
                              onClick={() => setMatchingId(matchingId === r.id ? null : r.id)}
                              className="mr-1 cursor-pointer rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-muted)]"
                            >
                              {matchingId === r.id ? 'Cancel' : 'Link'}
                            </button>
                          )}
                          {r.match_status === 'matched' && (
                            <button
                              onClick={async () => {
                                const res = await fetch(`/api/receipts/${r.id}/match`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ expenseId: null }),
                                })
                                if (res.ok) setRefetchKey((k) => k + 1)
                              }}
                              className="mr-1 cursor-pointer rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-muted)]"
                            >
                              Unlink
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(r.id)}
                            className="cursor-pointer rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--color-critical)_40%,transparent)] bg-transparent px-2 py-0.5 text-[10px] font-semibold text-[var(--color-critical)]"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>

                      {/* Inline match picker */}
                      {matchingId === r.id && (
                        <tr>
                          <td colSpan={8} className="border-b border-[var(--color-border)] pb-2">
                            <MatchPicker
                              receiptId={r.id}
                              month={month}
                              onMatched={() => {
                                setMatchingId(null)
                                setRefetchKey((k) => k + 1)
                              }}
                              onCancel={() => setMatchingId(null)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {/* ── Bookkeeper View Tab ── */}
      {activeTab === 'bookkeeper' && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          {viewMode === 'ytd' ? (
            ytdLoading ? (
              <p className="font-ui text-sm text-[var(--color-text-disabled)]">
                Loading {currentYear} YTD receipts…
              </p>
            ) : ytdError ? (
              <p className="font-ui text-sm text-[var(--color-critical)]">Error: {ytdError}</p>
            ) : (
              <BookkeeperView
                receipts={ytdReceipts}
                ytdMode
                year={currentYear}
                fetchMs={ytdFetchMs ?? undefined}
              />
            )
          ) : loadingReceipts ? (
            <p className="font-ui text-sm text-[var(--color-text-disabled)]">Loading…</p>
          ) : (
            <BookkeeperView receipts={receipts} />
          )}
        </div>
      )}
    </div>
  )
}
