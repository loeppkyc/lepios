/**
 * StatusGrid — renders all component status cards.
 *
 * Each card: component name, current status dot + label,
 * uptime %, 90-bar strip.
 *
 * F20: No inline style={} — Tailwind + CSS vars only.
 */

// F20: NO inline style={} — Tailwind + CSS vars only

import type { ComponentResult, ComponentStatus } from '@/lib/status/components'
import { UptimeStrip } from './UptimeStrip'

interface Props {
  components: ComponentResult[]
}

function statusLabel(s: ComponentStatus): string {
  switch (s) {
    case 'green':
      return 'Operational'
    case 'amber':
      return 'Degraded'
    case 'red':
      return 'Down'
    case 'unknown':
    default:
      return 'Unknown'
  }
}

function statusDotClass(s: ComponentStatus): string {
  switch (s) {
    case 'green':
      return 'bg-[var(--color-pillar-money)] shadow-[0_0_6px_var(--color-pillar-money)]'
    case 'amber':
      return 'bg-[var(--color-accent-gold)] shadow-[0_0_6px_var(--color-accent-gold)]'
    case 'red':
      return 'bg-[var(--color-pillar-risk)] shadow-[0_0_6px_var(--color-pillar-risk)]'
    case 'unknown':
    default:
      return 'bg-[var(--color-border)]'
  }
}

function statusTextClass(s: ComponentStatus): string {
  switch (s) {
    case 'green':
      return 'text-[var(--color-pillar-money)]'
    case 'amber':
      return 'text-[var(--color-accent-gold)]'
    case 'red':
      return 'text-[var(--color-pillar-risk)]'
    case 'unknown':
    default:
      return 'text-[var(--color-text-muted)]'
  }
}

export function StatusGrid({ components }: Props) {
  const allGreen = components.every((c) => c.currentStatus === 'green')
  const anyRed = components.some((c) => c.currentStatus === 'red')

  const overallStatus = anyRed ? 'red' : allGreen ? 'green' : 'amber'
  const overallLabel = anyRed
    ? 'Some systems are experiencing issues'
    : allGreen
      ? 'All systems operational'
      : 'Some systems degraded'

  return (
    <div className="space-y-6">
      {/* Overall status banner */}
      <div
        className={[
          'flex items-center gap-3 rounded-md border px-5 py-4',
          overallStatus === 'green'
            ? 'border-[var(--color-pillar-money)]/30 bg-[var(--color-pillar-money)]/5'
            : overallStatus === 'amber'
              ? 'border-[var(--color-accent-gold)]/30 bg-[var(--color-accent-gold)]/5'
              : 'border-[var(--color-pillar-risk)]/30 bg-[var(--color-pillar-risk)]/5',
        ].join(' ')}
      >
        <div
          className={['h-3 w-3 shrink-0 rounded-full', statusDotClass(overallStatus)].join(' ')}
        />
        <span className="text-[length:var(--text-body)] font-[var(--font-ui)] font-semibold text-[var(--color-text-primary)]">
          {overallLabel}
        </span>
      </div>

      {/* Component grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        {components.map((c) => (
          <div
            key={c.id}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4"
          >
            {/* Header row: name + status indicator */}
            <div className="mb-3 flex items-center justify-between gap-4">
              <div>
                <div className="text-[length:var(--text-body)] font-[var(--font-ui)] font-semibold text-[var(--color-text-primary)]">
                  {c.label}
                </div>
                <div className="mt-0.5 text-[length:var(--text-small)] font-[var(--font-ui)] text-[var(--color-text-muted)]">
                  {c.description}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <div className="flex items-center gap-2">
                  <div
                    className={['h-2.5 w-2.5 rounded-full', statusDotClass(c.currentStatus)].join(
                      ' '
                    )}
                  />
                  <span
                    className={[
                      'text-[length:var(--text-small)] font-[var(--font-ui)] font-semibold',
                      statusTextClass(c.currentStatus),
                    ].join(' ')}
                  >
                    {statusLabel(c.currentStatus)}
                  </span>
                </div>
                <div className="text-[length:var(--text-small)] font-[var(--font-mono)] text-[var(--color-text-muted)]">
                  {c.uptimePercent}% uptime
                </div>
              </div>
            </div>

            {/* 90-day strip */}
            <UptimeStrip bars={c.bars} />

            {/* Strip label */}
            <div className="mt-1.5 flex justify-between text-[10px] font-[var(--font-ui)] text-[var(--color-text-muted)]">
              <span>90 days ago</span>
              <span>Today</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
