'use client'

import { useState, useEffect, useRef } from 'react'
import type { MileageTrip } from '@/app/api/mileage/route'
import type { ParsedTrip } from '@/app/api/mileage/import/route'

// CRA prescribed per-km rates for 2024/2025 (self-employed reference)
const CRA_RATE_TIER1 = 0.72 // first 5,000 km
const CRA_RATE_TIER2 = 0.66 // above 5,000 km
const TIER1_KM = 5000

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 4 }, (_, i) => CURRENT_YEAR - i)

function craDeduction(km: number): number {
  if (km <= TIER1_KM) return km * CRA_RATE_TIER1
  return TIER1_KM * CRA_RATE_TIER1 + (km - TIER1_KM) * CRA_RATE_TIER2
}

const fmtKm = (n: number) => `${n.toLocaleString('en-CA', { maximumFractionDigits: 1 })} km`
const fmtCad = (n: number) =>
  n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 })

interface FormState {
  date: string
  from: string
  to: string
  km: string
  purpose: string
  roundTrip: boolean
  notes: string
}

const emptyForm = (): FormState => ({
  date: new Date().toISOString().slice(0, 10),
  from: '',
  to: '',
  km: '',
  purpose: '',
  roundTrip: false,
  notes: '',
})

export function MileagePage() {
  const [year, setYear] = useState(CURRENT_YEAR)
  const [trips, setTrips] = useState<MileageTrip[]>([])
  const [totalKm, setTotalKm] = useState(0)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [refetchKey, setRefetchKey] = useState(0)
  const [annualKm, setAnnualKm] = useState('') // user enters total annual km for % calc

  // MileIQ import state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [importErr, setImportErr] = useState<string | null>(null)
  const [preview, setPreview] = useState<ParsedTrip[] | null>(null)
  const [importingBulk, setImportingBulk] = useState(false)

  function reload() {
    setRefetchKey((k) => k + 1)
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setErr(null)
      try {
        const r = await fetch(`/api/mileage?year=${year}`)
        const j = (await r.json()) as { trips?: MileageTrip[]; totalKm?: number; error?: string }
        if (!r.ok) throw new Error(j.error ?? 'Failed to load')
        if (!cancelled) {
          setTrips(j.trips ?? [])
          setTotalKm(j.totalKm ?? 0)
        }
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
  }, [year, refetchKey])

  function setField(patch: Partial<FormState>) {
    setForm((f) => ({ ...f, ...patch }))
  }

  async function handleImportFile(file: File) {
    setImporting(true)
    setImportErr(null)
    setPreview(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch('/api/mileage/import', { method: 'POST', body: fd })
      const j = (await r.json()) as { trips?: ParsedTrip[]; count?: number; error?: string }
      if (!r.ok) throw new Error(j.error ?? 'Parse failed')
      setPreview(j.trips ?? [])
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleBulkImport() {
    if (!preview || preview.length === 0) return
    setImportingBulk(true)
    setImportErr(null)
    try {
      const r = await fetch('/api/mileage/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preview),
      })
      const j = (await r.json()) as { inserted?: number; error?: string }
      if (!r.ok) throw new Error(j.error ?? 'Import failed')
      setPreview(null)
      reload()
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : String(e))
    } finally {
      setImportingBulk(false)
    }
  }

  async function handleAdd() {
    if (!form.from.trim() || !form.to.trim() || !form.km || !form.purpose.trim()) {
      setErr('From, To, km, and Purpose are required')
      return
    }
    const kmVal = parseFloat(form.km)
    if (isNaN(kmVal) || kmVal <= 0) {
      setErr('km must be a positive number')
      return
    }
    setErr(null)
    setSaving(true)
    try {
      const r = await fetch('/api/mileage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: form.date,
          from_location: form.from.trim(),
          to_location: form.to.trim(),
          km: kmVal,
          purpose: form.purpose.trim(),
          round_trip: form.roundTrip,
          notes: form.notes.trim(),
        }),
      })
      const j = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(j.error ?? 'Failed to save')
      setForm(emptyForm())
      reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      const r = await fetch(`/api/mileage/${id}`, { method: 'DELETE' })
      if (!r.ok) {
        const j = (await r.json()) as { error?: string }
        throw new Error(j.error ?? 'Delete failed')
      }
      reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const businessPct =
    annualKm && parseFloat(annualKm) > 0
      ? Math.min(100, (totalKm / parseFloat(annualKm)) * 100)
      : null

  const deduction = craDeduction(totalKm)

  // Which months have at least one trip logged?
  const coveredMonths = new Set(trips.map((t) => t.date.slice(0, 7)))
  const now = new Date()
  const MONTH_LABELS = [
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

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.68rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: 'var(--color-text-disabled)',
    textTransform: 'uppercase',
    marginBottom: 4,
  }

  const inputStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.82rem',
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text-primary)',
    padding: '7px 10px',
    width: '100%',
    boxSizing: 'border-box',
  }

  return (
    <div style={{ padding: '24px 32px', fontFamily: 'var(--font-ui)', maxWidth: 900 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontFamily: 'var(--font-display, var(--font-ui))',
            fontSize: '1.15rem',
            fontWeight: 800,
            letterSpacing: '0.06em',
            color: 'var(--color-text-primary)',
            textTransform: 'uppercase',
            margin: 0,
          }}
        >
          Mileage Log
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            margin: '6px 0 0',
          }}
        >
          CRA-compliant vehicle trip log — date, from/to, km, purpose
        </p>
      </div>

      {/* Year selector */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          style={{ ...inputStyle, width: 'auto', cursor: 'pointer' }}
        >
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        {loading && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              color: 'var(--color-text-disabled)',
            }}
          >
            Loading…
          </span>
        )}
      </div>

      {/* Error */}
      {err && (
        <div
          style={{
            background: '#2a1a1a',
            border: '1px solid #e5534b',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 14px',
            color: '#e5534b',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8rem',
            marginBottom: 20,
          }}
        >
          {err}
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { label: `${year} Business km`, value: fmtKm(totalKm) },
          {
            label: 'CRA rate deduction est.',
            value: fmtCad(deduction),
            note: '(flat-rate reference)',
          },
          {
            label: 'Business use %',
            value: businessPct !== null ? `${businessPct.toFixed(1)}%` : '—',
          },
        ].map(({ label, value, note }) => (
          <div
            key={label}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 18px',
              minWidth: 160,
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '1.3rem',
                fontWeight: 700,
                color: 'var(--color-accent-gold)',
              }}
            >
              {value}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.68rem',
                color: 'var(--color-text-disabled)',
                marginTop: 2,
              }}
            >
              {label}
            </div>
            {note && (
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: '0.65rem',
                  color: 'var(--color-text-disabled)',
                  marginTop: 1,
                }}
              >
                {note}
              </div>
            )}
          </div>
        ))}

        {/* Total annual km input for % calc */}
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '12px 18px',
            minWidth: 160,
          }}
        >
          <label style={{ ...labelStyle, marginBottom: 6 }}>Total annual km</label>
          <input
            type="number"
            value={annualKm}
            onChange={(e) => setAnnualKm(e.target.value)}
            placeholder="e.g. 18000"
            style={{ ...inputStyle, fontSize: '0.8rem' }}
          />
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: '0.65rem',
              color: 'var(--color-text-disabled)',
              marginTop: 4,
            }}
          >
            Enter to compute business %
          </div>
        </div>
      </div>

      {/* MileIQ monthly coverage grid */}
      <div
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          marginBottom: 24,
        }}
      >
        <div
          style={{
            padding: '8px 16px',
            background: 'var(--color-surface-2)',
            borderBottom: '1px solid var(--color-border)',
            fontFamily: 'var(--font-ui)',
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: 'var(--color-text-disabled)',
            textTransform: 'uppercase',
          }}
        >
          MileIQ Report Coverage — {year}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(12, 1fr)',
            padding: '12px 16px',
            gap: 6,
          }}
        >
          {MONTH_LABELS.map((label, i) => {
            const monthKey = `${year}-${String(i + 1).padStart(2, '0')}`
            const isFuture = year === now.getFullYear() && i + 1 > now.getMonth() + 1
            const hasCoverage = coveredMonths.has(monthKey)
            return (
              <div
                key={monthKey}
                title={
                  isFuture
                    ? `${label} — not yet due`
                    : hasCoverage
                      ? `${label} — imported`
                      : `${label} — missing`
                }
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  padding: '8px 4px',
                  borderRadius: 'var(--radius-sm)',
                  background: hasCoverage
                    ? 'rgba(var(--color-pillar-health-rgb, 74,222,128), 0.08)'
                    : isFuture
                      ? 'transparent'
                      : 'rgba(229,83,75,0.08)',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    color: isFuture ? 'var(--color-text-disabled)' : 'var(--color-text-muted)',
                    textTransform: 'uppercase',
                  }}
                >
                  {label}
                </span>
                <span
                  style={{
                    fontSize: '0.9rem',
                    color: isFuture
                      ? 'var(--color-text-disabled)'
                      : hasCoverage
                        ? 'var(--color-pillar-health)'
                        : '#e5534b',
                  }}
                >
                  {isFuture ? '·' : hasCoverage ? '✓' : '✗'}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* MileIQ Import */}
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding: '18px 20px',
          marginBottom: 24,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: 'var(--color-text-disabled)',
            textTransform: 'uppercase',
            marginBottom: 14,
          }}
        >
          Import MileIQ Report
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleImportFile(f)
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              fontWeight: 700,
              letterSpacing: '0.06em',
              padding: '8px 18px',
              background: 'var(--color-surface-2)',
              color: importing ? 'var(--color-text-disabled)' : 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              cursor: importing ? 'not-allowed' : 'pointer',
            }}
          >
            {importing ? 'Parsing…' : 'Upload MileIQ CSV'}
          </button>
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: '0.7rem',
              color: 'var(--color-text-disabled)',
            }}
          >
            Export from MileIQ → Reports → CSV. Business drives only are imported.
          </span>
        </div>

        {importErr && (
          <div
            style={{
              marginTop: 12,
              padding: '8px 12px',
              background: '#2a1a1a',
              border: '1px solid #e5534b',
              borderRadius: 'var(--radius-sm)',
              color: '#e5534b',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.78rem',
            }}
          >
            {importErr}
          </div>
        )}

        {preview && (
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.72rem',
                color: 'var(--color-text-muted)',
                marginBottom: 10,
              }}
            >
              {preview.length === 0
                ? 'No business drives found in the CSV.'
                : `${preview.length} business trip${preview.length !== 1 ? 's' : ''} parsed — review then import:`}
            </div>

            {preview.length > 0 && (
              <>
                <div
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    overflow: 'hidden',
                    marginBottom: 12,
                    maxHeight: 260,
                    overflowY: 'auto',
                  }}
                >
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.75rem',
                    }}
                  >
                    <thead>
                      <tr style={{ background: 'var(--color-surface-2)' }}>
                        {['Date', 'From', 'To', 'km', 'Purpose'].map((h) => (
                          <th
                            key={h}
                            style={{
                              padding: '6px 10px',
                              textAlign: 'left',
                              fontFamily: 'var(--font-ui)',
                              fontSize: '0.6rem',
                              fontWeight: 700,
                              letterSpacing: '0.08em',
                              color: 'var(--color-text-disabled)',
                              textTransform: 'uppercase',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((t, i) => (
                        <tr key={i} style={{ borderTop: '1px solid var(--color-border)' }}>
                          <td
                            style={{
                              padding: '5px 10px',
                              color: 'var(--color-text-muted)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {t.date}
                          </td>
                          <td
                            style={{
                              padding: '5px 10px',
                              color: 'var(--color-text-primary)',
                              maxWidth: 160,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {t.from_location}
                          </td>
                          <td
                            style={{
                              padding: '5px 10px',
                              color: 'var(--color-text-primary)',
                              maxWidth: 160,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {t.to_location}
                          </td>
                          <td
                            style={{
                              padding: '5px 10px',
                              color: 'var(--color-accent-gold)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {t.km.toFixed(1)}
                          </td>
                          <td
                            style={{
                              padding: '5px 10px',
                              color: 'var(--color-text-muted)',
                              maxWidth: 200,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {t.purpose}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => void handleBulkImport()}
                    disabled={importingBulk}
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-small)',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      padding: '8px 22px',
                      background: importingBulk
                        ? 'var(--color-surface-2)'
                        : 'var(--color-accent-gold)',
                      color: importingBulk ? 'var(--color-text-disabled)' : '#000',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      cursor: importingBulk ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {importingBulk ? 'Importing…' : `Import ${preview.length} trips`}
                  </button>
                  <button
                    onClick={() => setPreview(null)}
                    disabled={importingBulk}
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-small)',
                      padding: '8px 16px',
                      background: 'none',
                      color: 'var(--color-text-disabled)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Add trip form */}
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding: '18px 20px',
          marginBottom: 24,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: 'var(--color-text-disabled)',
            textTransform: 'uppercase',
            marginBottom: 14,
          }}
        >
          Log Trip
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div>
            <label style={labelStyle}>Date</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setField({ date: e.target.value })}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>From</label>
            <input
              value={form.from}
              onChange={(e) => setField({ from: e.target.value })}
              placeholder="Home / Sherwood Park"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>To</label>
            <input
              value={form.to}
              onChange={(e) => setField({ to: e.target.value })}
              placeholder="UPS / Costco"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>km (one-way)</label>
            <input
              type="number"
              value={form.km}
              onChange={(e) => setField({ km: e.target.value })}
              placeholder="12.5"
              min={0}
              step={0.1}
              style={inputStyle}
            />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={labelStyle}>Purpose</label>
            <input
              value={form.purpose}
              onChange={(e) => setField({ purpose: e.target.value })}
              placeholder="Pick up pallet / drop off shipment"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-text-muted)',
            }}
          >
            <input
              type="checkbox"
              checked={form.roundTrip}
              onChange={(e) => setField({ roundTrip: e.target.checked })}
              style={{ accentColor: 'var(--color-accent-gold)', cursor: 'pointer' }}
            />
            Round trip (doubles km)
          </label>
          {form.roundTrip && form.km && parseFloat(form.km) > 0 && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
                color: 'var(--color-accent-gold)',
              }}
            >
              = {(parseFloat(form.km) * 2).toFixed(1)} km total
            </span>
          )}
        </div>

        <button
          onClick={() => void handleAdd()}
          disabled={saving}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            fontWeight: 700,
            letterSpacing: '0.06em',
            padding: '8px 22px',
            background: saving ? 'var(--color-surface-2)' : 'var(--color-accent-gold)',
            color: saving ? 'var(--color-text-disabled)' : '#000',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Log Trip'}
        </button>
      </div>

      {/* Trip list */}
      {trips.length === 0 && !loading ? (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
            padding: '20px 0',
          }}
        >
          No trips logged for {year}.
        </div>
      ) : (
        <div
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            overflow: 'hidden',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.78rem',
            }}
          >
            <thead>
              <tr
                style={{
                  background: 'var(--color-surface-2)',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                {['Date', 'From', 'To', 'km', 'Purpose', ''].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: '8px 12px',
                      textAlign: 'left',
                      fontFamily: 'var(--font-ui)',
                      fontSize: '0.62rem',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      color: 'var(--color-text-disabled)',
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trips.map((trip) => {
                const effectiveKm = trip.km * (trip.round_trip ? 2 : 1)
                return (
                  <tr key={trip.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td
                      style={{
                        padding: '8px 12px',
                        color: 'var(--color-text-muted)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {trip.date}
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--color-text-primary)' }}>
                      {trip.from_location}
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--color-text-primary)' }}>
                      {trip.to_location}
                    </td>
                    <td
                      style={{
                        padding: '8px 12px',
                        color: 'var(--color-accent-gold)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {effectiveKm.toFixed(1)}
                      {trip.round_trip && (
                        <span
                          style={{
                            fontSize: '0.65rem',
                            color: 'var(--color-text-disabled)',
                            marginLeft: 4,
                          }}
                        >
                          (RT)
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        padding: '8px 12px',
                        color: 'var(--color-text-muted)',
                        maxWidth: 280,
                      }}
                    >
                      {trip.purpose}
                      {trip.notes && (
                        <span
                          style={{
                            display: 'block',
                            fontSize: '0.7rem',
                            color: 'var(--color-text-disabled)',
                          }}
                        >
                          {trip.notes}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                      <button
                        onClick={() => void handleDelete(trip.id)}
                        style={{
                          fontFamily: 'var(--font-ui)',
                          fontSize: '0.68rem',
                          background: 'none',
                          border: 'none',
                          color: 'var(--color-text-disabled)',
                          cursor: 'pointer',
                          padding: '2px 6px',
                        }}
                        title="Delete trip"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* CRA rate footnote */}
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: '0.68rem',
          color: 'var(--color-text-disabled)',
          marginTop: 16,
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: 'var(--color-text-muted)' }}>CRA rates 2024:</strong> $0.72/km
        (first 5,000 km) · $0.66/km (above 5,000 km). For self-employed, use actual vehicle expenses
        × business use % — the deduction estimate above is a flat-rate reference only. Business use
        % = business km ÷ total annual km.
      </div>
    </div>
  )
}
