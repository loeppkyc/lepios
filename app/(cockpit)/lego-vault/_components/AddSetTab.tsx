'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const STATUS_OPTIONS = [
  { value: 'in_vault_sealed', label: 'In Vault (Sealed)' },
  { value: 'in_vault_opened', label: 'In Vault (Opened)' },
  { value: 'long_term_hold', label: 'Long-Term Hold' },
  { value: 'ready_to_ship', label: 'Ready to Ship' },
  { value: 'shipped_to_fba', label: 'Shipped to FBA' },
  { value: 'live_on_amazon', label: 'Listed on Amazon' },
  { value: 'sold', label: 'Sold' },
  { value: 'personal_collection', label: 'Personal Collection' },
]

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        {label}
        {required && <span className="ml-0.5 text-[var(--color-critical)]">*</span>}
      </Label>
      {children}
    </div>
  )
}

export function AddSetTab() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    set_number: '',
    name: '',
    asin: '',
    theme: '',
    paid_cad: '',
    target_sell_cad: '',
    qty: '1',
    location: '',
    status: 'in_vault_sealed',
    notes: '',
  })

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setError(null)
    setSuccess(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!form.set_number.trim()) {
      setError('Set number is required.')
      return
    }

    const paid = form.paid_cad ? parseFloat(form.paid_cad) : null
    const target = form.target_sell_cad ? parseFloat(form.target_sell_cad) : null
    const qty = parseInt(form.qty || '1', 10)

    if (paid != null && isNaN(paid)) {
      setError('Paid price must be a number.')
      return
    }
    if (target != null && isNaN(target)) {
      setError('Target price must be a number.')
      return
    }
    if (isNaN(qty) || qty < 1) {
      setError('Quantity must be at least 1.')
      return
    }
    if (form.asin && form.asin.length !== 10) {
      setError('ASIN must be exactly 10 characters (leave blank if unknown).')
      return
    }

    setSaving(true)
    setError(null)

    const db = createClient()
    const { error: err } = await db.from('lego_vault').insert({
      set_number: form.set_number.trim(),
      name: form.name.trim(),
      asin: form.asin.trim().toUpperCase(),
      theme: form.theme.trim(),
      paid_cad: paid,
      target_sell_cad: target,
      qty,
      location: form.location.trim(),
      status: form.status,
      notes: form.notes.trim(),
    })

    setSaving(false)

    if (err) {
      setError(err.message)
      return
    }

    setSuccess(true)
    setForm({
      set_number: '',
      name: '',
      asin: '',
      theme: '',
      paid_cad: '',
      target_sell_cad: '',
      qty: '1',
      location: '',
      status: 'in_vault_sealed',
      notes: '',
    })
    router.refresh()
  }

  return (
    <div className="max-w-xl">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Set Number" required>
            <Input
              placeholder="e.g. 10307"
              value={form.set_number}
              onChange={(e) => update('set_number', e.target.value)}
            />
          </Field>
          <Field label="Theme">
            <Input
              placeholder="e.g. Icons"
              value={form.theme}
              onChange={(e) => update('theme', e.target.value)}
            />
          </Field>
        </div>

        <Field label="Name">
          <Input
            placeholder="e.g. Eiffel Tower"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
          />
        </Field>

        <Field label="ASIN (Amazon.ca — 10 chars)">
          <Input
            placeholder="e.g. B0BFSD3D2B"
            value={form.asin}
            onChange={(e) => update('asin', e.target.value)}
            maxLength={10}
          />
        </Field>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Paid (CAD)">
            <Input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={form.paid_cad}
              onChange={(e) => update('paid_cad', e.target.value)}
            />
          </Field>
          <Field label="Target Sell (CAD)">
            <Input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={form.target_sell_cad}
              onChange={(e) => update('target_sell_cad', e.target.value)}
            />
          </Field>
          <Field label="Qty">
            <Input
              type="number"
              min="1"
              step="1"
              placeholder="1"
              value={form.qty}
              onChange={(e) => update('qty', e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Status">
            <select
              value={form.status}
              onChange={(e) => update('status', e.target.value)}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:ring-1 focus:ring-[var(--color-pillar-money)] focus:outline-none"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Location">
            <Input
              placeholder="e.g. Shelf A3"
              value={form.location}
              onChange={(e) => update('location', e.target.value)}
            />
          </Field>
        </div>

        <Field label="Notes">
          <textarea
            rows={3}
            placeholder="Any notes about condition, purchase source, etc."
            value={form.notes}
            onChange={(e) => update('notes', e.target.value)}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:ring-1 focus:ring-[var(--color-pillar-money)] focus:outline-none"
          />
        </Field>

        {error && <p className="text-sm text-[var(--color-critical)]">{error}</p>}
        {success && (
          <p className="text-sm font-semibold text-[var(--color-positive)]">Set added to vault.</p>
        )}

        <Button type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Add to Vault'}
        </Button>
      </form>
    </div>
  )
}
