'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ChevronDown, Save } from 'lucide-react'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { Radar, RadarChart, PolarGrid, PolarAngleAxis } from 'recharts'

interface AreaEntry {
  id: string
  area: string
  score: number
  notes: string | null
  updated_at: string
}

const AREAS = [
  { key: 'Health', label: 'Health & Fitness' },
  { key: 'Career', label: 'Career & Finance' },
  { key: 'Relationships', label: 'Relationships' },
  { key: 'Personal Growth', label: 'Personal Growth' },
  { key: 'Fun & Recreation', label: 'Fun & Recreation' },
  { key: 'Environment', label: 'Environment' },
  { key: 'Spirituality', label: 'Spirituality' },
  { key: 'Family', label: 'Family' },
]

const chartConfig = {
  score: { label: 'Score', color: 'var(--color-pillar-money)' },
}

function AreaCard({
  area,
  score,
  notes,
  onChange,
  onSave,
}: {
  area: { key: string; label: string }
  score: number
  notes: string
  onChange: (area: string, score: number) => void
  onSave: (area: string, score: number, notes: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [localNotes, setLocalNotes] = useState(notes)

  const scoreColor =
    score >= 8 ? 'text-green-500' :
    score >= 5 ? 'text-yellow-500' :
    'text-red-500'

  return (
    <Card className="border border-border">
      <CardHeader className="pb-2">
        <div
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setOpen((o) => !o)}
        >
          <div className="flex items-center gap-3">
            <span className={`text-xl font-bold ${scoreColor}`}>{score}</span>
            <span className="font-medium text-sm">{area.label}</span>
          </div>
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </CardHeader>
      <CardContent className="pb-2">
        <input
          type="range"
          min={0}
          max={10}
          step={1}
          value={score}
          onChange={(e) => onChange(area.key, Number(e.target.value))}
          className="w-full accent-primary"
        />
        {open && (
          <div className="mt-3 space-y-2">
            <textarea
              className="w-full text-sm bg-muted rounded p-2 border border-border resize-none h-20 focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Notes..."
              value={localNotes}
              onChange={(e) => setLocalNotes(e.target.value)}
            />
            <Button size="sm" onClick={() => onSave(area.key, score, localNotes)}>
              <Save className="w-3.5 h-3.5 mr-1" /> Save
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function LifeCompassClient() {
  const [areaMap, setAreaMap] = useState<Record<string, { score: number; notes: string }>>(() =>
    Object.fromEntries(AREAS.map((a) => [a.key, { score: 5, notes: '' }]))
  )
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/life-compass')
    const data = await res.json()
    const map: Record<string, { score: number; notes: string }> = {}
    for (const area of AREAS) {
      const entry = (data.entries ?? []).find((e: AreaEntry) => e.area === area.key)
      map[area.key] = { score: entry?.score ?? 5, notes: entry?.notes ?? '' }
    }
    setAreaMap(map)
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData()
  }, [fetchData])

  function handleChange(area: string, score: number) {
    setAreaMap((prev) => ({ ...prev, [area]: { ...prev[area], score } }))
  }

  async function handleSave(area: string, score: number, notes: string) {
    setSaving(true)
    await fetch('/api/life-compass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ area, score, notes }),
    })
    setSaving(false)
    fetchData()
  }

  async function handleSaveAll() {
    setSaving(true)
    await Promise.all(
      AREAS.map((a) =>
        fetch('/api/life-compass', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ area: a.key, score: areaMap[a.key].score, notes: areaMap[a.key].notes }),
        })
      )
    )
    setSaving(false)
    fetchData()
  }

  const radarData = AREAS.map((a) => ({ subject: a.key, score: areaMap[a.key]?.score ?? 5 }))
  const avgScore = (AREAS.reduce((acc, a) => acc + (areaMap[a.key]?.score ?? 5), 0) / AREAS.length).toFixed(1)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Life Compass</h1>
          <p className="text-muted-foreground text-sm mt-1">Score your 8 life areas</p>
        </div>
        <Button onClick={handleSaveAll} disabled={saving}>
          <Save className="w-4 h-4 mr-2" /> Save All
        </Button>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Radar View</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center mb-2">
              <span className="text-3xl font-bold">{avgScore}</span>
              <span className="text-muted-foreground ml-1 text-sm">/ 10 avg</span>
            </div>
            <ChartContainer config={chartConfig} className="h-64 w-full">
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
                <Radar
                  name="Score"
                  dataKey="score"
                  stroke="var(--color-pillar-money)"
                  fill="var(--color-pillar-money)"
                  fillOpacity={0.25}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
              </RadarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {loading ? (
            <div className="text-muted-foreground text-sm">Loading...</div>
          ) : (
            AREAS.map((area) => (
              <AreaCard
                key={area.key}
                area={area}
                score={areaMap[area.key]?.score ?? 5}
                notes={areaMap[area.key]?.notes ?? ''}
                onChange={handleChange}
                onSave={handleSave}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}