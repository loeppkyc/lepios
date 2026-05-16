/**
 * UptimeStrip — 90-bar uptime history for a single component.
 *
 * Each bar represents one UTC day: green/amber/red/grey.
 * Oldest day is leftmost, today is rightmost.
 *
 * F20: No inline style={} — Tailwind + CSS vars only.
 */

// F20: NO inline style={} — Tailwind + CSS vars only

import type { DayBar, ComponentStatus } from '@/lib/status/components'

interface Props {
  bars: DayBar[]
}

function barColorClass(status: ComponentStatus): string {
  switch (status) {
    case 'green':
      return 'bg-[var(--color-pillar-money)]'
    case 'amber':
      return 'bg-[var(--color-accent-gold)]'
    case 'red':
      return 'bg-[var(--color-pillar-risk)]'
    case 'unknown':
    default:
      return 'bg-[var(--color-border)]'
  }
}

function barTitle(date: string, status: ComponentStatus): string {
  const label =
    status === 'green'
      ? 'Up'
      : status === 'amber'
        ? 'Degraded'
        : status === 'red'
          ? 'Down'
          : 'No data'
  return `${date}: ${label}`
}

export function UptimeStrip({ bars }: Props) {
  return (
    <div className="flex h-6 w-full gap-px overflow-hidden rounded-sm">
      {bars.map((bar) => (
        <div
          key={bar.date}
          title={barTitle(bar.date, bar.status)}
          className={[
            'min-w-0 flex-1 rounded-[1px] transition-opacity hover:opacity-70',
            barColorClass(bar.status),
          ].join(' ')}
        />
      ))}
    </div>
  )
}
