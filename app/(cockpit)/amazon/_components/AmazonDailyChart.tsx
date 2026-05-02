'use client'

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { DailyChartPoint } from '@/lib/amazon/reports'
import { useDevMode } from '@/lib/hooks/useDevMode'
import { DebugSection } from '@/components/cockpit/DebugSection'

// Exported for tests
export function formatDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
  })
}

const chartConfig = {
  revenue: { label: 'Revenue (CAD)', color: 'var(--color-pillar-money)' },
  units: { label: 'Units', color: 'var(--color-text-disabled)' },
} satisfies ChartConfig

export function AmazonDailyChart({ data }: { data: DailyChartPoint[] }) {
  const hasData = data.some((d) => d.revenue > 0 || d.units > 0)
  const [devMode] = useDevMode()

  if (!hasData) {
    return (
      <div>
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
          <span className="label-caps text-[var(--color-pillar-money)]">
            Daily Orders — Last 30 Days
          </span>
          <p className="mt-4 font-[family-name:var(--font-ui)] text-[length:var(--text-small)] text-[var(--color-text-disabled)]">
            No order data yet. First sync runs daily at 04:00 UTC.
          </p>
        </div>
        {devMode && (
          <DebugSection heading="Debug — Amazon Daily Chart">
            <pre style={{ color: 'var(--color-text-primary)', fontSize: 'var(--text-nano)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {JSON.stringify({ count: data.length, sample: data.slice(0, 5) }, null, 2)}
            </pre>
          </DebugSection>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
        <div className="flex items-baseline justify-between">
          <span className="label-caps text-[var(--color-pillar-money)]">
            Daily Orders — Last 30 Days
          </span>
          <div className="flex gap-4 font-[family-name:var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
            <span>
              <span className="mr-1 inline-block size-2.5 rounded-sm bg-[var(--color-pillar-money)] opacity-85" />
              Revenue (CAD)
            </span>
            <span>
              <span className="mr-1 inline-block size-2.5 rounded-sm bg-[var(--color-text-disabled)] opacity-60" />
              Units
            </span>
          </div>
        </div>

        <ChartContainer config={chartConfig} className="h-40 w-full">
          <BarChart data={data} margin={{ top: 4, right: 0, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.5} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              tickLine={false}
              axisLine={false}
              interval={4}
              tick={{
                fontSize: 10,
                fill: 'var(--color-text-disabled)',
                fontFamily: 'var(--font-ui)',
              }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(v: number) => `$${v}`}
              tick={{
                fontSize: 10,
                fill: 'var(--color-text-disabled)',
                fontFamily: 'var(--font-ui)',
              }}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[2, 2, 0, 0]} opacity={0.85} />
            <Bar dataKey="units" fill="var(--color-units)" radius={[2, 2, 0, 0]} opacity={0.6} />
          </BarChart>
        </ChartContainer>
      </div>
      {devMode && (
        <DebugSection heading="Debug — Amazon Daily Chart">
          <pre style={{ color: 'var(--color-text-primary)', fontSize: 'var(--text-nano)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {JSON.stringify({ count: data.length, first: data[0], last: data[data.length - 1], data }, null, 2)}
          </pre>
        </DebugSection>
      )}
    </div>
  )
}
