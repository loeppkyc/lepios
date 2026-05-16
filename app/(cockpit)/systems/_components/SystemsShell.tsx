'use client'

import { useState, useEffect, useCallback } from 'react'
import { GaugePressure } from './GaugePressure'
import { BrainDumpFeed } from './BrainDumpFeed'
import type { SystemsMetricsResponse } from '@/app/api/systems/metrics/route'
import type { Idea } from '@/app/api/systems/ideas/route'

const POLL_MS = 30_000

function LastUpdated({ iso }: { iso: string }) {
  const d = new Date(iso)
  return (
    <span className="text-muted-foreground/60 font-mono text-[0.62rem]">
      {d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  )
}

interface SystemsShellProps {
  initialMetrics: SystemsMetricsResponse
  initialIdeas: Idea[]
}

export function SystemsShell({ initialMetrics, initialIdeas }: SystemsShellProps) {
  const [metrics, setMetrics] = useState<SystemsMetricsResponse>(initialMetrics)
  const [pulsing, setPulsing] = useState(false)

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch('/api/systems/metrics', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as SystemsMetricsResponse
      setMetrics(data)
      setPulsing(true)
      setTimeout(() => setPulsing(false), 600)
    } catch {
      // silent — stale data is fine
    }
  }, [])

  useEffect(() => {
    const id = setInterval(fetchMetrics, POLL_MS)
    return () => clearInterval(id)
  }, [fetchMetrics])

  const gauges = [
    metrics.harness,
    metrics.gpuDay,
    metrics.orbDay,
    metrics.businessReview,
    metrics.ram,
  ]

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
      {/* Pressure gauges row */}
      <section>
        <div className="mb-5 flex items-center justify-between">
          <h1 className="label-caps">System Status</h1>
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
                pulsing ? 'bg-positive' : 'bg-muted-foreground/30'
              }`}
            />
            <LastUpdated iso={metrics.fetchedAt} />
          </div>
        </div>

        <div
          className={`border-border bg-cockpit-surface flex flex-wrap justify-around gap-8 rounded-xl border p-6 transition-shadow duration-300 ${
            pulsing ? 'shadow-[0_0_16px_var(--color-positive-dim)]' : ''
          }`}
        >
          {gauges.map((g) => (
            <GaugePressure
              key={g.label}
              label={g.label}
              value={g.pct}
              sublabel={g.sublabel}
              note={g.note}
              inverted={g.inverted}
            />
          ))}
        </div>
      </section>

      {/* Divider */}
      <div className="border-border border-t" />

      {/* Brain dump feed */}
      <section>
        <BrainDumpFeed initialIdeas={initialIdeas} />
      </section>
    </div>
  )
}
