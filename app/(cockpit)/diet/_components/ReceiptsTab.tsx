'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RECEIPT_CATEGORIES, type ReceiptCategory, type ReceiptRow } from '@/lib/diet/types'
import { summarizeReceipts } from '@/lib/diet/helpers'
import {
  buttonDanger,
  buttonPrimary,
  cardStyle,
  Disclosure,
  EmptyState,
  formatCurrency,
  inputStyle,
  labelStyle,
  sectionTitle,
  StatusLine,
  tableCell,
  tableHeaderCell,
} from './DietCommon'
import { ScanReceiptButton } from './ScanReceiptButton'

const today = () => new Date().toISOString().slice(0, 10)

export function ReceiptsTab({ receipts }: { receipts: ReceiptRow[] }) {
  const router = useRouter()
  const [purchasedOn, setPurchasedOn] = useState(today())
  const [store, setStore] = useState('')
  const [item, setItem] = useState('')
  const [price, setPrice] = useState('')
  const [category, setCategory] = useState<ReceiptCategory>('Other')
  const [qty, setQty] = useState(1)
  const [unit, setUnit] = useState('count')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<{
    tone: 'ok' | 'error'
    message: string
  } | null>(null)

  const [storeFilter, setStoreFilter] = useState<string>('All')
  const stores = Array.from(new Set(receipts.map((r) => r.store).filter(Boolean))).sort()
  const filteredReceipts =
    storeFilter === 'All' ? receipts : receipts.filter((r) => r.store === storeFilter)
  const summary = summarizeReceipts(filteredReceipts)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!item.trim() || !store.trim()) {
      setSubmitStatus({ tone: 'error', message: 'Item and store are required' })
      return
    }
    const priceNum = Number(price)
    if (!Number.isFinite(priceNum)) {
      setSubmitStatus({ tone: 'error', message: 'Price must be numeric' })
      return
    }
    setSubmitting(true)
    setSubmitStatus(null)
    try {
      const res = await fetch('/api/diet/receipts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          purchased_on: purchasedOn,
          store,
          item,
          price: priceNum,
          category,
          qty,
          unit,
          notes,
        }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !body.ok) {
        setSubmitStatus({ tone: 'error', message: body.error ?? `HTTP ${res.status}` })
      } else {
        setItem('')
        setPrice('')
        setNotes('')
        setSubmitStatus({ tone: 'ok', message: 'Added.' })
        router.refresh()
      }
    } catch (err) {
      setSubmitStatus({ tone: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setSubmitting(false)
    }
  }

  async function deleteReceipt(id: string) {
    if (!confirm('Delete this receipt line?')) return
    const res = await fetch(`/api/diet/receipts/${id}`, { method: 'DELETE' })
    if (res.ok) router.refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ScanReceiptButton />
      <Disclosure title="+ Add Receipt Item">
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Date</div>
              <input
                type="date"
                value={purchasedOn}
                onChange={(e) => setPurchasedOn(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Store</div>
              <input
                type="text"
                value={store}
                onChange={(e) => setStore(e.target.value)}
                placeholder="e.g. Costco #154, Superstore Kingsway"
                style={inputStyle}
                required
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Item</div>
              <input
                type="text"
                value={item}
                onChange={(e) => setItem(e.target.value)}
                style={inputStyle}
                required
              />
            </label>
            <label>
              <div style={labelStyle}>Price (negative = discount)</div>
              <input
                type="text"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="e.g. 7.49 or -4.00"
                style={inputStyle}
                required
              />
            </label>
            <label>
              <div style={labelStyle}>Category</div>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ReceiptCategory)}
                style={inputStyle}
              >
                {RECEIPT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Qty</div>
              <input
                type="number"
                step="0.1"
                value={qty}
                onChange={(e) => setQty(Number(e.target.value))}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Unit</div>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Notes</div>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="submit" disabled={submitting} style={buttonPrimary}>
              {submitting ? 'Saving…' : 'Add Receipt Item'}
            </button>
            <StatusLine status={submitStatus} />
          </div>
        </form>
      </Disclosure>

      {receipts.length === 0 ? (
        <EmptyState message="No receipts logged yet. Use Scan Receipt above or add items manually." />
      ) : (
        <>
          {stores.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={labelStyle}>Filter by store</span>
              <select
                value={storeFilter}
                onChange={(e) => setStoreFilter(e.target.value)}
                style={{ ...inputStyle, width: 'auto' }}
              >
                <option value="All">All</option>
                {stores.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 16,
            }}
          >
            <SummaryCard
              label="Total Spent"
              value={formatCurrency(summary.totalSpent)}
              sub={`${summary.itemCount} items`}
            />
            <SummaryCard
              label="Instant Savings"
              value={`-${formatCurrency(summary.totalSaved)}`}
              sub="Coupons & discounts"
              color="var(--color-positive)"
            />
            <SummaryCard
              label="Net Cost"
              value={formatCurrency(summary.netCost)}
              sub={`${summary.storeCount} store(s)`}
            />
            <SummaryCard
              label="Avg Per Item"
              value={formatCurrency(summary.avgPerItem)}
              sub={`${summary.itemCount} items`}
            />
          </div>

          {Object.keys(summary.byCategory).length > 0 && (
            <div style={cardStyle}>
              <span style={sectionTitle}>Spend by Category</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {Object.entries(summary.byCategory)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, amt]) => (
                    <span
                      key={cat}
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-nano)',
                        padding: '4px 10px',
                        background: 'var(--color-surface-2)',
                        color: 'var(--color-text-primary)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      {cat} · {formatCurrency(amt)}
                    </span>
                  ))}
              </div>
            </div>
          )}

          <div style={cardStyle}>
            <span style={sectionTitle}>Items ({filteredReceipts.length})</span>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={tableHeaderCell}>Date</th>
                    <th style={tableHeaderCell}>Store</th>
                    <th style={tableHeaderCell}>Item</th>
                    <th style={{ ...tableHeaderCell, textAlign: 'right' }}>Price</th>
                    <th style={tableHeaderCell}>Category</th>
                    <th style={tableHeaderCell}>Qty</th>
                    <th style={tableHeaderCell}>Notes</th>
                    <th style={tableHeaderCell}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReceipts.map((r) => (
                    <tr key={r.id}>
                      <td style={tableCell}>{r.purchased_on}</td>
                      <td style={tableCell}>{r.store}</td>
                      <td style={{ ...tableCell, fontWeight: 600 }}>{r.item}</td>
                      <td
                        style={{
                          ...tableCell,
                          textAlign: 'right',
                          fontFamily: 'var(--font-mono)',
                          fontVariantNumeric: 'tabular-nums',
                          color:
                            r.price < 0 ? 'var(--color-positive)' : 'var(--color-text-primary)',
                        }}
                      >
                        {formatCurrency(r.price)}
                      </td>
                      <td style={tableCell}>{r.category}</td>
                      <td style={tableCell}>
                        {r.qty} {r.unit}
                      </td>
                      <td style={tableCell}>{r.notes || '—'}</td>
                      <td style={tableCell}>
                        <button onClick={() => deleteReceipt(r.id)} style={buttonDanger}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function SummaryCard({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: string
  sub: string
  color?: string
}) {
  return (
    <div style={cardStyle}>
      <span style={labelStyle}>{label}</span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-pillar-value)',
          fontWeight: 700,
          color: color ?? 'var(--color-text-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          color: 'var(--color-text-disabled)',
        }}
      >
        {sub}
      </span>
    </div>
  )
}
