'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { savePalletInvoice } from '../actions'

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function computeGst(total: string): string {
  const t = parseFloat(total)
  if (isNaN(t) || t <= 0) return ''
  return String(Math.round((t / 1.05) * 0.05 * 100) / 100)
}

export function PalletInvoiceForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [invoiceMonth, setInvoiceMonth] = useState(currentMonth)
  const [vendor, setVendor] = useState('')
  const [palletsCount, setPalletsCount] = useState('1')
  const [totalCost, setTotalCost] = useState('')
  const [gstAmount, setGstAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [clientError, setClientError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  function handleTotalChange(value: string) {
    setTotalCost(value)
    setGstAmount(computeGst(value))
  }

  function validateClient(): string | null {
    if (!invoiceMonth || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceMonth)) return 'Select a valid month.'
    if (!vendor.trim()) return 'Vendor is required.'
    const count = parseInt(palletsCount, 10)
    if (isNaN(count) || count < 1) return 'Pallets count must be a positive integer.'
    const total = parseFloat(totalCost)
    if (isNaN(total) || total <= 0) return 'Total cost must be positive.'
    const gst = parseFloat(gstAmount)
    if (isNaN(gst) || gst < 0) return 'GST amount must be >= 0.'
    return null
  }

  function clearForm() {
    setInvoiceMonth(currentMonth())
    setVendor('')
    setPalletsCount('1')
    setTotalCost('')
    setGstAmount('')
    setNotes('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setClientError(null)
    setServerError(null)
    setSuccessMsg(null)

    const err = validateClient()
    if (err) { setClientError(err); return }

    startTransition(async () => {
      const result = await savePalletInvoice({
        invoice_month: invoiceMonth,
        vendor: vendor.trim(),
        pallets_count: parseInt(palletsCount, 10),
        total_cost_incl_gst: parseFloat(totalCost),
        gst_amount: parseFloat(gstAmount),
        notes: notes.trim() || null,
      })

      if (!result.ok) { setServerError(result.error); return }

      setSuccessMsg(`Saved ${result.invoice.vendor} — ${result.invoice.invoice_month.slice(0, 7)}.`)
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
          Add Pallet Invoice
        </span>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            margin: '4px 0 0',
          }}
        >
          Monthly pallet purchase · GST auto-split (editable)
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 16,
            marginBottom: 16,
          }}
        >
          {/* Invoice month — first of month stored in DB */}
          <div>
            <label htmlFor="pallet-month" style={labelStyle}>Month</label>
            <input
              id="pallet-month"
              type="month"
              value={invoiceMonth.slice(0, 7)}
              onChange={(e) => setInvoiceMonth(e.target.value ? `${e.target.value}-01` : '')}
              style={inputStyle}
            />
          </div>

          {/* Vendor */}
          <div>
            <label htmlFor="pallet-vendor" style={labelStyle}>Vendor</label>
            <input
              id="pallet-vendor"
              type="text"
              placeholder="e.g. Costco"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              style={inputStyle}
              autoComplete="off"
            />
          </div>

          {/* Pallets count */}
          <div>
            <label htmlFor="pallet-count" style={labelStyle}>Pallets</label>
            <input
              id="pallet-count"
              type="number"
              min="1"
              step="1"
              placeholder="1"
              value={palletsCount}
              onChange={(e) => setPalletsCount(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Total cost incl GST */}
          <div>
            <label htmlFor="pallet-total" style={labelStyle}>Total incl GST (CAD)</label>
            <input
              id="pallet-total"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="1575.00"
              value={totalCost}
              onChange={(e) => handleTotalChange(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* GST amount — auto-computed, editable */}
          <div>
            <label htmlFor="pallet-gst" style={labelStyle}>GST amount (CAD)</label>
            <input
              id="pallet-gst"
              type="number"
              min="0"
              step="0.01"
              placeholder="75.00"
              value={gstAmount}
              onChange={(e) => setGstAmount(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Notes */}
          <div style={{ gridColumn: 'span 2' }}>
            <label htmlFor="pallet-notes" style={labelStyle}>Notes (optional)</label>
            <input
              id="pallet-notes"
              type="text"
              placeholder="e.g. April 2026 mixed goods pallet"
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
          {isPending ? 'Saving…' : 'Save Invoice'}
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
