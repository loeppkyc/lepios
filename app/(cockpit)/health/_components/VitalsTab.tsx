'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import {
  VITAL_TYPES,
  VITAL_DEFAULT_UNITS,
  type PersonHandle,
  type VitalRow,
  type VitalType,
} from '@/lib/health/types'
import { distinctVitalTypes, vitalSeries } from '@/lib/health/helpers'
import {
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
} from './HealthCommon'

const today = () => new Date().toISOString().slice(0, 10)

function formatTickDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
  })
}

export function VitalsTab({ person, vitals }: { person: PersonHandle; vitals: VitalRow[] }) {
  const router = useRouter()
  const [vitalType, setVitalType] = useState<VitalType>('Weight')
  const [recordedOn, setRecordedOn] = useState(today())
  const [value, setValue] = useState('')
  const [unit, setUnit] = useState(VITAL_DEFAULT_UNITS['Weight'])
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null)

  const types = distinctVitalTypes(vitals)
  const [chartType, setChartType] = useState<string>(types[0] ?? 'Weight')
  const series = vitalSeries(vitals, chartType)
  const chartConfig: ChartConfig = {
    value: { label: chartType, color: 'var(--color-pillar-health)' },
  }

  function pickType(t: VitalType) {
    setVitalType(t)
    setUnit(VITAL_DEFAULT_UNITS[t])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!value.trim()) {
      setStatus({ tone: 'error', message: 'Enter a value' })
      return
    }
    const n = Number(value)
    if (!Number.isFinite(n)) {
      setStatus({ tone: 'error', message: 'Value must be numeric' })
      return
    }
    setSubmitting(true)
    setStatus(null)
    try {
      const res = await fetch('/api/health/vitals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          person_handle: person,
          recorded_on: recordedOn,
          vital_type: vitalType,
          value: n,
          unit,
          notes,
        }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !body.ok) {
        setStatus({ tone: 'error', message: body.error ?? `HTTP ${res.status}` })
      } else {
        setValue('')
        setNotes('')
        setStatus({ tone: 'ok', message: 'Logged.' })
        router.refresh()
      }
    } catch (err) {
      setStatus({ tone: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Disclosure title="+ Log Vital">
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Date</div>
              <input
                type="date"
                value={recordedOn}
                onChange={(e) => setRecordedOn(e.target.value)}
                style={inputStyle}
                required
              />
            </label>
            <label>
              <div style={labelStyle}>Type</div>
              <select
                value={vitalType}
                onChange={(e) => pickType(e.target.value as VitalType)}
                style={inputStyle}
              >
                {VITAL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Value</div>
              <input
                type="text"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="e.g. 72"
                style={inputStyle}
                required
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
          </div>
          <label>
            <div style={labelStyle}>Notes (optional)</div>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={inputStyle}
            />
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="submit" disabled={submitting} style={buttonPrimary}>
              {submitting ? 'Saving…' : 'Log Vital'}
            </button>
            <StatusLine status={status} />
          </div>
        </form>
      </Disclosure>

      {vitals.length === 0 ? (
        <EmptyState message="No vitals logged yet." />
      ) : (
        <>
          {types.length > 0 && (
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <span style={sectionTitle}>Trend</span>
                <select
                  value={chartType}
                  onChange={(e) => setChartType(e.target.value)}
                  style={{ ...inputStyle, width: 'auto' }}
                >
                  {types.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              {series.length > 0 ? (
                <ChartContainer config={chartConfig} className="h-48 w-full">
                  <LineChart data={series} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid
                      vertical={false}
                      stroke="var(--color-border)"
                      strokeOpacity={0.5}
                    />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatTickDate}
                      tickLine={false}
                      axisLine={false}
                      tick={{
                        fontSize: 10,
                        fill: 'var(--color-text-disabled)',
                        fontFamily: 'var(--font-ui)',
                      }}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={36}
                      tick={{
                        fontSize: 10,
                        fill: 'var(--color-text-disabled)',
                        fontFamily: 'var(--font-ui)',
                      }}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="var(--color-value)"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ChartContainer>
              ) : (
                <span
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-small)',
                    color: 'var(--color-text-disabled)',
                  }}
                >
                  No data for this type yet.
                </span>
              )}
            </div>
          )}

          <div style={cardStyle}>
            <span style={sectionTitle}>History</span>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={tableHeaderCell}>Date</th>
                    <th style={tableHeaderCell}>Type</th>
                    <th style={{ ...tableHeaderCell, textAlign: 'right' }}>Value</th>
                    <th style={tableHeaderCell}>Unit</th>
                    <th style={tableHeaderCell}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {vitals.map((v) => (
                    <tr key={v.id}>
                      <td style={tableCell}>{v.recorded_on}</td>
                      <td style={tableCell}>{v.vital_type}</td>
                      <td
                        style={{
                          ...tableCell,
                          textAlign: 'right',
                          fontFamily: 'var(--font-mono)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {v.value}
                      </td>
                      <td style={tableCell}>{v.unit}</td>
                      <td style={tableCell}>{v.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
