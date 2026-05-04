'use client'

import { useEffect, useState } from 'react'
import {
  CATEGORIES,
  PAYMENT_METHODS,
  TAX_RATE_KEYS,
  TAX_RATE_DEFAULT,
  defaultTaxRateKey,
  computeTax,
  type RecurringTemplate,
} from '@/lib/types/expenses'

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

function fmt(n: number): string {
  return n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function currentMonthStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  page: {
    padding: '24px 28px',
    maxWidth: 1100,
  } as React.CSSProperties,

  pageTitle: {
    fontFamily: 'var(--font-display, var(--font-ui))',
    fontWeight: 800,
    fontSize: 'var(--text-title)',
    color: 'var(--color-text-primary)',
    letterSpacing: '0.04em',
    marginBottom: 4,
  } as React.CSSProperties,

  pageSubtitle: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    color: 'var(--color-text-muted)',
    marginBottom: 24,
  } as React.CSSProperties,

  card: {
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    padding: '20px 24px',
    marginBottom: 16,
  } as React.CSSProperties,

  sectionTitle: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    color: 'var(--color-text-muted)',
    marginBottom: 14,
  } as React.CSSProperties,

  label: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
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
    boxSizing: 'border-box' as const,
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
    boxSizing: 'border-box' as const,
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

  th: {
    padding: '6px 8px',
    textAlign: 'left' as const,
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-nano)',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: 'var(--color-text-muted)',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
}

// ── Form state ────────────────────────────────────────────────────────────────

interface FormState {
  vendor: string
  category: string
  pretax: string
  taxRateKey: string
  taxAmount: string
  paymentMethod: string
  dayOfMonth: string
  frequency: 'monthly' | 'annual'
  annualMonth: string
  notes: string
  businessUsePct: string
}

function emptyForm(): FormState {
  return {
    vendor: '',
    category: CATEGORIES[0],
    pretax: '',
    taxRateKey: TAX_RATE_DEFAULT,
    taxAmount: '0.00',
    paymentMethod: PAYMENT_METHODS[0],
    dayOfMonth: '1',
    frequency: 'monthly',
    annualMonth: '1',
    notes: '',
    businessUsePct: '100',
  }
}

function templateToForm(t: RecurringTemplate): FormState {
  return {
    vendor: t.vendor,
    category: t.category,
    pretax: String(t.pretax),
    taxRateKey: TAX_RATE_DEFAULT,
    taxAmount: String(t.tax_amount),
    paymentMethod: t.payment_method,
    dayOfMonth: String(t.day_of_month),
    frequency: t.frequency,
    annualMonth: String(t.annual_month ?? 1),
    notes: t.notes,
    businessUsePct: String(t.business_use_pct),
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export function RecurringPage() {
  const [templates, setTemplates] = useState<RecurringTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [refetchKey, setRefetchKey] = useState(0)

  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setFormState] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)

  const [genMonth, setGenMonth] = useState<string>(currentMonthStr())
  const [generating, setGenerating] = useState(false)
  const [genResult, setGenResult] = useState<{ generated: number; skipped: number } | null>(null)
  const [genErr, setGenErr] = useState<string | null>(null)

  function reload() {
    setRefetchKey((k) => k + 1)
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setErr(null)
      try {
        const r = await fetch('/api/expenses/recurring')
        const j = (await r.json()) as { templates?: RecurringTemplate[]; error?: string }
        if (!r.ok) throw new Error(j.error ?? 'Failed to load')
        if (!cancelled) setTemplates(j.templates ?? [])
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [refetchKey])

  function setField(update: Partial<FormState>) {
    setFormState((prev) => {
      const next = { ...prev, ...update }
      if ('pretax' in update || 'taxRateKey' in update) {
        const n = parseFloat(next.pretax)
        if (!isNaN(n)) next.taxAmount = String(computeTax(n, next.taxRateKey))
      }
      if ('category' in update) {
        const key = defaultTaxRateKey(next.category)
        next.taxRateKey = key
        const n = parseFloat(next.pretax)
        if (!isNaN(n)) next.taxAmount = String(computeTax(n, key))
      }
      return next
    })
  }

  function startAdd() {
    setEditId(null)
    setFormState(emptyForm())
    setFormErr(null)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function startEdit(t: RecurringTemplate) {
    setEditId(t.id)
    setFormState(templateToForm(t))
    setFormErr(null)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelForm() {
    setShowForm(false)
    setEditId(null)
    setFormErr(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormErr(null)
    const body = {
      vendor: form.vendor,
      category: form.category,
      pretax: parseFloat(form.pretax),
      taxAmount: parseFloat(form.taxAmount) || 0,
      paymentMethod: form.paymentMethod,
      dayOfMonth: parseInt(form.dayOfMonth),
      frequency: form.frequency,
      annualMonth: form.frequency === 'annual' ? parseInt(form.annualMonth) : null,
      notes: form.notes,
      businessUsePct: parseInt(form.businessUsePct),
    }
    try {
      const url = editId ? `/api/expenses/recurring/${editId}` : '/api/expenses/recurring'
      const method = editId ? 'PATCH' : 'POST'
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(j.error ?? 'Save failed')
      setShowForm(false)
      setEditId(null)
      reload()
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(t: RecurringTemplate) {
    await fetch(`/api/expenses/recurring/${t.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !t.active }),
    })
    reload()
  }

  async function deleteTemplate(t: RecurringTemplate) {
    if (!confirm(`Delete "${t.vendor}"? Generated expenses are kept.`)) return
    await fetch(`/api/expenses/recurring/${t.id}`, { method: 'DELETE' })
    reload()
  }

  async function generate() {
    setGenerating(true)
    setGenResult(null)
    setGenErr(null)
    try {
      const r = await fetch('/api/expenses/recurring/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: genMonth }),
      })
      const j = (await r.json()) as { generated?: number; skipped?: number; error?: string }
      if (!r.ok) throw new Error(j.error ?? 'Generate failed')
      setGenResult({ generated: j.generated ?? 0, skipped: j.skipped ?? 0 })
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : String(e))
    } finally {
      setGenerating(false)
    }
  }

  const active = templates.filter((t) => t.active)
  const inactive = templates.filter((t) => !t.active)

  // Monthly total for active templates
  const monthlyTotal = active.reduce((sum, t) => {
    if (t.frequency === 'monthly') return sum + t.pretax + t.tax_amount
    if (t.frequency === 'annual') return sum + (t.pretax + t.tax_amount) / 12
    return sum
  }, 0)

  return (
    <div style={s.page}>
      <div style={s.pageTitle}>Recurring Expenses</div>
      <div style={s.pageSubtitle}>
        Subscriptions and fixed costs that generate automatically into Monthly Expenses each month.
      </div>

      {/* Actions row */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          marginBottom: 20,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <button onClick={startAdd} style={s.btnPrimary}>
          + Add Template
        </button>

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="month"
            value={genMonth}
            onChange={(e) => {
              setGenMonth(e.target.value)
              setGenResult(null)
            }}
            style={{ ...s.input, width: 160, fontFamily: 'var(--font-ui)' }}
          />
          <button onClick={generate} disabled={generating} style={s.btnSecondary}>
            {generating ? 'Generating…' : 'Generate Month'}
          </button>
        </div>

        {genResult && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-pillar-money)',
            }}
          >
            +{genResult.generated} added
            {genResult.skipped > 0 ? `, ${genResult.skipped} already existed` : ''}
          </span>
        )}
        {genErr && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-critical)',
            }}
          >
            {genErr}
          </span>
        )}
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <div style={{ ...s.card, border: '1px solid var(--color-pillar-money)' }}>
          <div style={{ ...s.sectionTitle, color: 'var(--color-pillar-money)', marginBottom: 16 }}>
            {editId ? 'Edit Template' : 'New Template'}
          </div>
          <form onSubmit={handleSubmit}>
            <div
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}
            >
              <div>
                <label style={s.label}>Vendor</label>
                <input
                  style={s.input}
                  value={form.vendor}
                  onChange={(e) => setField({ vendor: e.target.value })}
                  placeholder="e.g. Shopify"
                  required
                />
              </div>
              <div>
                <label style={s.label}>Category</label>
                <select
                  style={s.select}
                  value={form.category}
                  onChange={(e) => setField({ category: e.target.value })}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1.5fr 1fr',
                gap: 12,
                marginBottom: 12,
              }}
            >
              <div>
                <label style={s.label}>Pre-tax ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  style={s.input}
                  value={form.pretax}
                  onChange={(e) => setField({ pretax: e.target.value })}
                  required
                />
              </div>
              <div>
                <label style={s.label}>Tax Rate</label>
                <select
                  style={s.select}
                  value={form.taxRateKey}
                  onChange={(e) => setField({ taxRateKey: e.target.value })}
                >
                  {TAX_RATE_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={s.label}>Tax ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  style={s.input}
                  value={form.taxAmount}
                  onChange={(e) => setField({ taxAmount: e.target.value })}
                />
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.5fr 1fr 1fr',
                gap: 12,
                marginBottom: 12,
              }}
            >
              <div>
                <label style={s.label}>Payment Method</label>
                <select
                  style={s.select}
                  value={form.paymentMethod}
                  onChange={(e) => setField({ paymentMethod: e.target.value })}
                >
                  {PAYMENT_METHODS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={s.label}>Day of Month (1–28)</label>
                <input
                  type="number"
                  min="1"
                  max="28"
                  style={s.input}
                  value={form.dayOfMonth}
                  onChange={(e) => setField({ dayOfMonth: e.target.value })}
                />
              </div>
              <div>
                <label style={s.label}>Frequency</label>
                <select
                  style={s.select}
                  value={form.frequency}
                  onChange={(e) => setField({ frequency: e.target.value as 'monthly' | 'annual' })}
                >
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: form.frequency === 'annual' ? '1fr 2fr 1fr' : '2fr 1fr',
                gap: 12,
                marginBottom: 16,
              }}
            >
              {form.frequency === 'annual' && (
                <div>
                  <label style={s.label}>Fires in Month</label>
                  <select
                    style={s.select}
                    value={form.annualMonth}
                    onChange={(e) => setField({ annualMonth: e.target.value })}
                  >
                    {MONTH_NAMES.map((m, i) => (
                      <option key={i + 1} value={String(i + 1)}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label style={s.label}>Notes</label>
                <input
                  style={s.input}
                  value={form.notes}
                  onChange={(e) => setField({ notes: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div>
                <label style={s.label}>Business Use %</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  style={s.input}
                  value={form.businessUsePct}
                  onChange={(e) => setField({ businessUsePct: e.target.value })}
                />
              </div>
            </div>

            {formErr && (
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-critical)',
                  marginBottom: 12,
                }}
              >
                {formErr}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" disabled={saving} style={s.btnPrimary}>
                {saving ? 'Saving…' : editId ? 'Save Changes' : 'Create Template'}
              </button>
              <button type="button" onClick={cancelForm} style={s.btnSecondary}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Loading / error */}
      {loading && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
            padding: '20px 0',
          }}
        >
          Loading templates…
        </div>
      )}
      {err && (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-critical)',
            padding: '20px 0',
          }}
        >
          {err}
        </div>
      )}

      {/* Empty state */}
      {!loading && !err && templates.length === 0 && (
        <div style={s.card}>
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-body)',
              color: 'var(--color-text-muted)',
              textAlign: 'center',
              padding: '28px 0',
            }}
          >
            No recurring templates yet — add your first subscription above.
          </div>
        </div>
      )}

      {/* Monthly cost summary */}
      {!loading && active.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-text-muted)',
            }}
          >
            Monthly recurring total (incl. annuals ÷12):
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-body)',
              fontWeight: 700,
              color: 'var(--color-pillar-money)',
            }}
          >
            ${fmt(monthlyTotal)}
          </span>
        </div>
      )}

      {/* Active templates */}
      {!loading && active.length > 0 && (
        <TemplateTable
          title={`Active — ${active.length}`}
          templates={active}
          onEdit={startEdit}
          onToggle={toggleActive}
          onDelete={deleteTemplate}
        />
      )}

      {/* Inactive templates */}
      {!loading && inactive.length > 0 && (
        <TemplateTable
          title={`Paused — ${inactive.length}`}
          templates={inactive}
          onEdit={startEdit}
          onToggle={toggleActive}
          onDelete={deleteTemplate}
          muted
        />
      )}
    </div>
  )
}

// ── Template table ────────────────────────────────────────────────────────────

interface TemplateTableProps {
  title: string
  templates: RecurringTemplate[]
  onEdit: (t: RecurringTemplate) => void
  onToggle: (t: RecurringTemplate) => void
  onDelete: (t: RecurringTemplate) => void
  muted?: boolean
}

function TemplateTable({
  title,
  templates,
  onEdit,
  onToggle,
  onDelete,
  muted,
}: TemplateTableProps) {
  if (templates.length === 0) return null

  return (
    <div style={{ ...s.card, overflowX: 'auto' }}>
      <div style={{ ...s.sectionTitle, opacity: muted ? 0.6 : 1 }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
            <th style={s.th}>Vendor</th>
            <th style={s.th}>Category</th>
            <th style={{ ...s.th, textAlign: 'right' }}>Pre-tax</th>
            <th style={{ ...s.th, textAlign: 'right' }}>Tax</th>
            <th style={{ ...s.th, textAlign: 'right' }}>Total</th>
            <th style={s.th}>Frequency</th>
            <th style={{ ...s.th, textAlign: 'center' }}>Day</th>
            <th style={{ ...s.th, textAlign: 'center' }}>Bus %</th>
            <th style={s.th} />
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr
              key={t.id}
              style={{
                borderBottom: '1px solid color-mix(in srgb, var(--color-border) 40%, transparent)',
                opacity: muted ? 0.65 : 1,
              }}
            >
              <td
                style={{
                  padding: '7px 8px',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  fontWeight: 500,
                  color: 'var(--color-text-primary)',
                }}
              >
                {t.vendor}
                {t.notes && (
                  <span
                    style={{
                      display: 'block',
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      color: 'var(--color-text-disabled)',
                      fontWeight: 400,
                    }}
                  >
                    {t.notes}
                  </span>
                )}
              </td>
              <td
                style={{
                  padding: '7px 8px',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {t.category}
              </td>
              <td
                style={{
                  padding: '7px 8px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-primary)',
                  textAlign: 'right',
                }}
              >
                ${fmt(t.pretax)}
              </td>
              <td
                style={{
                  padding: '7px 8px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-muted)',
                  textAlign: 'right',
                }}
              >
                ${fmt(t.tax_amount)}
              </td>
              <td
                style={{
                  padding: '7px 8px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-small)',
                  fontWeight: 700,
                  color: 'var(--color-pillar-money)',
                  textAlign: 'right',
                }}
              >
                ${fmt(t.pretax + t.tax_amount)}
              </td>
              <td
                style={{
                  padding: '7px 8px',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {t.frequency === 'monthly'
                  ? 'Monthly'
                  : `Annual — ${MONTH_NAMES[(t.annual_month ?? 1) - 1]}`}
              </td>
              <td
                style={{
                  padding: '7px 8px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-muted)',
                  textAlign: 'center',
                }}
              >
                {t.day_of_month}
              </td>
              <td
                style={{
                  padding: '7px 8px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-muted)',
                  textAlign: 'center',
                }}
              >
                {t.business_use_pct}%
              </td>
              <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => onEdit(t)} style={s.btnIcon}>
                    Edit
                  </button>
                  <button onClick={() => onToggle(t)} style={s.btnIcon}>
                    {t.active ? 'Pause' : 'Resume'}
                  </button>
                  <button onClick={() => onDelete(t)} style={s.btnDanger}>
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
