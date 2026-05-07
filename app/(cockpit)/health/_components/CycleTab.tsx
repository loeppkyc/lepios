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
  ENDO_BOWEL_STATUSES,
  ENDO_MOODS,
  ENDO_PAIN_LOCATIONS,
  type CycleEntryRow,
  type EndoBowelStatus,
  type EndoMood,
  type EndoPainLocation,
  type PersonHandle,
} from '@/lib/health/types'
import { cycleAverages } from '@/lib/health/helpers'
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

const trendConfig: ChartConfig = {
  pain_level: { label: 'Pain', color: 'var(--color-critical)' },
  bloating: { label: 'Bloating', color: 'var(--color-pillar-money)' },
  energy: { label: 'Energy', color: 'var(--color-pillar-health)' },
}

export function CycleTab({ person, entries }: { person: PersonHandle; entries: CycleEntryRow[] }) {
  const router = useRouter()
  const [entryDate, setEntryDate] = useState(today())
  const [cycleDay, setCycleDay] = useState<number | ''>('')
  const [painLevel, setPainLevel] = useState(0)
  const [painLocations, setPainLocations] = useState<Set<EndoPainLocation>>(new Set())
  const [bloating, setBloating] = useState(0)
  const [energy, setEnergy] = useState(5)
  const [mood, setMood] = useState<EndoMood>('Okay')
  const [sleepQuality, setSleepQuality] = useState(5)
  const [bowelStatus, setBowelStatus] = useState<EndoBowelStatus>('Normal')
  const [foods, setFoods] = useState('')
  const [supplements, setSupplements] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null)

  const avg30 = cycleAverages(entries, 30)
  const now = new Date()
  const cutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10)
  const trendData = [...entries]
    .filter((e) => e.entry_date >= cutoff)
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date))
    .map((e) => ({
      date: e.entry_date,
      pain_level: e.pain_level,
      bloating: e.bloating,
      energy: e.energy,
    }))

  function toggleLocation(l: EndoPainLocation) {
    setPainLocations((prev) => {
      const next = new Set(prev)
      if (next.has(l)) next.delete(l)
      else next.add(l)
      return next
    })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setStatus(null)
    try {
      const res = await fetch('/api/health/cycle-entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          person_handle: person,
          entry_date: entryDate,
          cycle_day: cycleDay === '' || cycleDay === 0 ? null : cycleDay,
          pain_level: painLevel,
          pain_locations: Array.from(painLocations),
          bloating,
          energy,
          mood,
          sleep_quality: sleepQuality,
          bowel_status: bowelStatus,
          foods,
          supplements,
          notes,
        }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !body.ok) {
        setStatus({ tone: 'error', message: body.error ?? `HTTP ${res.status}` })
      } else {
        setFoods('')
        setSupplements('')
        setNotes('')
        setStatus({ tone: 'ok', message: 'Saved.' })
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
      <Disclosure title="+ Log Daily Entry" defaultOpen={entries.length === 0}>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Date</div>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Cycle Day (1=period start, blank=unknown)</div>
              <input
                type="number"
                min={0}
                max={60}
                value={cycleDay}
                onChange={(e) => setCycleDay(e.target.value === '' ? '' : Number(e.target.value))}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Pain ({painLevel}/10)</div>
              <input
                type="range"
                min={0}
                max={10}
                value={painLevel}
                onChange={(e) => setPainLevel(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </label>
          </div>
          <div>
            <div style={labelStyle}>Pain Locations</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {ENDO_PAIN_LOCATIONS.map((l) => {
                const active = painLocations.has(l)
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => toggleLocation(l)}
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      padding: '4px 10px',
                      background: active ? 'var(--color-critical)' : 'var(--color-base)',
                      color: active ? 'var(--color-base)' : 'var(--color-text-muted)',
                      border: `1px solid ${
                        active ? 'var(--color-critical)' : 'var(--color-border)'
                      }`,
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                    }}
                  >
                    {l}
                  </button>
                )
              })}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Bloating ({bloating}/10)</div>
              <input
                type="range"
                min={0}
                max={10}
                value={bloating}
                onChange={(e) => setBloating(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </label>
            <label>
              <div style={labelStyle}>Energy ({energy}/10)</div>
              <input
                type="range"
                min={0}
                max={10}
                value={energy}
                onChange={(e) => setEnergy(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </label>
            <label>
              <div style={labelStyle}>Sleep Quality ({sleepQuality}/10)</div>
              <input
                type="range"
                min={0}
                max={10}
                value={sleepQuality}
                onChange={(e) => setSleepQuality(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Mood</div>
              <select
                value={mood}
                onChange={(e) => setMood(e.target.value as EndoMood)}
                style={inputStyle}
              >
                {ENDO_MOODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <div style={labelStyle}>Bowel Status</div>
              <select
                value={bowelStatus}
                onChange={(e) => setBowelStatus(e.target.value as EndoBowelStatus)}
                style={inputStyle}
              >
                {ENDO_BOWEL_STATUSES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            <div style={labelStyle}>Foods / Triggers</div>
            <input
              type="text"
              value={foods}
              onChange={(e) => setFoods(e.target.value)}
              placeholder="e.g. dairy, gluten, sugar, alcohol"
              style={inputStyle}
            />
          </label>
          <label>
            <div style={labelStyle}>Supplements Taken</div>
            <input
              type="text"
              value={supplements}
              onChange={(e) => setSupplements(e.target.value)}
              placeholder="e.g. NAC, Omega-3, Curcumin, Mag"
              style={inputStyle}
            />
          </label>
          <label>
            <div style={labelStyle}>Notes</div>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Period started, flare-up, good day, etc."
              style={inputStyle}
            />
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="submit" disabled={submitting} style={buttonPrimary}>
              {submitting ? 'Saving…' : 'Save Entry'}
            </button>
            <StatusLine status={status} />
          </div>
        </form>
      </Disclosure>

      {entries.length === 0 ? (
        <EmptyState message="No entries yet. Patterns emerge after 2–3 cycles of consistent logging." />
      ) : (
        <>
          {avg30.count > 0 && (
            <div style={cardStyle}>
              <span style={sectionTitle}>30-Day Averages ({avg30.count} entries)</span>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <div>
                  <div style={labelStyle}>Avg Pain</div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-pillar-value)',
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    {avg30.pain != null ? `${avg30.pain.toFixed(1)}/10` : '—'}
                  </div>
                </div>
                <div>
                  <div style={labelStyle}>Avg Bloating</div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-pillar-value)',
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    {avg30.bloating != null ? `${avg30.bloating.toFixed(1)}/10` : '—'}
                  </div>
                </div>
                <div>
                  <div style={labelStyle}>Avg Energy</div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-pillar-value)',
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    {avg30.energy != null ? `${avg30.energy.toFixed(1)}/10` : '—'}
                  </div>
                </div>
              </div>
              {trendData.length > 1 && (
                <ChartContainer config={trendConfig} className="h-48 w-full">
                  <LineChart data={trendData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
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
                      width={32}
                      domain={[0, 10]}
                      tick={{
                        fontSize: 10,
                        fill: 'var(--color-text-disabled)',
                        fontFamily: 'var(--font-ui)',
                      }}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line
                      type="monotone"
                      dataKey="pain_level"
                      stroke="var(--color-pain_level)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="bloating"
                      stroke="var(--color-bloating)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="energy"
                      stroke="var(--color-energy)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ChartContainer>
              )}
            </div>
          )}

          <Disclosure title={`All entries (${entries.length})`}>
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={tableHeaderCell}>Date</th>
                    <th style={tableHeaderCell}>Cycle Day</th>
                    <th style={tableHeaderCell}>Pain</th>
                    <th style={tableHeaderCell}>Bloating</th>
                    <th style={tableHeaderCell}>Energy</th>
                    <th style={tableHeaderCell}>Mood</th>
                    <th style={tableHeaderCell}>Bowel</th>
                    <th style={tableHeaderCell}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td style={tableCell}>{e.entry_date}</td>
                      <td style={tableCell}>{e.cycle_day ?? '—'}</td>
                      <td style={tableCell}>{e.pain_level}/10</td>
                      <td style={tableCell}>{e.bloating}/10</td>
                      <td style={tableCell}>{e.energy}/10</td>
                      <td style={tableCell}>{e.mood || '—'}</td>
                      <td style={tableCell}>{e.bowel_status || '—'}</td>
                      <td style={tableCell}>{e.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Disclosure>
        </>
      )}
    </div>
  )
}
