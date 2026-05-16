'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  INVENTORY_CATEGORIES,
  INVENTORY_STATUSES,
  type InventoryCategory,
  type InventoryRow,
  type InventoryStatus,
} from '@/lib/diet/types'
import { alreadyExpired, expiringSoon } from '@/lib/diet/helpers'
import {
  buttonDanger,
  buttonGhost,
  buttonPrimary,
  cardStyle,
  Disclosure,
  EmptyState,
  inputStyle,
  labelStyle,
  sectionTitle,
  StatusLine,
  tableCell,
  tableHeaderCell,
} from './DietCommon'

const today = () => new Date().toISOString().slice(0, 10)

export function InventoryTab({ inventory }: { inventory: InventoryRow[] }) {
  const router = useRouter()
  const [item, setItem] = useState('')
  const [category, setCategory] = useState<InventoryCategory>('Pantry')
  const [qty, setQty] = useState(1)
  const [unit, setUnit] = useState('count')
  const [purchasedOn, setPurchasedOn] = useState(today())
  const [expiresOn, setExpiresOn] = useState('')
  const [status, setStatus] = useState<InventoryStatus>('On hand')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<{
    tone: 'ok' | 'error'
    message: string
  } | null>(null)

  const todayStr = today()
  const expiring = expiringSoon(inventory, todayStr, 7)
  const expired = alreadyExpired(inventory, todayStr)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!item.trim()) {
      setSubmitStatus({ tone: 'error', message: 'Enter an item' })
      return
    }
    setSubmitting(true)
    setSubmitStatus(null)
    try {
      const res = await fetch('/api/diet/inventory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          item,
          category,
          qty,
          unit,
          purchased_on: purchasedOn,
          expires_on: expiresOn || null,
          status,
          notes,
        }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !body.ok) {
        setSubmitStatus({ tone: 'error', message: body.error ?? `HTTP ${res.status}` })
      } else {
        setItem('')
        setNotes('')
        setExpiresOn('')
        setSubmitStatus({ tone: 'ok', message: 'Added.' })
        router.refresh()
      }
    } catch (err) {
      setSubmitStatus({ tone: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setSubmitting(false)
    }
  }

  async function updateStatus(id: string, newStatus: InventoryStatus) {
    const res = await fetch(`/api/diet/inventory/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    if (res.ok) router.refresh()
  }

  async function deleteItem(id: string) {
    if (!confirm('Delete this inventory item?')) return
    const res = await fetch(`/api/diet/inventory/${id}`, { method: 'DELETE' })
    if (res.ok) router.refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Disclosure title="+ Add Inventory Item">
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Item</div>
              <input
                type="text"
                value={item}
                onChange={(e) => setItem(e.target.value)}
                placeholder="e.g. Bananas, Tuna cans, Olive oil"
                style={inputStyle}
                required
              />
            </label>
            <label>
              <div style={labelStyle}>Category</div>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as InventoryCategory)}
                style={inputStyle}
              >
                {INVENTORY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
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
              <div style={labelStyle}>Purchased</div>
              <input
                type="date"
                value={purchasedOn}
                onChange={(e) => setPurchasedOn(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Expires (optional)</div>
              <input
                type="date"
                value={expiresOn}
                onChange={(e) => setExpiresOn(e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Status</div>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as InventoryStatus)}
                style={inputStyle}
              >
                {INVENTORY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
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
              {submitting ? 'Saving…' : 'Add Item'}
            </button>
            <StatusLine status={submitStatus} />
          </div>
        </form>
      </Disclosure>

      {(expired.length > 0 || expiring.length > 0) && (
        <div style={cardStyle}>
          <span style={sectionTitle}>Expiration Alerts</span>
          {expired.length > 0 && (
            <div>
              <div
                style={{
                  ...labelStyle,
                  color: 'var(--color-critical)',
                  marginBottom: 6,
                }}
              >
                Already Expired ({expired.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {expired.map((r) => (
                  <span
                    key={r.id}
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      padding: '4px 10px',
                      background: 'var(--color-critical-dim)',
                      color: 'var(--color-critical)',
                      border: '1px solid var(--color-critical)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    {r.item} · {r.expires_on}
                  </span>
                ))}
              </div>
            </div>
          )}
          {expiring.length > 0 && (
            <div>
              <div
                style={{
                  ...labelStyle,
                  color: 'var(--color-pillar-money)',
                  marginBottom: 6,
                }}
              >
                Expiring within 7 days ({expiring.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {expiring.map((r) => (
                  <span
                    key={r.id}
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      padding: '4px 10px',
                      background: 'var(--color-surface-2)',
                      color: 'var(--color-pillar-money)',
                      border: '1px solid var(--color-pillar-money)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    {r.item} · {r.expires_on}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {inventory.length > 0 && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', gap: 24 }}>
            {(['On hand', 'Low', 'Out'] as const).map((s) => {
              const n = inventory.filter((r) => r.status === s).length
              const color =
                s === 'Low'
                  ? 'var(--color-pillar-money)'
                  : s === 'Out'
                    ? 'var(--color-critical)'
                    : 'var(--color-text-primary)'
              return (
                <div key={s} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ ...labelStyle }}>{s}</span>
                  <span
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-body)',
                      fontWeight: 700,
                      color,
                    }}
                  >
                    {n}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {inventory.length === 0 ? (
        <EmptyState message="No inventory items yet." />
      ) : (
        <div style={cardStyle}>
          <span style={sectionTitle}>Inventory ({inventory.length})</span>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={tableHeaderCell}>Item</th>
                  <th style={tableHeaderCell}>Category</th>
                  <th style={tableHeaderCell}>Qty</th>
                  <th style={tableHeaderCell}>Unit</th>
                  <th style={tableHeaderCell}>Purchased</th>
                  <th style={tableHeaderCell}>Expires</th>
                  <th style={tableHeaderCell}>Status</th>
                  <th style={tableHeaderCell}></th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...tableCell, fontWeight: 600 }}>{r.item}</td>
                    <td style={tableCell}>{r.category}</td>
                    <td style={tableCell}>{r.qty}</td>
                    <td style={tableCell}>{r.unit}</td>
                    <td style={tableCell}>{r.purchased_on}</td>
                    <td style={tableCell}>{r.expires_on || '—'}</td>
                    <td style={tableCell}>
                      <select
                        value={r.status}
                        onChange={(e) => updateStatus(r.id, e.target.value as InventoryStatus)}
                        style={{
                          ...inputStyle,
                          padding: '4px 6px',
                          fontSize: 'var(--text-nano)',
                          width: 'auto',
                        }}
                      >
                        {INVENTORY_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={tableCell}>
                      <button onClick={() => deleteItem(r.id)} style={buttonDanger}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
