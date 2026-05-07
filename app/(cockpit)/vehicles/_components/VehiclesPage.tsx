'use client'

import { useCallback, useEffect, useState } from 'react'
import type { VehiclesDataResponse, VehicleData } from '@/app/api/vehicles-data/route'

const fmt = (n: number) =>
  n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

const fmtKm = (n: number) => Math.round(n).toLocaleString('en-CA') + ' km'

type Condition = 'Excellent' | 'Good' | 'Fair' | 'Poor'

export function VehiclesPage() {
  const [data, setData] = useState<VehiclesDataResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/vehicles-data')
      const j = (await r.json()) as VehiclesDataResponse & { error?: string }
      if (j.error) throw new Error(j.error)
      setData(j)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  return (
    <div
      style={{
        padding: '28px 32px',
        maxWidth: 1200,
        margin: '0 auto',
        fontFamily: 'var(--font-ui)',
      }}
    >
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
        Vehicles
      </h1>
      <p
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-muted)',
          margin: '6px 0 24px',
        }}
      >
        Fleet details, loan status, market valuation (AI), and maintenance log.
      </p>

      {loading && (
        <div style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)' }}>
          Loading…
        </div>
      )}
      {error && <div style={{ color: '#e5534b', fontSize: 'var(--text-small)' }}>{error}</div>}

      {data && !loading && (
        <>
          <div
            style={{
              display: 'flex',
              gap: 14,
              marginBottom: 24,
              flexWrap: 'wrap',
            }}
          >
            <Kpi label="Combined Current Value" value={fmt(data.totalCurrentValue)} />
            <Kpi label="Combined Mileage Driven" value={fmtKm(data.combinedYtdMileage)} />
            <Kpi label="Total Maintenance" value={fmt(data.totalMaintenanceCost)} />
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
            {data.vehicles.map((v) => (
              <VehicleCard key={v.id} v={v} onChange={load} />
            ))}
          </div>

          {/* All maintenance log */}
          <MaintenanceTable
            vehicles={data.vehicles}
            allMaintenance={data.vehicles.flatMap((v) =>
              v.maintenance.map((m) => ({ ...m, vehicle_name: v.name }))
            )}
            onChange={load}
          />
        </>
      )}
    </div>
  )
}

function VehicleCard({ v, onChange }: { v: VehicleData; onChange: () => void }) {
  const [editingValue, setEditingValue] = useState(false)
  const [valueInput, setValueInput] = useState(String(v.current_value_estimate ?? ''))
  const [editingKm, setEditingKm] = useState(false)
  const [kmInput, setKmInput] = useState(String(v.current_km ?? ''))
  const [showAi, setShowAi] = useState(false)
  const [condition, setCondition] = useState<Condition>('Good')
  const [aiResult, setAiResult] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const isBusiness = v.classification === 'business'
  const accentColor = isBusiness ? 'var(--color-pillar-money)' : 'var(--color-text-muted)'

  const saveValue = async () => {
    const num = parseFloat(valueInput)
    if (!Number.isFinite(num)) {
      setSaveError('Enter a number')
      return
    }
    setSaveError(null)
    const r = await fetch('/api/vehicles-data', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: v.id,
        current_value_estimate: num,
        current_value_source: 'manual',
      }),
    })
    if (!r.ok) {
      const j = (await r.json()) as { error?: string }
      setSaveError(j.error ?? 'Failed')
      return
    }
    setEditingValue(false)
    onChange()
  }

  const saveKm = async () => {
    const num = parseInt(kmInput, 10)
    if (!Number.isFinite(num) || num < 0) {
      setSaveError('Enter a positive number')
      return
    }
    setSaveError(null)
    const r = await fetch('/api/vehicles-data', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: v.id, current_km: num }),
    })
    if (!r.ok) {
      const j = (await r.json()) as { error?: string }
      setSaveError(j.error ?? 'Failed')
      return
    }
    setEditingKm(false)
    onChange()
  }

  const runAi = async () => {
    setAiLoading(true)
    setAiError(null)
    setAiResult(null)
    try {
      const r = await fetch('/api/vehicles-data/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: v.year,
          make: v.make,
          model: v.model,
          trim: v.trim ?? undefined,
          km: v.current_km ?? 0,
          condition,
        }),
      })
      const j = (await r.json()) as { estimate?: string; error?: string }
      if (j.error) throw new Error(j.error)
      setAiResult(j.estimate ?? '')
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e))
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div
      style={{
        flex: '1 1 460px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '20px 24px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div
            style={{
              fontFamily: 'var(--font-display, var(--font-ui))',
              fontSize: '1.05rem',
              fontWeight: 800,
              color: 'var(--color-text-primary)',
            }}
          >
            {v.year} {v.make} {v.model}
            {v.trim ? ` ${v.trim}` : ''}
          </div>
          <div
            style={{
              fontSize: '0.62rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: accentColor,
              marginTop: 3,
            }}
          >
            {v.classification}
            {v.business_use_pct > 0 && v.business_use_pct < 100
              ? ` · ${v.business_use_pct}% business`
              : ''}
          </div>
        </div>
        <div
          style={{
            fontSize: '0.62rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color:
              v.loan_status === 'paid_off'
                ? 'var(--color-pillar-health)'
                : 'var(--color-accent-gold)',
          }}
        >
          {v.loan_status === 'paid_off'
            ? '✓ PAID OFF'
            : v.loan_remaining
              ? `Loan ${fmt(v.loan_remaining)}`
              : 'Loan'}
        </div>
      </div>

      {/* Stats grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '6px 16px',
          fontSize: 'var(--text-small)',
          marginBottom: 14,
        }}
      >
        <Stat label="Purchased" value={v.purchased_at ?? '—'} />
        <Stat
          label="Purchase Price"
          value={v.purchase_price != null ? fmt(v.purchase_price) : '—'}
        />
        <Stat
          label="Km at Purchase"
          value={v.km_at_purchase != null ? fmtKm(v.km_at_purchase) : '—'}
        />
        <Stat
          label="Current Km"
          value={v.current_km != null ? fmtKm(v.current_km) : '—'}
          editable
          editing={editingKm}
          onEdit={() => {
            setKmInput(String(v.current_km ?? ''))
            setEditingKm(true)
          }}
          editor={
            editingKm && (
              <span style={{ display: 'inline-flex', gap: 4 }}>
                <input
                  type="number"
                  value={kmInput}
                  onChange={(e) => setKmInput(e.target.value)}
                  style={inputStyle}
                  autoFocus
                />
                <MiniBtn onClick={saveKm}>Save</MiniBtn>
                <MiniBtn onClick={() => setEditingKm(false)} subtle>
                  ✕
                </MiniBtn>
              </span>
            )
          }
        />
        <Stat label="Km Driven" value={v.km_driven != null ? fmtKm(v.km_driven) : '—'} />
        <Stat
          label="Avg Pace"
          value={
            v.km_per_month != null ? `${Math.round(v.km_per_month).toLocaleString()} km/mo` : '—'
          }
        />
      </div>

      {/* Current value row */}
      <div
        style={{
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding: '10px 14px',
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-text-disabled)',
            }}
          >
            Current Value Estimate
          </span>
          {!editingValue && (
            <span style={{ display: 'inline-flex', gap: 6 }}>
              <MiniBtn
                onClick={() => {
                  setValueInput(String(v.current_value_estimate ?? ''))
                  setEditingValue(true)
                }}
                subtle
              >
                Edit
              </MiniBtn>
              <MiniBtn onClick={() => setShowAi((s) => !s)} subtle>
                🤖 AI
              </MiniBtn>
            </span>
          )}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '1.4rem',
            fontWeight: 700,
            color: 'var(--color-accent-gold)',
            marginTop: 4,
          }}
        >
          {editingValue ? (
            <span style={{ display: 'inline-flex', gap: 6 }}>
              <input
                type="number"
                step="0.01"
                value={valueInput}
                onChange={(e) => setValueInput(e.target.value)}
                style={{ ...inputStyle, fontSize: '1.1rem', width: 130 }}
                autoFocus
              />
              <MiniBtn onClick={saveValue}>Save</MiniBtn>
              <MiniBtn onClick={() => setEditingValue(false)} subtle>
                ✕
              </MiniBtn>
            </span>
          ) : v.current_value_estimate != null ? (
            fmt(v.current_value_estimate)
          ) : (
            <span style={{ fontSize: '0.9rem', color: 'var(--color-text-disabled)' }}>
              Not yet estimated — Edit or click 🤖 AI
            </span>
          )}
        </div>
        {v.current_value_source && (
          <div
            style={{
              fontSize: '0.65rem',
              color: 'var(--color-text-disabled)',
              marginTop: 4,
            }}
          >
            Source: {v.current_value_source}
            {v.current_value_updated_at
              ? ` · updated ${v.current_value_updated_at.slice(0, 10)}`
              : ''}
          </div>
        )}
        {saveError && (
          <div style={{ color: '#e5534b', fontSize: '0.7rem', marginTop: 4 }}>{saveError}</div>
        )}
      </div>

      {/* AI panel */}
      {showAi && (
        <div
          style={{
            background: 'rgba(63,185,80,0.05)',
            border: '1px solid rgba(63,185,80,0.3)',
            borderRadius: 'var(--radius-sm)',
            padding: '12px 14px',
            marginBottom: 12,
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Condition:</span>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as Condition)}
              style={{ ...inputStyle, fontFamily: 'var(--font-ui)' }}
            >
              <option>Excellent</option>
              <option>Good</option>
              <option>Fair</option>
              <option>Poor</option>
            </select>
            <button
              onClick={() => void runAi()}
              disabled={aiLoading}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.65rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                padding: '5px 12px',
                background: 'var(--color-pillar-health)',
                color: '#000',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: aiLoading ? 'wait' : 'pointer',
                opacity: aiLoading ? 0.6 : 1,
              }}
            >
              {aiLoading ? 'Checking…' : 'Get Estimate'}
            </button>
          </div>
          {aiError && <div style={{ color: '#e5534b', fontSize: '0.7rem' }}>{aiError}</div>}
          {aiResult && (
            <div
              style={{
                fontSize: 'var(--text-small)',
                whiteSpace: 'pre-wrap',
                color: 'var(--color-text-secondary)',
                lineHeight: 1.6,
                marginTop: 8,
              }}
            >
              {aiResult}
            </div>
          )}
        </div>
      )}

      {v.notes && (
        <div
          style={{
            fontSize: '0.7rem',
            color: 'var(--color-text-disabled)',
            lineHeight: 1.6,
          }}
        >
          {v.notes}
        </div>
      )}

      <div
        style={{
          fontSize: '0.7rem',
          color: 'var(--color-text-muted)',
          marginTop: 8,
        }}
      >
        Maintenance: {v.maintenance.length} entries · {fmt(v.total_maintenance_cost)}
      </div>
    </div>
  )
}

function MaintenanceTable({
  vehicles,
  allMaintenance,
  onChange,
}: {
  vehicles: VehicleData[]
  allMaintenance: Array<{
    id: string
    vehicle_id: string
    vehicle_name: string
    service_date: string
    km: number | null
    service: string
    cost: number | null
    notes: string | null
  }>
  onChange: () => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? '')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [km, setKm] = useState('')
  const [service, setService] = useState('')
  const [cost, setCost] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    if (!vehicleId || !date || !service.trim()) {
      setErr('Vehicle, date, and service are required')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const r = await fetch('/api/vehicles-data/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          service_date: date,
          km: km ? parseInt(km, 10) : null,
          service: service.trim(),
          cost: cost ? parseFloat(cost) : null,
          notes: notes.trim() || null,
        }),
      })
      const j = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      setKm('')
      setService('')
      setCost('')
      setNotes('')
      setShowAdd(false)
      onChange()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this maintenance entry?')) return
    await fetch(`/api/vehicles-data/maintenance?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    onChange()
  }

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 16px',
          background: 'var(--color-surface-2)',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span
          style={{
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--color-text-disabled)',
          }}
        >
          Maintenance Log — {allMaintenance.length} entries
        </span>
        <button
          onClick={() => setShowAdd((s) => !s)}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            padding: '5px 12px',
            background: showAdd ? 'var(--color-surface-2)' : 'var(--color-accent-gold)',
            color: showAdd ? 'var(--color-text-muted)' : '#000',
            border: showAdd ? '1px solid var(--color-border)' : 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
          }}
        >
          {showAdd ? 'Cancel' : '+ Add Entry'}
        </button>
      </div>

      {showAdd && (
        <div
          style={{
            padding: '14px 16px',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <select
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            style={{ ...inputStyle, fontFamily: 'var(--font-ui)' }}
          >
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={inputStyle}
          />
          <input
            type="number"
            placeholder="Km"
            value={km}
            onChange={(e) => setKm(e.target.value)}
            style={{ ...inputStyle, width: 110 }}
          />
          <input
            type="text"
            placeholder="Service / work done"
            value={service}
            onChange={(e) => setService(e.target.value)}
            style={{ ...inputStyle, flex: '2 1 240px' }}
          />
          <input
            type="number"
            step="0.01"
            placeholder="Cost"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            style={{ ...inputStyle, width: 110 }}
          />
          <input
            type="text"
            placeholder="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ ...inputStyle, flex: '1 1 200px' }}
          />
          <button
            onClick={() => void submit()}
            disabled={saving}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: '0.7rem',
              fontWeight: 700,
              padding: '6px 14px',
              background: 'var(--color-accent-gold)',
              color: '#000',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: saving ? 'wait' : 'pointer',
            }}
          >
            {saving ? '…' : 'Save'}
          </button>
          {err && <span style={{ color: '#e5534b', fontSize: '0.7rem' }}>{err}</span>}
        </div>
      )}

      {allMaintenance.length === 0 ? (
        <div
          style={{
            padding: '20px',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
          }}
        >
          No maintenance entries yet. Click + Add Entry to log the first one.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Date', 'Vehicle', 'Km', 'Service', 'Cost', 'Notes', ''].map((h, i) => (
                <th
                  key={h + i}
                  style={{
                    padding: '8px 12px',
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--color-text-disabled)',
                    textAlign: i === 4 ? 'right' : 'left',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allMaintenance.map((m) => (
              <tr key={m.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td
                  style={{
                    padding: '8px 12px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.78rem',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {m.service_date}
                </td>
                <td
                  style={{
                    padding: '8px 12px',
                    fontSize: 'var(--text-small)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {m.vehicle_name}
                </td>
                <td
                  style={{
                    padding: '8px 12px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.78rem',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {m.km != null ? fmtKm(m.km) : '—'}
                </td>
                <td style={{ padding: '8px 12px', fontSize: 'var(--text-small)' }}>{m.service}</td>
                <td
                  style={{
                    padding: '8px 12px',
                    textAlign: 'right',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-small)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {m.cost != null ? fmt(m.cost) : '—'}
                </td>
                <td
                  style={{
                    padding: '8px 12px',
                    fontSize: '0.72rem',
                    color: 'var(--color-text-disabled)',
                  }}
                >
                  {m.notes ?? ''}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                  <button
                    onClick={() => void remove(m.id)}
                    style={{
                      fontSize: '0.62rem',
                      padding: '3px 8px',
                      background: 'none',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text-disabled)',
                      cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        padding: '14px 18px',
        flex: 1,
        minWidth: 200,
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
          fontSize: '0.65rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--color-text-disabled)',
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  editable,
  editing,
  onEdit,
  editor,
}: {
  label: string
  value: string
  editable?: boolean
  editing?: boolean
  onEdit?: () => void
  editor?: React.ReactNode
}) {
  return (
    <div>
      <div
        style={{
          fontSize: '0.62rem',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--color-text-disabled)',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-primary)',
          marginTop: 2,
        }}
      >
        {editing && editor ? (
          editor
        ) : (
          <>
            {value}
            {editable && (
              <button
                onClick={onEdit}
                style={{
                  fontSize: '0.6rem',
                  padding: '1px 6px',
                  background: 'none',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-disabled)',
                  cursor: 'pointer',
                  marginLeft: 6,
                }}
              >
                ✎
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.78rem',
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-primary)',
  padding: '4px 8px',
}

function MiniBtn({
  children,
  onClick,
  subtle,
}: {
  children: React.ReactNode
  onClick: () => void
  subtle?: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: 'var(--font-ui)',
        fontSize: '0.62rem',
        fontWeight: 700,
        padding: '3px 8px',
        background: subtle ? 'none' : 'var(--color-accent-gold)',
        color: subtle ? 'var(--color-text-muted)' : '#000',
        border: subtle ? '1px solid var(--color-border)' : 'none',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}
