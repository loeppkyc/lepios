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
import { DEFAULT_WEIGHT_LBS, type WeightRow } from '@/lib/diet/types'
import { latestWeight, weightSeries } from '@/lib/diet/helpers'
import {
  buttonDanger,
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
} from './DietCommon'

const today = () => new Date().toISOString().slice(0, 10)

function formatTickDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
  })
}

const chartConfig: ChartConfig = {
  weight_lbs: { label: 'Weight (lbs)', color: 'var(--color-pillar-health)' },
}

export function WeightTab({ weights }: { weights: WeightRow[] }) {
  const router = useRouter()
  const latest = latestWeight(weights)
  const series = weightSeries(weights)

  const [weighedOn, setWeighedOn] = useState(today())
  const [weightLbs, setWeightLbs] = useState<string>(
    latest ? String(latest.weight_lbs) : String(DEFAULT_WEIGHT_LBS)
  )
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<{
    tone: 'ok' | 'error'
    message: string
  } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const w = Number(weightLbs)
    if (!Number.isFinite(w) || w <= 0) {
      setSubmitStatus({ tone: 'error', message: 'Weight must be a positive number' })
      return
    }
    setSubmitting(true)
    setSubmitStatus(null)
    try {
      const res = await fetch('/api/diet/weight', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ weighed_on: weighedOn, weight_lbs: w, notes }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !body.ok) {
        setSubmitStatus({ tone: 'error', message: body.error ?? `HTTP ${res.status}` })
      } else {
        setNotes('')
        setSubmitStatus({ tone: 'ok', message: 'Logged.' })
        router.refresh()
      }
    } catch (err) {
      setSubmitStatus({ tone: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setSubmitting(false)
    }
  }

  async function deleteWeight(id: string) {
    if (!confirm('Delete this weight entry?')) return
    const res = await fetch(`/api/diet/weight/${id}`, { method: 'DELETE' })
    if (res.ok) router.refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Disclosure title="+ Log Weight" defaultOpen={weights.length === 0}>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Date</div>
              <input
                type="date"
                value={weighedOn}
                onChange={(e) => setWeighedOn(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Weight (lbs)</div>
              <input
                type="text"
                inputMode="decimal"
                value={weightLbs}
                onChange={(e) => setWeightLbs(e.target.value)}
                style={inputStyle}
                required
              />
            </label>
            <label>
              <div style={labelStyle}>Notes (optional)</div>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="submit" disabled={submitting} style={buttonPrimary}>
              {submitting ? 'Saving…' : 'Log Weight'}
            </button>
            <StatusLine status={submitStatus} />
            <span
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                color: 'var(--color-text-disabled)',
              }}
            >
              Same date overwrites the previous entry (UNIQUE constraint).
            </span>
          </div>
        </form>
      </Disclosure>

      {latest && (
        <div style={cardStyle}>
          <span style={labelStyle}>Latest · {latest.weighed_on}</span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-pillar-value)',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
            }}
          >
            {latest.weight_lbs} lbs
          </span>
        </div>
      )}

      {series.length > 1 && (
        <div style={cardStyle}>
          <span style={sectionTitle}>Trend</span>
          <ChartContainer config={chartConfig} className="h-48 w-full">
            <LineChart data={series} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.5} />
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
                domain={['dataMin - 2', 'dataMax + 2']}
                tick={{
                  fontSize: 10,
                  fill: 'var(--color-text-disabled)',
                  fontFamily: 'var(--font-ui)',
                }}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                type="monotone"
                dataKey="weight_lbs"
                stroke="var(--color-weight_lbs)"
                strokeWidth={2}
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ChartContainer>
        </div>
      )}

      {weights.length === 0 ? (
        <EmptyState message="No weight entries yet. v1.1 will add TDEE projection." />
      ) : (
        <div style={cardStyle}>
          <span style={sectionTitle}>History</span>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={tableHeaderCell}>Date</th>
                  <th style={{ ...tableHeaderCell, textAlign: 'right' }}>Weight (lbs)</th>
                  <th style={tableHeaderCell}>Notes</th>
                  <th style={tableHeaderCell}></th>
                </tr>
              </thead>
              <tbody>
                {weights.map((w) => (
                  <tr key={w.id}>
                    <td style={tableCell}>{w.weighed_on}</td>
                    <td
                      style={{
                        ...tableCell,
                        textAlign: 'right',
                        fontFamily: 'var(--font-mono)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {w.weight_lbs}
                    </td>
                    <td style={tableCell}>{w.notes || '—'}</td>
                    <td style={tableCell}>
                      <button onClick={() => deleteWeight(w.id)} style={buttonDanger}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
