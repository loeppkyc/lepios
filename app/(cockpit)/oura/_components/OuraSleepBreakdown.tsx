'use client'

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { OuraDailyRow } from '@/lib/oura/sync'
import { averageSleepHours, buildSleepBreakdown } from '@/lib/oura/helpers'

function formatTickDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
  })
}

const stagesConfig = {
  deep_sleep_min: { label: 'Deep (min)', color: 'var(--color-pillar-growing)' },
  rem_sleep_min: { label: 'REM (min)', color: 'var(--color-pillar-happy)' },
  light_sleep_min: { label: 'Light (min)', color: 'var(--color-pillar-health)' },
} satisfies ChartConfig

const totalConfig = {
  total_sleep_hours: { label: 'Total Sleep (hrs)', color: 'var(--color-pillar-health)' },
} satisfies ChartConfig

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span>
      <span
        style={{
          display: 'inline-block',
          width: 10,
          height: 10,
          borderRadius: 2,
          backgroundColor: color,
          marginRight: 4,
          opacity: 0.85,
          verticalAlign: 'middle',
        }}
      />
      {label}
    </span>
  )
}

function ChartCard({
  title,
  caption,
  legend,
  children,
}: {
  title: string
  caption?: React.ReactNode
  legend?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span className="label-caps" style={{ color: 'var(--color-pillar-health)' }}>
          {title}
        </span>
        {legend && (
          <div
            style={{
              display: 'flex',
              gap: 12,
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
            }}
          >
            {legend}
          </div>
        )}
      </div>
      {children}
      {caption && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
          }}
        >
          {caption}
        </div>
      )}
    </div>
  )
}

export function OuraSleepBreakdown({ rows }: { rows: OuraDailyRow[] }) {
  const data = buildSleepBreakdown(rows)
  const avg = averageSleepHours(rows)
  const tickInterval = Math.max(1, Math.floor(data.length / 8))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ChartCard
        title="Sleep Stages"
        legend={
          <>
            <LegendDot color="var(--color-pillar-growing)" label="Deep" />
            <LegendDot color="var(--color-pillar-happy)" label="REM" />
            <LegendDot color="var(--color-pillar-health)" label="Light" />
          </>
        }
      >
        <ChartContainer config={stagesConfig} className="h-56 w-full">
          <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.5} />
            <XAxis
              dataKey="date"
              tickFormatter={formatTickDate}
              tickLine={false}
              axisLine={false}
              interval={tickInterval}
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
            <Bar
              dataKey="deep_sleep_min"
              stackId="sleep"
              fill="var(--color-deep_sleep_min)"
              opacity={0.85}
            />
            <Bar
              dataKey="rem_sleep_min"
              stackId="sleep"
              fill="var(--color-rem_sleep_min)"
              opacity={0.85}
            />
            <Bar
              dataKey="light_sleep_min"
              stackId="sleep"
              fill="var(--color-light_sleep_min)"
              opacity={0.85}
            />
          </BarChart>
        </ChartContainer>
      </ChartCard>

      <ChartCard
        title="Total Sleep Hours"
        caption={avg != null ? `Average: ${avg.toFixed(1)} hrs/night` : undefined}
      >
        <ChartContainer config={totalConfig} className="h-40 w-full">
          <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.5} />
            <XAxis
              dataKey="date"
              tickFormatter={formatTickDate}
              tickLine={false}
              axisLine={false}
              interval={tickInterval}
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
              dataKey="total_sleep_hours"
              stroke="var(--color-total_sleep_hours)"
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      </ChartCard>
    </div>
  )
}
