'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveCostEntry } from '../actions'
import type { FbaInventoryItem } from '@/lib/amazon/inventory'
import type { FifoResult } from '@/lib/cogs/fifo'

interface Props {
  items: FbaInventoryItem[]
  fifo: FifoResult
  today: string // YYYY-MM-DD for default purchased_at
}

function todayDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const thStyle: React.CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-nano)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  textAlign: 'left',
  padding: '6px 12px',
  borderBottom: '1px solid var(--color-border)',
}

const tdStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-small)',
  color: 'var(--color-text-secondary)',
  padding: '8px 12px',
  borderBottom: '1px solid var(--color-border-subtle)',
  verticalAlign: 'middle',
}

export function InventoryTable({ items, fifo, today }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Per-row cost input state: asin → cost string
  const [costInputs, setCostInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.asin, '']))
  )
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [rowSuccess, setRowSuccess] = useState<Record<string, string>>({})

  function handleCostChange(asin: string, value: string) {
    setCostInputs((prev) => ({ ...prev, [asin]: value }))
    setRowErrors((prev) => ({ ...prev, [asin]: '' }))
    setRowSuccess((prev) => ({ ...prev, [asin]: '' }))
  }

  function handleSave(asin: string) {
    const raw = costInputs[asin] ?? ''
    const cost = parseFloat(raw)
    if (isNaN(cost) || cost <= 0) {
      setRowErrors((prev) => ({ ...prev, [asin]: 'Enter a positive cost.' }))
      return
    }

    startTransition(async () => {
      const result = await saveCostEntry({
        asin,
        unit_cost_cad: cost,
        quantity: 1,
        purchased_at: today,
      })

      if (!result.ok) {
        setRowErrors((prev) => ({ ...prev, [asin]: result.error }))
        return
      }

      setRowSuccess((prev) => ({ ...prev, [asin]: 'Saved.' }))
      setCostInputs((prev) => ({ ...prev, [asin]: '' }))
      router.refresh()
    })
  }

  const inputStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-small)',
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '4px 8px',
    width: 90,
    outline: 'none',
  }

  return (
    <div>
      {/* FIFO total value tile */}
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          padding: '16px 24px',
          marginBottom: 24,
          display: 'inline-block',
          minWidth: 200,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--color-text-muted)',
            display: 'block',
            marginBottom: 4,
          }}
        >
          Total inventory value (FIFO · non-books)
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-heading)',
            fontWeight: 700,
            color: 'var(--color-pillar-money)',
          }}
        >
          ${fifo.total.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>

      {/* Inventory table */}
      {items.length === 0 ? (
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            fontStyle: 'italic',
          }}
        >
          No active FBA inventory found.
        </p>
      ) : (
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            overflow: 'hidden',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>ASIN</th>
                  <th style={thStyle}>SKU</th>
                  <th style={thStyle}>Title</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>FBA Qty</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>FIFO value</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Costed / Total</th>
                  <th style={thStyle}>Add cost</th>
                  <th style={thStyle}>History</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const asinResult = fifo.byAsin[item.asin]
                  const isBook = /^\d/.test(item.asin)
                  return (
                    <tr key={item.asin}>
                      <td style={{ ...tdStyle, color: 'var(--color-text-primary)', fontWeight: 600 }}>
                        {item.asin}
                        {isBook && (
                          <span
                            style={{
                              marginLeft: 6,
                              fontFamily: 'var(--font-ui)',
                              fontSize: 'var(--text-nano)',
                              color: 'var(--color-text-disabled)',
                              fontWeight: 400,
                            }}
                          >
                            book
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>{item.sku || '—'}</td>
                      <td
                        style={{
                          ...tdStyle,
                          maxWidth: 220,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={item.product_name ?? undefined}
                      >
                        {item.product_name ?? '—'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{item.fulfillable_quantity}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: isBook ? 'var(--color-text-disabled)' : 'var(--color-text-primary)' }}>
                        {asinResult
                          ? `$${asinResult.value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : '—'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {asinResult
                          ? `${asinResult.unitsCosted} / ${item.fulfillable_quantity}`
                          : `0 / ${item.fulfillable_quantity}`}
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            placeholder="$0.00"
                            value={costInputs[item.asin] ?? ''}
                            onChange={(e) => handleCostChange(item.asin, e.target.value)}
                            style={inputStyle}
                            aria-label={`Cost for ${item.asin}`}
                          />
                          <button
                            onClick={() => handleSave(item.asin)}
                            disabled={isPending}
                            style={{
                              fontFamily: 'var(--font-ui)',
                              fontSize: 'var(--text-nano)',
                              fontWeight: 600,
                              padding: '4px 10px',
                              backgroundColor: isPending ? 'var(--color-surface-2)' : 'var(--color-pillar-money)',
                              color: isPending ? 'var(--color-text-disabled)' : 'var(--color-base)',
                              border: 'none',
                              borderRadius: 'var(--radius-sm)',
                              cursor: isPending ? 'not-allowed' : 'pointer',
                            }}
                          >
                            Save
                          </button>
                        </div>
                        {rowErrors[item.asin] && (
                          <span
                            style={{
                              display: 'block',
                              fontFamily: 'var(--font-ui)',
                              fontSize: 'var(--text-nano)',
                              color: 'var(--color-critical)',
                              marginTop: 2,
                            }}
                          >
                            {rowErrors[item.asin]}
                          </span>
                        )}
                        {rowSuccess[item.asin] && (
                          <span
                            style={{
                              display: 'block',
                              fontFamily: 'var(--font-ui)',
                              fontSize: 'var(--text-nano)',
                              color: 'var(--color-positive)',
                              marginTop: 2,
                            }}
                          >
                            {rowSuccess[item.asin]}
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <a
                          href="/cogs"
                          style={{
                            fontFamily: 'var(--font-ui)',
                            fontSize: 'var(--text-nano)',
                            color: 'var(--color-text-muted)',
                            textDecoration: 'underline',
                          }}
                        >
                          COGS
                        </a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
