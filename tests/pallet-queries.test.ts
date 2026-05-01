import { describe, it, expect } from 'vitest'
import { PalletInvoiceInsertSchema } from '@/lib/pallets/validation'

describe('PalletInvoiceInsertSchema', () => {
  const validInput = {
    invoice_month: '2026-04-01',
    vendor: 'Costco',
    pallets_count: 3,
    total_cost_incl_gst: 1575.00,
    gst_amount: 75.00,
    notes: null,
  }

  it('accepts valid input', () => {
    const result = PalletInvoiceInsertSchema.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it('accepts valid input without notes', () => {
    const { notes: _, ...withoutNotes } = validInput
    const result = PalletInvoiceInsertSchema.safeParse(withoutNotes)
    expect(result.success).toBe(true)
  })

  it('accepts notes as undefined', () => {
    const result = PalletInvoiceInsertSchema.safeParse({ ...validInput, notes: undefined })
    expect(result.success).toBe(true)
  })

  it('rejects missing vendor', () => {
    const { vendor: _, ...rest } = validInput
    const result = PalletInvoiceInsertSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects empty vendor string', () => {
    const result = PalletInvoiceInsertSchema.safeParse({ ...validInput, vendor: '' })
    expect(result.success).toBe(false)
  })

  it('trims vendor whitespace', () => {
    const result = PalletInvoiceInsertSchema.safeParse({ ...validInput, vendor: '  Costco  ' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.vendor).toBe('Costco')
  })

  it('rejects pallets_count = 0', () => {
    const result = PalletInvoiceInsertSchema.safeParse({ ...validInput, pallets_count: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects pallets_count negative', () => {
    const result = PalletInvoiceInsertSchema.safeParse({ ...validInput, pallets_count: -1 })
    expect(result.success).toBe(false)
  })

  it('rejects pallets_count non-integer', () => {
    const result = PalletInvoiceInsertSchema.safeParse({ ...validInput, pallets_count: 1.5 })
    expect(result.success).toBe(false)
  })

  it('rejects total_cost_incl_gst = 0', () => {
    const result = PalletInvoiceInsertSchema.safeParse({ ...validInput, total_cost_incl_gst: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects total_cost_incl_gst negative', () => {
    const result = PalletInvoiceInsertSchema.safeParse({ ...validInput, total_cost_incl_gst: -100 })
    expect(result.success).toBe(false)
  })

  it('rejects gst_amount negative', () => {
    const result = PalletInvoiceInsertSchema.safeParse({ ...validInput, gst_amount: -1 })
    expect(result.success).toBe(false)
  })

  it('accepts gst_amount = 0', () => {
    const result = PalletInvoiceInsertSchema.safeParse({ ...validInput, gst_amount: 0 })
    expect(result.success).toBe(true)
  })

  it('rejects invalid invoice_month format', () => {
    const result = PalletInvoiceInsertSchema.safeParse({ ...validInput, invoice_month: '2026-04' })
    expect(result.success).toBe(false)
  })

  it('rejects invoice_month as non-date string', () => {
    const result = PalletInvoiceInsertSchema.safeParse({ ...validInput, invoice_month: 'April 2026' })
    expect(result.success).toBe(false)
  })
})
