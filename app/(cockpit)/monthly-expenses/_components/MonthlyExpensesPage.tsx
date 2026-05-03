'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  CATEGORIES,
  PAYMENT_METHODS,
  TAX_RATE_KEYS,
  TAX_RATES,
  ZERO_GST_CATEGORIES,
  TAX_RATE_ZERO,
  TAX_RATE_DEFAULT,
  defaultTaxRateKey,
  computeTax,
  type BusinessExpense,
  type ExpensesResponse,
  type Frequency,
} from '@/lib/types/expenses'

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function currentMonthStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function allMonthsForYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) =>
    `${year}-${String(i + 1).padStart(2, '0')}`
  )
}

function monthLabel(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleString('en-CA', { month: 'long', year: 'numeric' })
}

function fmt(n: number): string {
  return n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Styles (shared across sub-components) ────────────────────────────────────

const s = {
  card: {
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    padding: '20px 24px',
  } as React.CSSProperties,

  label: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--color-text-muted)',
    display: 'block',
    marginBottom: 4,
  } as React.CSSProperties,

  input: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-body)',
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '6px 10px',
    width: '100%',
    outline: 'none',
  } as React.CSSProperties,

  select: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-body)',
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '6px 10px',
    width: '100%',
    outline: 'none',
  } as React.CSSProperties,

  btnPrimary: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    fontWeight: 700,
    letterSpacing: '0.06em',
    padding: '8px 20px',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: 'var(--color-pillar-money)',
    color: '#fff',
    cursor: 'pointer',
  } as React.CSSProperties,

  btnSecondary: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    fontWeight: 600,
    letterSpacing: '0.06em',
    padding: '8px 16px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-border)',
    background: 'none',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
  } as React.CSSProperties,

  btnDanger: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-nano)',
    fontWeight: 600,
    padding: '4px 8px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid color-mix(in srgb, var(--color-critical) 40%, transparent)',
    background: 'none',
    color: 'var(--color-critical)',
    cursor: 'pointer',
  } as React.CSSProperties,

  btnIcon: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-nano)',
    fontWeight: 600,
    padding: '4px 8px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-border)',
    background: 'none',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
  } as React.CSSProperties,
}

// ── ExpenseForm (shared add/edit) ─────────────────────────────────────────────

interface FormState {
  date: string
  vendor: string
  category: string
  pretax: string
  taxRateKey: string
  taxAmount: string
  paymentMethod: string
  hubdoc: boolean
  notes: string
  businessUsePct: number
  busMode: 'full' | 'mixed' | 'personal'
  frequency: Frequency
}

function blankForm(): FormState {
  return {
    date: todayStr(),
    vendor: '',
    category: CATEGORIES[0],
    pretax: '',
    taxRateKey: TAX_RATE_DEFAULT,
    taxAmount: '0.00',
    paymentMethod: PAYMENT_METHODS[0],
    hubdoc: false,
    notes: '',
    businessUsePct: 100,
    busMode: 'full',
    frequency: 'one-time',
  }
}

function formFromExpense(e: BusinessExpense): FormState {
  const pct = e.business_use_pct
  return {
    date: e.date,
    vendor: e.vendor,
    category: e.category,
    pretax: String(e.pretax),
    taxRateKey: TAX_RATE_DEFAULT,
    taxAmount: String(e.tax_amount),
    paymentMethod: e.payment_method,
    hubdoc: e.hubdoc,
    notes: e.notes,
    businessUsePct: pct,
    busMode: pct >= 100 ? 'full' : pct <= 0 ? 'personal' : 'mixed',
    frequency: 'one-time',
  }
}

interface ExpenseFormProps {
  initial: FormState
  isEdit: boolean
  onSubmit: (form: FormState) => Promise<void>
  onCancel: () => void
  submitting: boolean
}

function ExpenseForm({ initial, isEdit, onSubmit, onCancel, submitting }: ExpenseFormProps) {
  const [f, setF] = useState<FormState>(initial)
  const [err, setErr] = useState<string | null>(null)

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setF((prev) => ({ ...prev, [key]: val }))
  }

  // Auto-update tax rate default when category changes
  function handleCategoryChange(cat: string) {
    const rateKey = defaultTaxRateKey(cat)
    const pretaxNum = parseFloat(f.pretax) || 0
    const newTax = computeTax(pretaxNum, rateKey)
    setF((prev) => ({ ...prev, category: cat, taxRateKey: rateKey, taxAmount: String(newTax) }))
  }

  // Recompute tax when pretax or rate changes
  function handlePretaxChange(val: string) {
    const pretaxNum = parseFloat(val) || 0
    const newTax = computeTax(pretaxNum, f.taxRateKey)
    setF((prev) => ({ ...prev, pretax: val, taxAmount: String(newTax) }))
  }

  function handleRateChange(rateKey: string) {
    const pretaxNum = parseFloat(f.pretax) || 0
    const newTax = computeTax(pretaxNum, rateKey)
    setF((prev) => ({ ...prev, taxRateKey: rateKey, taxAmount: String(newTax) }))
  }

  function handleBusModeChange(mode: 'full' | 'mixed' | 'personal') {
    const pct = mode === 'full' ? 100 : mode === 'personal' ? 0 : f.businessUsePct < 1 || f.businessUsePct >= 100 ? 33 : f.businessUsePct
    setF((prev) => ({ ...prev, busMode: mode, businessUsePct: pct }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    const pretaxNum = parseFloat(f.pretax)
    if (!f.vendor.trim()) { setErr('Vendor is required.'); return }
    if (isNaN(pretaxNum) || pretaxNum <= 0) { setErr('Pre-Tax must be a positive number.'); return }
    await onSubmit(f)
  }

  const pretaxNum = parseFloat(f.pretax) || 0
  const taxNum = parseFloat(f.taxAmount) || 0
  const total = pretaxNum + taxNum
  const bizPortion = pretaxNum * (f.businessUsePct / 100)

  const gridTwo: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }
  const gridThree: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {err && (
        <div style={{ color: 'var(--color-critical)', fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', marginBottom: 12 }}>
          {err}
        </div>
      )}

      {/* Row 1: Date + Vendor */}
      <div style={{ ...gridTwo, marginBottom: 12 }}>
        <div>
          <label style={s.label}>Date</label>
          <input
            type="date"
            value={f.date}
            onChange={(e) => set('date', e.target.value)}
            style={s.input}
            required
          />
        </div>
        <div>
          <label style={s.label}>Vendor / Description</label>
          <input
            type="text"
            value={f.vendor}
            onChange={(e) => set('vendor', e.target.value)}
            placeholder="e.g. Goodwill Edmonton"
            style={s.input}
          />
        </div>
      </div>

      {/* Category */}
      <div style={{ marginBottom: 12 }}>
        <label style={s.label}>Category</label>
        <select value={f.category} onChange={(e) => handleCategoryChange(e.target.value)} style={s.select}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Row 2: Pre-Tax + Tax Rate + Tax + Total */}
      <div style={{ ...gridThree, marginBottom: 12 }}>
        <div>
          <label style={s.label}>Pre-Tax ($)</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={f.pretax}
            onChange={(e) => handlePretaxChange(e.target.value)}
            placeholder="0.00"
            style={s.input}
          />
        </div>
        <div>
          <label style={s.label}>Tax Rate</label>
          <select value={f.taxRateKey} onChange={(e) => handleRateChange(e.target.value)} style={s.select}>
            {TAX_RATE_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div>
          <label style={s.label}>Tax ($)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={f.taxAmount}
            onChange={(e) => set('taxAmount', e.target.value)}
            style={s.input}
          />
        </div>
      </div>

      {/* Total display */}
      <div style={{ marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-muted)' }}>
          Total:&nbsp;
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-body)', color: 'var(--color-text-primary)', fontWeight: 700 }}>
          ${fmt(total)}
        </span>
      </div>

      {/* Row 3: Payment Method + Hubdoc */}
      <div style={{ ...gridTwo, marginBottom: 12 }}>
        <div>
          <label style={s.label}>Payment Method</label>
          <select value={f.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value as typeof f.paymentMethod)} style={s.select}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label style={s.label}>Receipt in Hubdoc?</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6 }}>
            <input
              type="checkbox"
              id="hubdoc"
              checked={f.hubdoc}
              onChange={(e) => set('hubdoc', e.target.checked)}
              style={{ accentColor: 'var(--color-pillar-money)', cursor: 'pointer' }}
            />
            <label htmlFor="hubdoc" style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
              Yes
            </label>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div style={{ marginBottom: 12 }}>
        <label style={s.label}>Notes (optional)</label>
        <input
          type="text"
          value={f.notes}
          onChange={(e) => set('notes', e.target.value)}
          style={s.input}
        />
      </div>

      {/* Business Use */}
      <div style={{ marginBottom: 12 }}>
        <label style={s.label}>Business Use</label>
        <div style={{ display: 'flex', gap: 16 }}>
          {(['full', 'mixed', 'personal'] as const).map((mode) => (
            <label
              key={mode}
              style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)' }}
            >
              <input
                type="radio"
                name="busMode"
                value={mode}
                checked={f.busMode === mode}
                onChange={() => handleBusModeChange(mode)}
                style={{ accentColor: 'var(--color-pillar-money)', cursor: 'pointer' }}
              />
              {mode === 'full' ? 'Business 100%' : mode === 'mixed' ? 'Mixed %' : 'Personal 0%'}
            </label>
          ))}
        </div>

        {f.busMode === 'mixed' && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="number"
              min={1}
              max={99}
              step={1}
              value={f.businessUsePct}
              onChange={(e) => set('businessUsePct', Math.min(99, Math.max(1, parseInt(e.target.value) || 33)))}
              style={{ ...s.input, width: 80 }}
            />
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-muted)' }}>%</span>
            {pretaxNum > 0 && (
              <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-muted)' }}>
                → ${fmt(bizPortion)} of ${fmt(pretaxNum)}
              </span>
            )}
          </div>
        )}

        {f.busMode === 'personal' && (
          <div style={{ marginTop: 4, fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)' }}>
            Tracked but excluded from P&L
          </div>
        )}
      </div>

      {/* Frequency (add only) */}
      {!isEdit && (
        <div style={{ marginBottom: 16 }}>
          <label style={s.label}>Frequency</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {([
              ['one-time', 'One-time'],
              ['monthly', pretaxNum > 0 ? `Monthly (rest of year) — $${fmt(pretaxNum)}/mo` : 'Monthly (rest of year)'],
              ['annual', pretaxNum > 0 ? `Annual ÷ 12 — $${fmt(Math.round(pretaxNum / 12 * 100) / 100)}/mo` : 'Annual ÷ 12, all 12 months'],
            ] as [Frequency, string][]).map(([val, label]) => (
              <label
                key={val}
                style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)' }}
              >
                <input
                  type="radio"
                  name="frequency"
                  value={val}
                  checked={f.frequency === val}
                  onChange={() => set('frequency', val)}
                  style={{ accentColor: 'var(--color-pillar-money)', cursor: 'pointer' }}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={submitting} style={{ ...s.btnPrimary, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Expense'}
        </button>
        <button type="button" onClick={onCancel} style={s.btnSecondary}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Main page component ───────────────────────────────────────────────────────

type SortOrder = 'date-desc' | 'date-asc' | 'vendor' | 'amount-desc'

export function MonthlyExpensesPage() {
  const currentYear = new Date().getFullYear()
  const months = allMonthsForYear(currentYear)

  const [month, setMonth] = useState(currentMonthStr)
  const [expenses, setExpenses] = useState<BusinessExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<SortOrder>('date-desc')
  const [submitting, setSubmitting] = useState(false)
  const [flashMsg, setFlashMsg] = useState<string | null>(null)

  const loadExpenses = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch(`/api/expenses?month=${month}`)
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const data = (await res.json()) as { expenses: BusinessExpense[] }
      setExpenses(data.expenses)
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => { loadExpenses() }, [loadExpenses])

  function flash(msg: string) {
    setFlashMsg(msg)
    setTimeout(() => setFlashMsg(null), 3000)
  }

  async function handleAdd(form: FormState) {
    setSubmitting(true)
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: form.date,
          vendor: form.vendor,
          category: form.category,
          pretax: parseFloat(form.pretax),
          taxAmount: parseFloat(form.taxAmount) || 0,
          paymentMethod: form.paymentMethod,
          hubdoc: form.hubdoc,
          notes: form.notes,
          businessUsePct: form.businessUsePct,
          frequency: form.frequency,
        }),
      })
      const body = (await res.json()) as { created?: number; error?: string }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setShowAddForm(false)
      flash(`Added ${body.created ?? 1} expense${(body.created ?? 1) > 1 ? 's' : ''}`)
      await loadExpenses()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleEdit(id: string, form: FormState) {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/expenses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: form.date,
          vendor: form.vendor,
          category: form.category,
          pretax: parseFloat(form.pretax),
          taxAmount: parseFloat(form.taxAmount) || 0,
          paymentMethod: form.paymentMethod,
          hubdoc: form.hubdoc,
          notes: form.notes,
          businessUsePct: form.businessUsePct,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setEditingId(null)
      flash('Expense updated')
      await loadExpenses()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: string, vendor: string) {
    if (!confirm(`Delete "${vendor}"?`)) return
    try {
      const res = await fetch(`/api/expenses/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      flash('Expense deleted')
      await loadExpenses()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  // Sorting
  const sorted = [...expenses].sort((a, b) => {
    switch (sortOrder) {
      case 'date-asc':  return a.date.localeCompare(b.date)
      case 'date-desc': return b.date.localeCompare(a.date)
      case 'vendor':    return a.vendor.toLowerCase().localeCompare(b.vendor.toLowerCase())
      case 'amount-desc': return (b.pretax + b.tax_amount) - (a.pretax + a.tax_amount)
    }
  })

  // Summary
  const totalPretax     = expenses.reduce((s, e) => s + e.pretax, 0)
  const totalTax        = expenses.reduce((s, e) => s + e.tax_amount, 0)
  const businessPortion = expenses.reduce((s, e) => s + e.pretax * (e.business_use_pct / 100), 0)

  return (
    <div style={{ padding: '28px 32px', maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <span
          className="label-caps"
          style={{ color: 'var(--color-pillar-money)', fontSize: 'var(--text-small)', fontFamily: 'var(--font-ui)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}
        >
          Monthly Expenses
        </span>

        {/* Month selector */}
        <select
          value={month}
          onChange={(e) => { setMonth(e.target.value); setShowAddForm(false); setEditingId(null) }}
          style={{ ...s.select, width: 200 }}
        >
          {months.map((m) => (
            <option key={m} value={m}>{monthLabel(m)}</option>
          ))}
        </select>
      </div>

      {/* Flash message */}
      {flashMsg && (
        <div style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-positive, #4caf50)',
          background: 'color-mix(in srgb, var(--color-positive, #4caf50) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--color-positive, #4caf50) 30%, transparent)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 12px',
          marginBottom: 16,
        }}>
          {flashMsg}
        </div>
      )}

      {/* Summary bar */}
      {!loading && !fetchError && expenses.length > 0 && (
        <div style={{ ...s.card, display: 'flex', gap: 32, marginBottom: 16 }}>
          {[
            ['Expenses', String(expenses.length)],
            ['Pre-Tax', `$${fmt(totalPretax)}`],
            ['Tax', `$${fmt(totalTax)}`],
            ['Total Logged', `$${fmt(totalPretax + totalTax)}`],
            ['Business Portion', `$${fmt(businessPortion)}`],
          ].map(([label, val]) => (
            <div key={label}>
              <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>
                {label}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-body)', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {val}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Expense form */}
      <div style={{ ...s.card, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showAddForm ? 16 : 0 }}>
          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
            Add Expense
          </span>
          {!showAddForm && (
            <button onClick={() => { setShowAddForm(true); setEditingId(null) }} style={s.btnPrimary}>
              + New
            </button>
          )}
        </div>

        {showAddForm && (
          <ExpenseForm
            initial={blankForm()}
            isEdit={false}
            onSubmit={handleAdd}
            onCancel={() => setShowAddForm(false)}
            submitting={submitting}
          />
        )}
      </div>

      {/* Expense table */}
      <div style={s.card}>
        {/* Sort control */}
        {expenses.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)' }}>Sort:</span>
            <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as SortOrder)} style={{ ...s.select, width: 180 }}>
              <option value="date-desc">Newest first</option>
              <option value="date-asc">Oldest first</option>
              <option value="vendor">By vendor</option>
              <option value="amount-desc">By amount (high→low)</option>
            </select>
          </div>
        )}

        {/* States */}
        {loading && (
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)' }}>Loading…</div>
        )}
        {fetchError && (
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-critical)' }}>Error: {fetchError}</div>
        )}
        {!loading && !fetchError && expenses.length === 0 && (
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)' }}>
            No expenses logged for {monthLabel(month)} — use the form above to add some.
          </div>
        )}

        {/* Table */}
        {!loading && !fetchError && sorted.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Date', 'Vendor', 'Category', 'Pre-Tax', 'Tax', 'Total', 'Bus%', 'Hubdoc', ''].map((h) => (
                  <th
                    key={h}
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--color-text-disabled)',
                      textAlign: h === '' ? 'right' : 'left',
                      padding: '0 8px 8px 0',
                      borderBottom: '1px solid var(--color-border)',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <>
                  <tr key={e.id}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)', color: 'var(--color-text-muted)', padding: '8px 8px 8px 0', borderBottom: '1px solid var(--color-border)' }}>
                      {e.date}
                    </td>
                    <td style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-primary)', padding: '8px 8px 8px 0', borderBottom: '1px solid var(--color-border)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.vendor}
                    </td>
                    <td style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-muted)', padding: '8px 8px 8px 0', borderBottom: '1px solid var(--color-border)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.category}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)', color: 'var(--color-text-primary)', padding: '8px 8px 8px 0', borderBottom: '1px solid var(--color-border)', textAlign: 'right' }}>
                      ${fmt(e.pretax)}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)', color: 'var(--color-text-muted)', padding: '8px 8px 8px 0', borderBottom: '1px solid var(--color-border)', textAlign: 'right' }}>
                      ${fmt(e.tax_amount)}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)', fontWeight: 700, color: 'var(--color-text-primary)', padding: '8px 8px 8px 0', borderBottom: '1px solid var(--color-border)', textAlign: 'right' }}>
                      ${fmt(e.pretax + e.tax_amount)}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)', color: e.business_use_pct < 100 ? 'var(--color-text-muted)' : 'var(--color-text-disabled)', padding: '8px 8px 8px 0', borderBottom: '1px solid var(--color-border)', textAlign: 'right' }}>
                      {e.business_use_pct}%
                    </td>
                    <td style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: e.hubdoc ? 'var(--color-positive, #4caf50)' : 'var(--color-text-disabled)', padding: '8px 8px 8px 0', borderBottom: '1px solid var(--color-border)', textAlign: 'center' }}>
                      {e.hubdoc ? '✓' : '–'}
                    </td>
                    <td style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => setEditingId(editingId === e.id ? null : e.id)}
                        style={{ ...s.btnIcon, marginRight: 4 }}
                      >
                        {editingId === e.id ? 'Cancel' : 'Edit'}
                      </button>
                      <button onClick={() => handleDelete(e.id, e.vendor)} style={s.btnDanger}>
                        Delete
                      </button>
                    </td>
                  </tr>

                  {/* Inline edit row */}
                  {editingId === e.id && (
                    <tr key={`edit-${e.id}`}>
                      <td colSpan={9} style={{ padding: '16px 0', borderBottom: '1px solid var(--color-border)' }}>
                        <div style={{ backgroundColor: 'var(--color-surface-2)', borderRadius: 'var(--radius-sm)', padding: '16px 20px' }}>
                          <ExpenseForm
                            initial={formFromExpense(e)}
                            isEdit={true}
                            onSubmit={(form) => handleEdit(e.id, form)}
                            onCancel={() => setEditingId(null)}
                            submitting={submitting}
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
