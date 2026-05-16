'use client'

import { useState, useEffect } from 'react'
import { CockpitInput } from '@/components/cockpit/CockpitInput'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

interface HitList {
  id: string
  name: string
  created_at: string
  item_count: number
}

interface HitListItem {
  id: string
  isbn: string
  cost_paid_cad: number | null
  status: 'pending' | 'scanned' | 'skipped'
  added_at: string
  scanned_at: string | null
  title: string | null
  bsr: number | null
  profit_cad: number | null
  roi_pct: number | null
  decision: string | null
  tier: string | null
  bsr_history: { bsr: number; recorded_at: string }[]
}

interface AddResult {
  added: number
  skipped: number
}

interface BatchResult {
  isbn: string
  title: string | null
  profit: number | null
  decision: 'buy' | 'skip' | null
  error: string | null
}

type SortCol = keyof Pick<HitListItem, 'isbn' | 'bsr' | 'profit_cad' | 'roi_pct' | 'status' | 'added_at'>
type FilterStatus = 'all' | 'pending' | 'scanned' | 'skipped'

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

// Lower BSR = better = higher on chart (inverted y-axis: high bsr → high y position = worse)
function BsrSparkline({ data }: { data: { bsr: number }[] }) {
  const W = 44, H = 16, PAD = 2
  const bsrs = data.map((d) => d.bsr)
  const min = Math.min(...bsrs)
  const max = Math.max(...bsrs)
  const range = max - min || 1
  const pts = bsrs
    .map((b, i) => {
      const x = PAD + (i / Math.max(bsrs.length - 1, 1)) * (W - PAD * 2)
      const y = PAD + ((b - min) / range) * (H - PAD * 2)
      return `${x},${y}`
    })
    .join(' ')
  return (
    <svg width={W} height={H} className="inline-block align-middle">
      <polyline
        points={pts}
        fill="none"
        stroke="var(--color-accent-gold)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  )
}

function DecisionChip({ decision }: { decision: string }) {
  const buy = decision.toLowerCase() === 'buy'
  return (
    <span
      className={cn(
        'inline-block px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide rounded',
        buy
          ? 'bg-[var(--color-positive-dim)] text-[var(--color-positive)]'
          : 'bg-[var(--color-surface-2)] text-[var(--color-text-disabled)]'
      )}
    >
      {decision.toUpperCase()}
    </span>
  )
}

function StatusChip({ status }: { status: 'pending' | 'scanned' | 'skipped' }) {
  const map: Record<string, string> = {
    pending: 'text-[var(--color-text-muted)]',
    scanned: 'text-[var(--color-positive)]',
    skipped: 'text-[var(--color-text-disabled)]',
  }
  return (
    <span className={cn('text-xs font-semibold uppercase tracking-wide', map[status] ?? 'text-[var(--color-text-muted)]')}>
      {status}
    </span>
  )
}

export function HitListClient() {
  const [lists, setLists] = useState<HitList[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [items, setItems] = useState<HitListItem[]>([])
  const [newName, setNewName] = useState('')
  const [isbnText, setIsbnText] = useState('')
  const [addResult, setAddResult] = useState<AddResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingLists, setLoadingLists] = useState(true)
  const [loadingItems, setLoadingItems] = useState(false)
  const [deletingList, setDeletingList] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sort + filter state
  const [sortCol, setSortCol] = useState<SortCol | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')

  // Batch scan state
  const [batchActive, setBatchActive] = useState(false)
  const [batchCost, setBatchCost] = useState('0.25')
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null)
  const [batchResults, setBatchResults] = useState<BatchResult[]>([])

  useEffect(() => {
    fetchLists()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!selectedId) { setItems([]); return }
    fetchItems(selectedId)
    setBatchActive(false)
    setBatchProgress(null)
    setBatchResults([])
    setFilterStatus('all')
    setSortCol(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  async function fetchLists(selectId?: string) {
    setLoadingLists(true)
    try {
      const res = await fetch('/api/hit-lists')
      if (!res.ok) return
      const data: HitList[] = await res.json()
      setLists(data)
      if (selectId) {
        setSelectedId(selectId)
      } else if (data.length > 0 && !selectedId) {
        setSelectedId(data[0].id)
      }
    } finally {
      setLoadingLists(false)
    }
  }

  async function fetchItems(listId: string) {
    setLoadingItems(true)
    try {
      const res = await fetch(`/api/hit-lists/${listId}/items`)
      if (!res.ok) return
      const data: HitListItem[] = await res.json()
      setItems(data)
    } finally {
      setLoadingItems(false)
    }
  }

  async function handleCreateList(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/hit-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to create list'); return }
      setNewName('')
      await fetchLists(data.id)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  async function handleAddIsbns(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedId) return
    const capturedId = selectedId
    const isbns = isbnText.split('\n').map((s) => s.trim()).filter(Boolean)
    if (isbns.length === 0) return

    setLoading(true)
    setError(null)
    setAddResult(null)
    try {
      const res = await fetch(`/api/hit-lists/${capturedId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbns }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to add ISBNs'); return }
      setAddResult(data as AddResult)
      await Promise.all([fetchLists(capturedId), fetchItems(capturedId)])
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteItem(itemId: string) {
    const capturedId = selectedId
    const res = await fetch(`/api/hit-lists/${capturedId}/items/${itemId}`, { method: 'DELETE' })
    if (!res.ok) return
    setItems((prev) => prev.filter((i) => i.id !== itemId))
    const listsRes = await fetch('/api/hit-lists')
    if (listsRes.ok) setLists(await listsRes.json())
  }

  async function handleDeleteList() {
    const list = lists.find((l) => l.id === selectedId)
    if (!list) return
    const n = list.item_count
    const ok = window.confirm(`Delete "${list.name}" and all ${n} ISBN${n !== 1 ? 's' : ''}?`)
    if (!ok) return

    setDeletingList(true)
    try {
      const res = await fetch(`/api/hit-lists/${selectedId}`, { method: 'DELETE' })
      if (!res.ok) { setError('Failed to delete list'); return }
      const remaining = lists.filter((l) => l.id !== selectedId)
      setLists(remaining)
      setItems([])
      setAddResult(null)
      setBatchActive(false)
      setBatchResults([])
      setSelectedId(remaining.length > 0 ? remaining[0].id : '')
    } catch {
      setError('Network error')
    } finally {
      setDeletingList(false)
    }
  }

  // handleBatchScan logic preserved byte-for-byte — only styling changed
  async function handleBatchScan() {
    const capturedId = selectedId
    const pending = items.filter((i) => i.status === 'pending')
    if (pending.length === 0) return
    const cost = parseFloat(batchCost)
    if (isNaN(cost) || cost <= 0) return

    setBatchResults([])
    setBatchProgress({ current: 0, total: pending.length })

    for (let i = 0; i < pending.length; i++) {
      const item = pending[i]
      setBatchProgress({ current: i + 1, total: pending.length })
      try {
        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isbn: item.isbn, cost_paid: cost, hit_list_item_id: item.id }),
        })
        const data = await res.json()
        if (!res.ok) {
          setBatchResults((prev) => [
            ...prev,
            { isbn: item.isbn, title: null, profit: null, decision: null, error: data.error ?? 'Scan failed' },
          ])
        } else {
          setBatchResults((prev) => [
            ...prev,
            { isbn: item.isbn, title: data.title ?? null, profit: data.profit ?? null, decision: data.decision ?? null, error: null },
          ])
        }
      } catch {
        setBatchResults((prev) => [
          ...prev,
          { isbn: item.isbn, title: null, profit: null, decision: null, error: 'Network error' },
        ])
      }
    }

    setBatchProgress(null)
    await fetchItems(capturedId)
    await fetchLists(capturedId)
  }

  function toggleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  // Filter then sort
  const filteredSortedItems = (() => {
    let result = filterStatus === 'all' ? items : items.filter((i) => i.status === filterStatus)
    if (sortCol) {
      result = [...result].sort((a, b) => {
        const av = a[sortCol]
        const bv = b[sortCol]
        if (av === null || av === undefined) return 1
        if (bv === null || bv === undefined) return -1
        const cmp = av < bv ? -1 : av > bv ? 1 : 0
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return result
  })()

  const selectedList = lists.find((l) => l.id === selectedId)
  const pendingCount = items.filter((i) => i.status === 'pending').length
  const isScanning = batchProgress !== null

  const sortIndicator = (col: SortCol) => {
    if (sortCol !== col) return null
    return <span className="ml-1 text-[var(--color-accent-gold)]">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col gap-6">
      {/* Page heading */}
      <div>
        <h1 className="text-[var(--text-heading)] font-bold text-[var(--color-text-primary)] leading-none">
          Hit Lists
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">Persistent ISBN queue</p>
      </div>

      {/* Create new list */}
      <form onSubmit={handleCreateList} className="flex gap-2 items-end">
        <div className="flex-1">
          <CockpitInput
            label="New list"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="April Pallet"
            maxLength={80}
          />
        </div>
        <button
          type="submit"
          disabled={loading || !newName.trim()}
          className={cn(
            'font-semibold px-5 py-2 rounded-[var(--radius-md)] transition-colors flex-shrink-0',
            loading || !newName.trim()
              ? 'bg-[var(--color-surface-2)] text-[var(--color-text-disabled)] cursor-not-allowed'
              : 'bg-[var(--color-accent-gold)] text-[var(--color-base)] cursor-pointer hover:opacity-90'
          )}
        >
          Add
        </button>
      </form>

      {loadingLists && (
        <p className="text-sm text-[var(--color-text-disabled)]">Loading…</p>
      )}

      {/* List selector tabs */}
      {!loadingLists && lists.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {lists.map((l) => (
            <button
              key={l.id}
              onClick={() => { setSelectedId(l.id); setAddResult(null) }}
              className={cn(
                'px-3 py-1 text-sm rounded-md border transition-colors',
                selectedId === l.id
                  ? 'bg-[var(--color-accent-gold)] text-[var(--color-base)] border-transparent'
                  : 'border-[var(--color-border-accent)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              )}
            >
              {l.name}
              <span className="ml-1.5 text-xs opacity-70">{l.item_count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Add ISBNs */}
      {!loadingLists && selectedId && (
        <form onSubmit={handleAddIsbns} className="flex flex-col gap-3">
          <div>
            <label
              htmlFor="isbn-textarea"
              className="block text-xs font-semibold uppercase tracking-widest text-[var(--color-text-disabled)] mb-1"
            >
              Add ISBNs
            </label>
            <textarea
              id="isbn-textarea"
              value={isbnText}
              onChange={(e) => { setIsbnText(e.target.value); setAddResult(null) }}
              placeholder={'9780062316097\n9780385490818'}
              rows={5}
              className="font-mono text-sm text-[var(--color-text-primary)] bg-[var(--color-surface-2)] border border-[var(--color-border-accent)] rounded-[var(--radius-md)] px-2.5 py-2 w-full outline-none resize-y"
            />
          </div>
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={loading || !isbnText.trim()}
              className={cn(
                'font-semibold px-5 py-2 rounded-[var(--radius-md)] transition-colors flex-shrink-0',
                loading || !isbnText.trim()
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-text-disabled)] cursor-not-allowed'
                  : 'bg-[var(--color-accent-gold)] text-[var(--color-base)] cursor-pointer hover:opacity-90'
              )}
            >
              {loading ? 'Adding…' : 'Add to list'}
            </button>
            {addResult && (
              <span className="text-sm text-[var(--color-text-muted)]">
                {addResult.added} added{addResult.skipped > 0 ? `, ${addResult.skipped} already in list` : ''}
              </span>
            )}
          </div>
        </form>
      )}

      {/* Item list panel */}
      {!loadingLists && selectedId && selectedList && (
        <div className="border border-[var(--color-border-accent)] rounded-[var(--radius-lg)] overflow-hidden bg-[var(--color-surface)]">

          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)] gap-2">
            <span className="text-sm text-[var(--color-text-muted)] flex-1 min-w-0">
              <span className="font-semibold text-[var(--color-text-primary)]">{selectedList.name}</span>
              {' · '}{selectedList.item_count} ISBN{selectedList.item_count !== 1 ? 's' : ''}
              {pendingCount > 0 && ` · ${pendingCount} pending`}
            </span>
            <div className="flex gap-1.5 flex-shrink-0">
              {pendingCount > 0 && !batchActive && (
                <button
                  onClick={() => setBatchActive(true)}
                  className="px-2.5 py-1 text-xs font-bold uppercase tracking-wide bg-[var(--color-accent-gold)] text-[var(--color-base)] rounded-[var(--radius-sm)] cursor-pointer hover:opacity-90 transition-opacity"
                >
                  Batch scan {pendingCount}
                </button>
              )}
              <button
                onClick={handleDeleteList}
                disabled={deletingList || isScanning}
                className={cn(
                  'px-2.5 py-1 text-xs font-bold uppercase tracking-wide border border-[var(--color-critical)] text-[var(--color-critical)] rounded-[var(--radius-sm)] bg-transparent transition-opacity',
                  deletingList || isScanning ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:opacity-70'
                )}
              >
                Delete list
              </button>
            </div>
          </div>

          {/* Batch scan panel */}
          {batchActive && (
            <div className="px-4 py-3 border-b border-[var(--color-border)] flex flex-col gap-2.5">
              {!isScanning && batchResults.length === 0 && (
                <div className="flex gap-2 items-end">
                  <div className="w-36">
                    <CockpitInput
                      label="Cost paid (CAD)"
                      type="number"
                      value={batchCost}
                      onChange={(e) => setBatchCost(e.target.value)}
                      step="0.01"
                      min="0.01"
                      max="999.99"
                    />
                  </div>
                  <button
                    onClick={handleBatchScan}
                    className="font-semibold px-5 py-2 rounded-[var(--radius-md)] bg-[var(--color-accent-gold)] text-[var(--color-base)] cursor-pointer hover:opacity-90 transition-opacity"
                  >
                    Start scan
                  </button>
                  <button
                    onClick={() => setBatchActive(false)}
                    className="font-semibold px-4 py-2 rounded-[var(--radius-md)] bg-transparent text-[var(--color-text-muted)] border border-[var(--color-border-accent)] cursor-pointer hover:text-[var(--color-text-primary)] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {isScanning && (
                <p className="text-sm text-[var(--color-text-muted)]">
                  Scanning {batchProgress!.current} of {batchProgress!.total}…
                </p>
              )}

              {batchResults.length > 0 && (
                <div className="flex flex-col">
                  {batchResults.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2.5 py-1.5 border-b border-[var(--color-border)] last:border-0"
                    >
                      <span className="font-mono text-sm text-[var(--color-text-primary)] flex-1">{r.isbn}</span>
                      {r.error ? (
                        <span className="text-xs text-[var(--color-text-disabled)]">{r.error}</span>
                      ) : (
                        <>
                          <span className="text-sm text-[var(--color-text-muted)] flex-[2] overflow-hidden text-ellipsis whitespace-nowrap">
                            {r.title ?? '—'}
                          </span>
                          <span
                            className={cn(
                              'font-mono text-sm min-w-[48px]',
                              r.profit !== null && r.profit >= 3
                                ? 'text-[var(--color-positive)]'
                                : 'text-[var(--color-text-muted)]'
                            )}
                          >
                            {r.profit !== null ? `$${r.profit.toFixed(2)}` : '—'}
                          </span>
                          <span
                            className={cn(
                              'text-xs font-bold min-w-[36px]',
                              r.decision === 'buy'
                                ? 'text-[var(--color-positive)]'
                                : 'text-[var(--color-text-disabled)]'
                            )}
                          >
                            {r.decision?.toUpperCase() ?? '—'}
                          </span>
                        </>
                      )}
                    </div>
                  ))}
                  {!isScanning && (
                    <div className="flex items-center justify-between pt-2">
                      <span className="text-sm text-[var(--color-text-muted)]">
                        {batchResults.filter((r) => !r.error).length} scanned
                        {' · '}{batchResults.filter((r) => r.decision === 'buy').length} BUY
                        {' · '}{batchResults.filter((r) => r.decision === 'skip').length} SKIP
                        {batchResults.filter((r) => r.error).length > 0 &&
                          ` · ${batchResults.filter((r) => r.error).length} failed`}
                      </span>
                      <button
                        onClick={() => { setBatchActive(false); setBatchResults([]) }}
                        className="text-sm font-semibold px-3 py-1 bg-transparent text-[var(--color-text-muted)] border border-[var(--color-border-accent)] rounded-[var(--radius-sm)] cursor-pointer hover:text-[var(--color-text-primary)] transition-colors"
                      >
                        Done
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Status filter tabs */}
          <div className="flex gap-1 px-4 py-2 border-b border-[var(--color-border)]">
            {(['all', 'pending', 'scanned', 'skipped'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={cn(
                  'px-3 py-1 text-xs font-semibold uppercase tracking-wide rounded transition-colors',
                  filterStatus === s
                    ? 'bg-[var(--color-accent-gold)] text-[var(--color-base)]'
                    : 'text-[var(--color-text-disabled)] hover:text-[var(--color-text-muted)]'
                )}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Items table */}
          {loadingItems ? (
            <p className="text-sm text-[var(--color-text-disabled)] px-4 py-3">Loading…</p>
          ) : filteredSortedItems.length === 0 ? (
            <p className="text-sm text-[var(--color-text-disabled)] px-4 py-3">
              {items.length === 0 ? 'No items yet. Add ISBNs above.' : 'No items match this filter.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead
                    onClick={() => toggleSort('isbn')}
                    className="cursor-pointer hover:text-[var(--color-text-primary)] select-none"
                  >
                    ISBN{sortIndicator('isbn')}
                  </TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead
                    onClick={() => toggleSort('bsr')}
                    className="cursor-pointer hover:text-[var(--color-text-primary)] select-none"
                  >
                    BSR{sortIndicator('bsr')}
                  </TableHead>
                  <TableHead
                    onClick={() => toggleSort('profit_cad')}
                    className="cursor-pointer hover:text-[var(--color-text-primary)] select-none"
                  >
                    Profit{sortIndicator('profit_cad')}
                  </TableHead>
                  <TableHead
                    onClick={() => toggleSort('roi_pct')}
                    className="cursor-pointer hover:text-[var(--color-text-primary)] select-none"
                  >
                    ROI{sortIndicator('roi_pct')}
                  </TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead
                    onClick={() => toggleSort('status')}
                    className="cursor-pointer hover:text-[var(--color-text-primary)] select-none"
                  >
                    Status{sortIndicator('status')}
                  </TableHead>
                  <TableHead
                    onClick={() => toggleSort('added_at')}
                    className="cursor-pointer hover:text-[var(--color-text-primary)] select-none"
                  >
                    Added{sortIndicator('added_at')}
                  </TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSortedItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-sm">{item.isbn}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm text-[var(--color-text-muted)]">
                      {item.title ?? '—'}
                    </TableCell>
                    <TableCell>
                      {item.bsr_history.length >= 2 ? (
                        <BsrSparkline data={item.bsr_history} />
                      ) : (
                        <span className="font-mono text-sm">
                          {item.bsr !== null ? item.bsr.toLocaleString() : '—'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {item.profit_cad !== null ? `$${item.profit_cad.toFixed(2)}` : '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {item.roi_pct !== null ? `${item.roi_pct.toFixed(0)}%` : '—'}
                    </TableCell>
                    <TableCell>
                      {item.decision ? (
                        <DecisionChip decision={item.decision} />
                      ) : (
                        <span className="text-[var(--color-text-disabled)]">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusChip status={item.status} />
                    </TableCell>
                    <TableCell className="text-xs text-[var(--color-text-disabled)]">
                      {fmtDate(item.added_at)}
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => handleDeleteItem(item.id)}
                        disabled={isScanning}
                        aria-label={`Remove ${item.isbn}`}
                        className={cn(
                          'text-base leading-none px-0.5 transition-colors',
                          isScanning
                            ? 'text-[var(--color-text-disabled)] cursor-not-allowed'
                            : 'text-[var(--color-text-disabled)] hover:text-[var(--color-critical)] cursor-pointer'
                        )}
                      >
                        ×
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {error && (
        <div className="text-[var(--color-critical)] bg-[var(--color-critical-dim)] border border-[var(--color-critical)] rounded-[var(--radius-md)] px-4 py-3 text-sm">
          {error}
        </div>
      )}
    </div>
  )
}
