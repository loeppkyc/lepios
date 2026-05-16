'use client'

// F20: NO inline style={} — Tailwind + CSS vars only

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'

export interface DailyCount {
  date: string
  count: number
}

export interface DriftEvent {
  occurred_at: string
  actor: string | null
  input_summary: string | null
  meta: { files?: string[]; claimed_scope?: string[] } | null
}

interface Props {
  dailyCounts: DailyCount[]
  totalWindows: number
  driftWindows: number
  driftFreeWindows: number
  recentEvents: DriftEvent[]
}

const chartConfig: ChartConfig = {
  count: { label: 'Drift attempts', color: 'var(--color-pillar-risk)' },
}

export function DriftChart({
  dailyCounts,
  totalWindows,
  driftWindows,
  driftFreeWindows,
  recentEvents,
}: Props) {
  const totalDrift = dailyCounts.reduce((s, d) => s + d.count, 0)

  return (
    <div className="space-y-6">
      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Total drift attempts', value: totalDrift },
          { label: 'Windows with drift', value: driftWindows },
          { label: 'Drift-free windows', value: driftFreeWindows },
          { label: 'Total windows (30d)', value: totalWindows },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3"
          >
            <div className="text-[length:var(--text-heading)] font-[var(--font-ui)] font-semibold text-[var(--color-text-primary)]">
              {value}
            </div>
            <div className="mt-0.5 text-[length:var(--text-small)] font-[var(--font-ui)] text-[var(--color-text-muted)]">
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      {dailyCounts.length > 0 ? (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="mb-3 text-[length:var(--text-small)] font-[var(--font-ui)] text-[var(--color-text-muted)]">
            Drift attempts per day — last 30 days
          </p>
          <ChartContainer config={chartConfig} className="h-48 w-full">
            <BarChart data={dailyCounts} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                tickLine={false}
                axisLine={false}
                width={20}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="count" fill="var(--color-pillar-risk)" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </div>
      ) : (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-8 text-center text-[length:var(--text-small)] font-[var(--font-ui)] text-[var(--color-text-muted)]">
          No scope drift events in the last 30 days.
        </div>
      )}

      {/* Recent events table */}
      {recentEvents.length > 0 && (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="border-b border-[var(--color-border)] px-4 py-3 text-[length:var(--text-small)] font-[var(--font-ui)] font-semibold text-[var(--color-text-primary)]">
            Recent drift events
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {recentEvents.slice(0, 20).map((e, i) => (
              <div
                key={i}
                className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-4"
              >
                <div className="w-32 shrink-0 text-[length:var(--text-small)] font-[var(--font-ui)] text-[var(--color-text-muted)]">
                  {new Date(e.occurred_at).toLocaleDateString('en-CA', {
                    timeZone: 'America/Edmonton',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[length:var(--text-small)] font-[var(--font-ui)] text-[var(--color-text-primary)]">
                    {e.actor ?? '—'}
                  </div>
                  {e.meta?.files && e.meta.files.length > 0 && (
                    <div className="mt-0.5 text-[10px] font-[var(--font-mono)] text-[var(--color-text-muted)]">
                      {e.meta.files.slice(0, 3).join(', ')}
                      {e.meta.files.length > 3 && ` +${e.meta.files.length - 3} more`}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
