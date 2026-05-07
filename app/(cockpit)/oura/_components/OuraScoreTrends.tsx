'use client'

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { OuraDailyRow } from '@/lib/oura/sync'
import { buildScoreTrend } from '@/lib/oura/helpers'

function formatTickDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
  })
}

const scoreConfig = {
  sleep_score: { label: 'Sleep', color: 'var(--color-pillar-health)' },
  readiness_score: { label: 'Readiness', color: 'var(--color-pillar-growing)' },
  activity_score: { label: 'Activity', color: 'var(--color-pillar-money)' },
} satisfies ChartConfig

const hrvConfig = {
  hrv: { label: 'HRV (ms)', color: 'var(--color-pillar-health)' },
} satisfies ChartConfig

const rhrConfig = {
  resting_hr: { label: 'Resting HR (bpm)', color: 'var(--color-pillar-money)' },
} satisfies ChartConfig

function ChartCard({
  title,
  legend,
  children,
}: {
  title: string
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
    </div>
  )
}

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

export function OuraScoreTrends({ rows }: { rows: OuraDailyRow[] }) {
  const data = buildScoreTrend(rows)
  const tickInterval = Math.max(1, Math.floor(data.length / 8))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ChartCard
        title="Sleep · Readiness · Activity"
        legend={
          <>
            <LegendDot color="var(--color-pillar-health)" label="Sleep" />
            <LegendDot color="var(--color-pillar-growing)" label="Readiness" />
            <LegendDot color="var(--color-pillar-money)" label="Activity" />
          </>
        }
      >
        <ChartContainer config={scoreConfig} className="h-56 w-full">
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
              domain={[0, 100]}
              tick={{
                fontSize: 10,
                fill: 'var(--color-text-disabled)',
                fontFamily: 'var(--font-ui)',
              }}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line
              type="monotone"
              dataKey="sleep_score"
              stroke="var(--color-sleep_score)"
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="readiness_score"
              stroke="var(--color-readiness_score)"
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="activity_score"
              stroke="var(--color-activity_score)"
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      </ChartCard>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <ChartCard title="HRV">
          <ChartContainer config={hrvConfig} className="h-40 w-full">
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
                dataKey="hrv"
                stroke="var(--color-hrv)"
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            </LineChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard title="Resting Heart Rate">
          <ChartContainer config={rhrConfig} className="h-40 w-full">
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
                dataKey="resting_hr"
                stroke="var(--color-resting_hr)"
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            </LineChart>
          </ChartContainer>
        </ChartCard>
      </div>
    </div>
  )
}
