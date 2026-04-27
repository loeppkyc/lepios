'use client'

// No charting library available (confirmed: recharts/d3/nivo not in package.json).
// Rendering as a Tailwind-proportional bar chart using inline height percentages.
// TODO: replace with Recharts ComposedChart when charting dep is added.

import type { DailyChartPoint } from '@/lib/amazon/reports'

// ── Format date as "Apr 20" ───────────────────────────────────────────────────

function formatDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
  })
}

// ── Main export ───────────────────────────────────────────────────────────────

export function AmazonDailyChart({ data }: { data: DailyChartPoint[] }) {
  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1)
  const maxUnits = Math.max(...data.map((d) => d.units), 1)

  const hasData = data.some((d) => d.revenue > 0 || d.units > 0)

  if (!hasData) {
    return (
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          padding: '20px 24px',
        }}
      >
        <span className="label-caps" style={{ color: 'var(--color-pillar-money)' }}>
          Daily Orders — Last 30 Days
        </span>
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
            marginTop: 16,
          }}
        >
          No order data yet. First sync runs daily at 04:00 UTC.
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span className="label-caps" style={{ color: 'var(--color-pillar-money)' }}>
          Daily Orders — Last 30 Days
        </span>
        <div
          style={{
            display: 'flex',
            gap: 16,
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
          }}
        >
          <span>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                backgroundColor: 'var(--color-pillar-money)',
                borderRadius: 2,
                marginRight: 4,
                verticalAlign: 'middle',
              }}
            />
            Revenue (CAD)
          </span>
          <span>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                backgroundColor: 'var(--color-text-disabled)',
                borderRadius: 2,
                marginRight: 4,
                verticalAlign: 'middle',
              }}
            />
            Units
          </span>
        </div>
      </div>

      {/* Chart area */}
      <div style={{ overflowX: 'auto' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 4,
            height: 120,
            minWidth: 600,
          }}
        >
          {data.map((point) => {
            const revHeight = Math.max(
              (point.revenue / maxRevenue) * 100,
              point.revenue > 0 ? 4 : 0
            )
            const unitHeight = Math.max((point.units / maxUnits) * 60, point.units > 0 ? 4 : 0)
            return (
              <div
                key={point.date}
                title={`${formatDate(point.date)}: $${point.revenue.toFixed(2)} · ${point.units} units`}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                  cursor: 'default',
                }}
              >
                {/* Revenue bar */}
                <div
                  style={{
                    width: '100%',
                    height: `${revHeight}px`,
                    backgroundColor: 'var(--color-pillar-money)',
                    borderRadius: '2px 2px 0 0',
                    opacity: 0.85,
                  }}
                />
                {/* Units bar */}
                <div
                  style={{
                    width: '60%',
                    height: `${unitHeight}px`,
                    backgroundColor: 'var(--color-text-disabled)',
                    borderRadius: '2px 2px 0 0',
                    opacity: 0.6,
                  }}
                />
              </div>
            )
          })}
        </div>

        {/* X-axis: show every 5th date label */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            minWidth: 600,
            marginTop: 4,
          }}
        >
          {data.map((point, i) => (
            <div
              key={point.date}
              style={{
                flex: 1,
                textAlign: 'center',
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                color: 'var(--color-text-disabled)',
                overflow: 'hidden',
              }}
            >
              {i % 5 === 0 ? formatDate(point.date) : ''}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
