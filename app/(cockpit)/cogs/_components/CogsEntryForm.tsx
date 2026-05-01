'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveCogsEntry } from '../actions'

function todayDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function CogsEntryForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [asin, setAsin] = useState('')
  const [pricingModel, setPricingModel] = useState<'per_unit' | 'pallet'>('per_unit')
  const [unitCost, setUnitCost] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [purchasedAt, setPurchasedAt] = useState(todayDate)
  const [vendor, setVendor] = useState('')
  const [notes, setNotes] = useState('')
  const [clientError, setClientError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  function validateClient(): string | null {
    if (!/^[A-Z0-9]{1,20}$/.test(asin.trim().toUpperCase())) {
      return 'ASIN must be 1–20 uppercase alphanumeric characters.'
    }
    const qty = parseInt(quantity, 10)
    if (isNaN(qty) || qty < 1) return 'Quantity must be a positive integer.'
    if (pricingModel === 'per_unit') {
      const cost = parseFloat(unitCost)
      if (isNaN(cost) || cost <= 0)
        return 'Unit cost must be a positive number for per-unit entries.'
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(purchasedAt)) return 'Date must be YYYY-MM-DD.'
    return null
  }

  function clearForm() {
    setAsin('')
    setPricingModel('per_unit')
    setUnitCost('')
    setQuantity('1')
    setPurchasedAt(todayDate())
    setVendor('')
    setNotes('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setClientError(null)
    setServerError(null)
    setSuccessMsg(null)

    const err = validateClient()
    if (err) {
      setClientError(err)
      return
    }

    startTransition(async () => {
      const result = await saveCogsEntry({
        asin: asin.trim().toUpperCase(),
        pricing_model: pricingModel,
        unit_cost_cad: pricingModel === 'per_unit' ? parseFloat(unitCost) : null,
        quantity: parseInt(quantity, 10),
        purchased_at: purchasedAt,
        vendor: vendor.trim() || null,
        notes: notes.trim() || null,
        source: 'manual',
      })

      if (!result.ok) {
        setServerError(result.error)
        return
      }

      setSuccessMsg(`Saved ${result.entry.asin} — ${purchasedAt}.`)
      clearForm()
      router.refresh()
    })
  }

  const inputStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-body)',
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '6px 10px',
    width: '100%',
    outline: 'none',
  }

  const labelStyle: React.CSSProperties = {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--color-text-muted)',
    display: 'block',
    marginBottom: 4,
  }

  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        padding: '20px 24px',
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--color-pillar-money)',
          }}
        >
          Add COGS Entry
        </span>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            margin: '4px 0 0',
          }}
        >
          Manual entry · per-unit or pallet pricing
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        {/* Pricing model radio */}
        <div style={{ marginBottom: 16 }}>
          <span style={labelStyle}>Pricing model</span>
          <div style={{ display: 'flex', gap: 20 }}>
            {(['per_unit', 'pallet'] as const).map((model) => (
              <label
                key={model}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                <input
                  type="radio"
                  name="pricing_model"
                  value={model}
                  checked={pricingModel === model}
                  onChange={() => {
                    setPricingModel(model)
                    setUnitCost('')
                  }}
                />
                {model === 'per_unit' ? 'Per unit' : 'Pallet'}
              </label>
            ))}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 16,
            marginBottom: 16,
          }}
        >
          {/* ASIN */}
          <div>
            <label htmlFor="cogs-asin" style={labelStyle}>
              ASIN
            </label>
            <input
              id="cogs-asin"
              type="text"
              placeholder="B08XYZ1234"
              value={asin}
              onChange={(e) => setAsin(e.target.value.toUpperCase())}
              style={inputStyle}
              autoComplete="off"
              maxLength={20}
            />
          </div>

          {/* Unit cost — shown only for per_unit */}
          {pricingModel === 'per_unit' && (
            <div>
              <label htmlFor="cogs-unit-cost" style={labelStyle}>
                Unit cost (CAD)
              </label>
              <input
                id="cogs-unit-cost"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="12.50"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                style={inputStyle}
              />
            </div>
          )}

          {/* Pallet note — shown only for pallet */}
          {pricingModel === 'pallet' && (
            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 6 }}>
              <span
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-disabled)',
                  fontStyle: 'italic',
                }}
              >
                Pallet pricing — per-unit cost not tracked
              </span>
            </div>
          )}

          {/* Quantity */}
          <div>
            <label htmlFor="cogs-quantity" style={labelStyle}>
              Quantity
            </label>
            <input
              id="cogs-quantity"
              type="number"
              min="1"
              step="1"
              placeholder="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Purchased at */}
          <div>
            <label htmlFor="cogs-purchased-at" style={labelStyle}>
              Purchased
            </label>
            <input
              id="cogs-purchased-at"
              type="date"
              value={purchasedAt}
              onChange={(e) => setPurchasedAt(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Vendor */}
          <div>
            <label htmlFor="cogs-vendor" style={labelStyle}>
              Vendor (optional)
            </label>
            <input
              id="cogs-vendor"
              type="text"
              placeholder="e.g. Costco"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              style={inputStyle}
              autoComplete="off"
            />
          </div>

          {/* Notes */}
          <div style={{ gridColumn: 'span 2' }}>
            <label htmlFor="cogs-notes" style={labelStyle}>
              Notes (optional)
            </label>
            <input
              id="cogs-notes"
              type="text"
              placeholder="e.g. 12-pack purchase Apr 2026"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={inputStyle}
              autoComplete="off"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isPending}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            fontWeight: 600,
            letterSpacing: '0.06em',
            padding: '8px 20px',
            backgroundColor: isPending ? 'var(--color-surface-2)' : 'var(--color-pillar-money)',
            color: isPending ? 'var(--color-text-disabled)' : 'var(--color-base)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: isPending ? 'not-allowed' : 'pointer',
            transition: 'var(--transition-fast)',
          }}
        >
          {isPending ? 'Saving…' : 'Save Entry'}
        </button>
      </form>

      {(clientError ?? serverError) && (
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-critical)',
            marginTop: 12,
          }}
        >
          {clientError ?? serverError}
        </p>
      )}
      {successMsg && (
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-positive)',
            marginTop: 12,
          }}
        >
          {successMsg}
        </p>
      )}
    </div>
  )
}
